import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  EmisXmlDocument,
  EmisReport,
  EmisValueSet,
  EmisValue,
} from './types';
import { hashString, generateDeterministicId } from './hash-utils';
import { parseCriteriaGroups, parseColumnGroups } from './rule-parser';

const NAMESPACE = 'http://www.e-mis.com/emisopen';

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  ignoreNameSpace: false,
  removeNSPrefix: true,
  processEntities: true,
  allowBooleanAttributes: true,
};

const IGNORED_VALUES = [
  'ACTIVE',
  'REVIEW',
  'ENDED',
  'N/A',
  '385432009',
  'C',
  'U',
  'R',
  'RD',
  'None',
];

export async function parseEmisXml(
  xmlContent: string
): Promise<EmisXmlDocument> {
  if (!xmlContent || typeof xmlContent !== 'string') {
    throw new Error('Invalid XML content: expected non-empty string');
  }

  // Validate XML structure first
  const validationResult = XMLValidator.validate(xmlContent, {
    allowBooleanAttributes: true,
  });

  if (validationResult !== true) {
    throw new Error(`Invalid XML: ${validationResult.err.msg} at line ${validationResult.err.line}`);
  }

  const parser = new XMLParser(parserOptions);
  let parsed;

  try {
    parsed = parser.parse(xmlContent);
  } catch (error) {
    throw new Error(`XML parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  if (!parsed) {
    throw new Error('XML parsing returned undefined');
  }

  // The root element is enquiryDocument, not root
  const enquiryDoc = parsed.enquiryDocument || parsed;

  // Extract reportFolder elements to build folder structure
  const reportFoldersData = enquiryDoc?.reportFolder || [];
  const reportFolders = Array.isArray(reportFoldersData) ? reportFoldersData : reportFoldersData ? [reportFoldersData] : [];

  // Build a map of folder ID to folder object
  const folderMap = new Map<string, { name: string; parentFolder?: string }>();
  reportFolders.forEach((folder: any) => {
    const folderId = folder.id;
    const folderName = folder.name || '';
    const parentFolderId = folder.parentFolder;
    folderMap.set(folderId, { name: folderName, parentFolder: parentFolderId });
  });

  // Function to build full folder path
  const buildFolderPath = (folderId: string): string => {
    const folder = folderMap.get(folderId);
    if (!folder) return 'Uncategorised';

    // Build path by traversing up the parent hierarchy
    const path: string[] = [];
    let currentId: string | undefined = folderId;

    while (currentId) {
      const current = folderMap.get(currentId);
      if (!current) break;
      path.unshift(current.name);
      currentId = current.parentFolder;
    }

    // Join with ' > ' separator
    return path.join(' > ');
  };

  // Extract report elements (not reportFolder)
  const reportsData = enquiryDoc?.report || [];
  const reports = Array.isArray(reportsData) ? reportsData : reportsData ? [reportsData] : [];

  const processedReports: EmisReport[] = reports
    .map((report: any, reportIndex: number) => {
      const xmlId = report.id || '';
      const name = report.name || '';
      const searchName = extractSearchName(name);
      const description = report.description || undefined;

      // Extract parent information
      const parent = report.parent;
      const parentType = parent?.['@_parentType'] || parent?.parentType || undefined;
      const parentReportId = parent?.SearchIdentifier?.['@_reportGuid'] || parent?.SearchIdentifier?.reportGuid || undefined;

      // Get the full folder path from the folder ID
      const folderId = report.folder;
      const rule = folderId ? buildFolderPath(folderId) : 'Uncategorised';

      // Detect report format: population (search/filter) or listReport (dashboard)
      const population = report.population;
      const listReport = report.listReport;
      const reportType = listReport ? 'listReport' as const : 'population' as const;

      const valueSetsData: any[] = [];

      if (population) {
        // Standard population format: population > criteriaGroup > definition > criteria > criterion
        const criteriaGroupsData = population?.criteriaGroup || [];
        const criteriaGroups = Array.isArray(criteriaGroupsData) ? criteriaGroupsData : criteriaGroupsData ? [criteriaGroupsData] : [];

        const baseCriteriaGroup = population?.baseCriteriaGroup;
        if (baseCriteriaGroup) {
          criteriaGroups.push(baseCriteriaGroup);
        }

        criteriaGroups.forEach((criteriaGroup: any) => {
          const definition = criteriaGroup?.definition;
          if (!definition) return;

          const criteriaData = definition?.criteria;
          if (!criteriaData) return;

          const criteriaArray = Array.isArray(criteriaData) ? criteriaData : [criteriaData];

          criteriaArray.forEach((criteria: any) => {
            const criterionData = criteria?.criterion;
            if (!criterionData) return;

            const criterionArray = Array.isArray(criterionData) ? criterionData : [criterionData];
            criterionArray.forEach((crit: any) => {
              extractValueSetsFromCriterion(crit, valueSetsData);
            });
          });
        });
      } else if (listReport) {
        // Dashboard format: listReport > columnGroups[] > columnGroup > criteria > criterion
        const columnGroupsContainers = listReport.columnGroups;
        const containers = Array.isArray(columnGroupsContainers) ? columnGroupsContainers : columnGroupsContainers ? [columnGroupsContainers] : [];

        for (const container of containers) {
          const groupNodes = container?.columnGroup;
          const groups = Array.isArray(groupNodes) ? groupNodes : groupNodes ? [groupNodes] : [];
          for (const node of groups) {
            const criteriaData = node?.criteria;
            if (!criteriaData) continue;
            const criterionNodes = criteriaData?.criterion;
            const criterionArray = Array.isArray(criterionNodes) ? criterionNodes : criterionNodes ? [criterionNodes] : [];
            for (const crit of criterionArray) {
              extractValueSetsFromCriterion(crit, valueSetsData);
            }
          }
        }
      }

      const valueSets = valueSetsData
        .map((vs, vsIndex) => parseValueSet(vs, vsIndex))
        .filter((vs) => vs.values.length > 0);

      // Parse rule structure
      const parsedCriteriaGroups = population ? parseCriteriaGroups(population) : undefined;
      const parsedColumnGroups = listReport ? parseColumnGroups(listReport) : undefined;

      return {
        id: generateDeterministicId(name, searchName, rule, valueSets, reportIndex),
        xmlId,
        name,
        searchName,
        description,
        parentType,
        parentReportId,
        rule,
        reportType,
        valueSets,
        criteriaGroups: parsedCriteriaGroups,
        columnGroups: parsedColumnGroups,
      };
    });

  return {
    namespace: NAMESPACE,
    reports: processedReports,
    parsedAt: new Date().toISOString(),
  };
}

/**
 * Recursively extracts all valueSets from a criterion structure.
 * Handles nested structures like linkedCriterion, restriction.testAttribute, etc.
 */
function extractValueSetsFromCriterion(criterion: any, valueSetsData: any[]): void {
  if (!criterion) return;

  // Extract valueSets from filterAttribute.columnValue
  const filterAttr = criterion?.filterAttribute;
  if (filterAttr) {
    // columnValue can be a single object or an array
    const columnValues = filterAttr.columnValue;
    if (columnValues) {
      const columnValueArray = Array.isArray(columnValues) ? columnValues : [columnValues];
      
      columnValueArray.forEach((columnValue: any) => {
        // Check for valueSet directly in columnValue
        if (columnValue?.valueSet) {
          const valueSets = Array.isArray(columnValue.valueSet) ? columnValue.valueSet : [columnValue.valueSet];
          valueSetsData.push(...valueSets);
        }
      });

      // Check for valueSets in restriction.testAttribute.columnValue
      if (filterAttr.restriction?.testAttribute?.columnValue) {
        const testColumnValues = filterAttr.restriction.testAttribute.columnValue;
        const testColumnValueArray = Array.isArray(testColumnValues) ? testColumnValues : [testColumnValues];
        
        testColumnValueArray.forEach((testColumnValue: any) => {
          if (testColumnValue?.valueSet) {
            const valueSets = Array.isArray(testColumnValue.valueSet) ? testColumnValue.valueSet : [testColumnValue.valueSet];
            valueSetsData.push(...valueSets);
          }
        });
      }
    }
  }

  // Recursively process linkedCriterion structures
  if (criterion.linkedCriterion) {
    const linkedCriteria = Array.isArray(criterion.linkedCriterion) 
      ? criterion.linkedCriterion 
      : [criterion.linkedCriterion];
    
    linkedCriteria.forEach((linkedCrit: any) => {
      if (linkedCrit?.criterion) {
        const linkedCriterionArray = Array.isArray(linkedCrit.criterion) 
          ? linkedCrit.criterion 
          : [linkedCrit.criterion];
        
        linkedCriterionArray.forEach((linkedCriterion: any) => {
          extractValueSetsFromCriterion(linkedCriterion, valueSetsData);
        });
      }
    });
  }
}

function extractSearchName(name: string): string {
  const match = name.match(/\[(.*?)\]/);
  return match ? match[1] : name;
}

function determineRule(
  report: any,
  index: number,
  totalReports: number,
  name: string
): string {
  // Strategy 1: Check if there's an explicit rule/category attribute
  if (report['@_rule'] || report['@_category']) {
    return report['@_rule'] || report['@_category'];
  }

  // Strategy 2: Infer from report name patterns
  const nameLower = name.toLowerCase();

  // Common patterns in EMIS exports
  if (nameLower.includes('qof')) return 'QOF';
  if (nameLower.includes('screening')) return 'Screening';
  if (nameLower.includes('immunisation') || nameLower.includes('immunization'))
    return 'Immunisations';
  if (nameLower.includes('diagnosis') || nameLower.includes('condition')) {
    return 'Diagnoses';
  }
  if (
    nameLower.includes('medication') ||
    nameLower.includes('prescription') ||
    nameLower.includes('drug')
  ) {
    return 'Medications';
  }
  if (
    nameLower.includes('procedure') ||
    nameLower.includes('intervention') ||
    nameLower.includes('operation')
  ) {
    return 'Procedures';
  }
  if (nameLower.includes('observation') || nameLower.includes('test')) {
    return 'Observations';
  }
  if (nameLower.includes('referral')) return 'Referrals';
  if (nameLower.includes('allergy') || nameLower.includes('allergies')) {
    return 'Allergies';
  }

  // Strategy 3: Group by position (first X reports might be one rule, etc.)
  if (index < totalReports / 3) return 'Primary Indicators';
  if (index < (2 * totalReports) / 3) return 'Secondary Indicators';
  return 'Other Searches';
}

export function parseValueSet(valueSet: any, index: number): EmisValueSet {
  // In EMIS XML, valueSet contains 'values' (plural) elements
  // Each value element has: <value>, <displayName>, <includeChildren>, <isRefset>
  const valuesData = valueSet.values || [];
  const valuesArray = Array.isArray(valuesData) ? valuesData : valuesData ? [valuesData] : [];

  // Collect all exceptions from:
  // 1. ValueSet-level exceptions (valueSet.exception.values)
  // 2. Exceptions nested within individual values (value.exception.values)
  const allExceptions: any[] = [];
  
  // Normalise a raw exception value object into {value, displayName} strings.
  // parseTagValue in fast-xml-parser may return numeric tag text as a number
  // for long integer codes — coerce to string so codes round-trip unchanged.
  const normaliseException = (exc: any): { value: string; displayName: string } | null => {
    if (!exc) return null;
    let code = '';
    if (typeof exc.value === 'string' || typeof exc.value === 'number' || typeof exc.value === 'bigint') {
      code = exc.value.toString().trim();
    } else if (exc.value && typeof exc.value === 'object' && exc.value['#text'] !== undefined) {
      code = exc.value['#text'].toString().trim();
    } else if (typeof exc.code === 'string' || typeof exc.code === 'number') {
      code = exc.code.toString().trim();
    }
    if (!code) return null;
    let displayName = '';
    if (typeof exc.displayName === 'string' || typeof exc.displayName === 'number') {
      displayName = exc.displayName.toString().trim();
    } else if (exc.displayName && typeof exc.displayName === 'object' && exc.displayName['#text'] !== undefined) {
      displayName = exc.displayName['#text'].toString().trim();
    }
    return { value: code, displayName };
  };

  const pushRawExceptions = (raw: any) => {
    if (!raw) return;
    const arr = Array.isArray(raw) ? raw : [raw];
    arr.forEach((exc: any) => {
      const n = normaliseException(exc);
      if (n) allExceptions.push(n);
    });
  };

  // Handle ValueSet-level exceptions
  if (valueSet.exception) {
    if (valueSet.exception.values) {
      pushRawExceptions(valueSet.exception.values);
    } else if (Array.isArray(valueSet.exception)) {
      pushRawExceptions(valueSet.exception);
    } else {
      pushRawExceptions(valueSet.exception);
    }
  } else if (valueSet.exceptions) {
    pushRawExceptions(valueSet.exceptions);
  }
  
  // Extract exceptions nested within individual values
  // These are exceptions to specific parent codes (e.g., exclude certain children from a parent with includeChildren=true)
  valuesArray.forEach((value: any) => {
    if (value.exception) {
      if (value.exception.values) {
        pushRawExceptions(value.exception.values);
      } else if (value.exception.value !== undefined) {
        pushRawExceptions(value.exception);
      }
    }
  });
  
  // Deduplicate exceptions by code; keep the first non-empty displayName seen for each code
  const uniqueExceptions = new Map<string, { value: string; displayName: string }>();
  allExceptions.forEach((exc: { value: string; displayName: string }) => {
    if (!exc.value) return;
    const existing = uniqueExceptions.get(exc.value);
    if (!existing) {
      uniqueExceptions.set(exc.value, exc);
    } else if (!existing.displayName && exc.displayName) {
      uniqueExceptions.set(exc.value, exc);
    }
  });

  const exceptionsArray = Array.from(uniqueExceptions.values());

  const codeSystem = valueSet.codeSystem || undefined;

  // Description often contains a cluster ID like STAT_COD, HYP_COD etc.
  const description = typeof valueSet.description === 'string' ? valueSet.description : undefined;

  // Check if the XML has an id attribute (with or without @ prefix from parser)
  const xmlId = valueSet['@_id'] || valueSet.id || undefined;

  return {
    id: xmlId || `valueset-${index}`,
    codeSystem,
    description,
    values: valuesArray.map((v: any) => parseValue(v)).filter((v): v is EmisValue => v !== null),
    exceptions: exceptionsArray
      .map((e) => ({
        code: e.value,
        displayName: e.displayName,
      }))
      .filter((e) => e.code),
  };
}

function parseValue(value: any): EmisValue | null {
  // With removeNSPrefix: true, namespaces are already removed
  if (!value) return null;

  // The XML <values> element has child elements: <value>, <displayName>, <includeChildren>, <isRefset>
  // The parser gives us an object like: { value: '123', displayName: 'Name', includeChildren: 'true', isRefset: 'true' }
  let code = '';

  // Extract code from value element (matches Python: value_elem.text)
  if (typeof value.value === 'string' || typeof value.value === 'number') {
    code = value.value.toString().trim();
  } else if (value.value && typeof value.value === 'object' && value.value['#text']) {
    code = value.value['#text'].toString().trim();
  } else if (value.code) {
    // Fallback: sometimes parser gives us {code, displayName, includeChildren}
    code = value.code.toString().trim();
  } else {
    return null;
  }

  const displayName = value.displayName || '';
  const includeChildrenRaw = value.includeChildren;
  const includeChildren =
    includeChildrenRaw === true ||
    includeChildrenRaw === 'true' ||
    String(includeChildrenRaw).toLowerCase() === 'true';

  // Detect refset IDs: check isRefset flag first, then fallback to pattern matching
  const isRefsetFlag = value.isRefset === true ||
                       value.isRefset === 'true' ||
                       value.isRefset === '1' ||
                       String(value.isRefset).toLowerCase() === 'true';
  const isRefsetPattern = code.startsWith('999') && code.length >= 15;
  const isRefset = isRefsetFlag || isRefsetPattern;

  // Filter out ignored values
  if (!code || IGNORED_VALUES.includes(code)) {
    return null;
  }

  return {
    code,
    displayName,
    includeChildren,
    isRefset,
  };
}
