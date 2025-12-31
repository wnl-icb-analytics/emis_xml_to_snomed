import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  EmisXmlDocument,
  EmisReport,
  EmisValueSet,
  EmisValue,
} from './types';
import { hashString, generateDeterministicId } from './hash-utils';

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
  '999011011000230107',
  '12464001000001103',
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
    console.error('XML validation failed:', validationResult);
    throw new Error(`Invalid XML: ${validationResult.err.msg} at line ${validationResult.err.line}`);
  }

  console.log('XML validation passed, parsing...');

  const parser = new XMLParser(parserOptions);
  let parsed;

  try {
    parsed = parser.parse(xmlContent);
    console.log('XML parsed successfully');
  } catch (error) {
    console.error('XML parsing failed with error:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown',
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw new Error(`XML parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  if (!parsed) {
    throw new Error('XML parsing returned undefined');
  }

  // The root element is enquiryDocument, not root
  const enquiryDoc = parsed.enquiryDocument || parsed;

  console.log('EnquiryDoc keys:', enquiryDoc ? Object.keys(enquiryDoc) : 'no doc');

  // Extract reportFolder elements to build folder structure
  const reportFoldersData = enquiryDoc?.reportFolder || [];
  const reportFolders = Array.isArray(reportFoldersData) ? reportFoldersData : reportFoldersData ? [reportFoldersData] : [];

  console.log('Report folders found:', reportFolders.length);

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

  console.log('Reports found:', reports.length);

  if (reports.length > 0) {
    // Log the first report's valueSet structure to debug
    const firstReport = reports[0];
    const pop = firstReport?.population;
    const cg = pop?.criteriaGroup;
    const def = cg?.definition;
    const crit = def?.criteria;
    const criterion = crit?.criterion;
    const criterionArray = Array.isArray(criterion) ? criterion : [criterion];
    const firstCriterion = criterionArray[0];
    const vs = firstCriterion?.filterAttribute?.columnValue?.valueSet;
    if (vs) {
      const vsArray = Array.isArray(vs) ? vs : [vs];
      const firstVs = vsArray[0];
      console.log('First valueSet sample:', firstVs);
      console.log('First valueSet.values:', firstVs?.values);
      if (firstVs?.values) {
        const valuesArray = Array.isArray(firstVs.values) ? firstVs.values : [firstVs.values];
        console.log('First value in valueSet:', valuesArray[0]);
      }
    }
  }

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

      // In EMIS XML, the report contains a population > criteriaGroup > definition > criteria > criterion
      // Each criterion has filterAttribute > columnValue > valueSet
      // There can be multiple criteriaGroups, and also baseCriteriaGroup
      const population = report.population;
      
      // Handle criteriaGroups (can be array or single)
      const criteriaGroupsData = population?.criteriaGroup || [];
      const criteriaGroups = Array.isArray(criteriaGroupsData) ? criteriaGroupsData : criteriaGroupsData ? [criteriaGroupsData] : [];
      
      // Handle baseCriteriaGroup if present
      const baseCriteriaGroup = population?.baseCriteriaGroup;
      if (baseCriteriaGroup) {
        criteriaGroups.push(baseCriteriaGroup);
      }

      // Extract valueSets from all criteriaGroups
      const valueSetsData: any[] = [];
      criteriaGroups.forEach((criteriaGroup: any) => {
        const definition = criteriaGroup?.definition;
        if (!definition) return;

        // criteria is typically a single object containing criterion elements
        // But handle the case where it might be an array
        const criteriaData = definition?.criteria;
        if (!criteriaData) return;

        const criteriaArray = Array.isArray(criteriaData) ? criteriaData : [criteriaData];

        criteriaArray.forEach((criteria: any) => {
          // criterion can be an array or single object
          const criterionData = criteria?.criterion;
          if (!criterionData) return;

          const criterionArray = Array.isArray(criterionData) ? criterionData : [criterionData];
          
          // Extract valueSets from each criterion (including nested structures)
          criterionArray.forEach((crit: any) => {
            extractValueSetsFromCriterion(crit, valueSetsData);
          });
        });
      });

      // Log valueset structure for debugging - check if EMISINTERNAL codes are isolated
      const emisInternalValueSets = valueSetsData.filter((vs: any) => {
        const codeSystem = vs.codeSystem || '';
        return codeSystem === 'EMISINTERNAL' || codeSystem === 'EMIS';
      });
      if (emisInternalValueSets.length > 0) {
        console.log(`Report "${searchName}" has ${emisInternalValueSets.length} EMISINTERNAL valuesets`);
        emisInternalValueSets.forEach((vs: any, idx: number) => {
          // Handle values that might be an array or single object
          const valuesArray = Array.isArray(vs.values) ? vs.values : vs.values ? [vs.values] : [];
          const codes = valuesArray.map((v: any) => v.value || v.code || '').filter(Boolean);
          console.log(`  EMISINTERNAL valueset ${idx}: codes=${codes.join(', ')}`);
        });
        
        // Check if there are SNOMED valuesets nearby
        const snomedValueSets = valueSetsData.filter((vs: any) => {
          const codeSystem = vs.codeSystem || '';
          return codeSystem === 'SNOMED_CONCEPT' || codeSystem === 'SCT_CONST' || codeSystem === 'SCT_DRGGRP';
        });
        console.log(`  Nearby SNOMED valuesets: ${snomedValueSets.length}`);
        if (snomedValueSets.length > 0 && emisInternalValueSets.length > 0) {
          console.log(`  Checking if EMISINTERNAL codes are in same criterion context as SNOMED codes...`);
        }
      }

      const valueSets = valueSetsData
        .map((vs, vsIndex) => parseValueSet(vs, vsIndex))
        .filter((vs) => vs.values.length > 0); // Filter empty valueSets

      return {
        id: generateDeterministicId(name, searchName, rule, valueSets, reportIndex),
        xmlId,
        name,
        searchName,
        description,
        parentType,
        parentReportId,
        rule,
        valueSets,
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

function parseValueSet(valueSet: any, index: number): EmisValueSet {
  // In EMIS XML, valueSet contains 'values' (plural) elements
  // Each value element has: <value>, <displayName>, <includeChildren>, <isRefset>
  const valuesData = valueSet.values || [];
  const valuesArray = Array.isArray(valuesData) ? valuesData : valuesData ? [valuesData] : [];

  // Handle exceptions if present
  const exceptionsData = valueSet.exception?.values || [];
  const exceptionsArray = Array.isArray(exceptionsData) ? exceptionsData : exceptionsData ? [exceptionsData] : [];

  // Extract codeSystem directly from XML - this is preserved as-is from the source XML
  // No conversion is performed - if the XML says "SNOMED_CONCEPT", "EMIS", or any other value, it's kept exactly as-is
  // This allows us to track the original code system from the XML file
  const codeSystem = valueSet.codeSystem || undefined;

  // Check if the XML has an id attribute (with or without @ prefix from parser)
  const xmlId = valueSet['@_id'] || valueSet.id || undefined;

  // Log to check if XML has IDs
  if (Math.random() < 0.05) {
    console.log('ValueSet XML keys:', Object.keys(valueSet), 'xmlId:', xmlId);
  }

  return {
    id: xmlId || `valueset-${index}`,
    codeSystem,
    values: valuesArray.map((v: any) => parseValue(v)).filter((v): v is EmisValue => v !== null),
    exceptions: exceptionsArray
      .map((e: any) => ({
        code: e.value || '',
      }))
      .filter((e: any) => e.code),
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
    // Debug: log what we're actually getting
    console.error('Could not extract code from value:', {
      value,
      keys: Object.keys(value),
      valueType: typeof value.value,
      valueValue: value.value,
    });
    return null;
  }
  
  // Debug: log a sample to verify we're extracting correctly
  if (Math.random() < 0.01) {
    console.log('parseValue sample:', {
      extractedCode: code,
      codeLength: code.length,
      valueObject: value,
      valueKeys: Object.keys(value),
    });
  }

  const displayName = value.displayName || '';
  // Parse includeChildren: handle both string ('true'/'false') and boolean (true/false)
  // Also handle case-insensitive strings and missing values (default to false)
  const includeChildrenRaw = value.includeChildren;
  const includeChildren = 
    includeChildrenRaw === true ||
    includeChildrenRaw === 'true' ||
    String(includeChildrenRaw).toLowerCase() === 'true';
  
  // Debug logging for includeChildren parsing (only log a sample to avoid spam)
  if (Math.random() < 0.01) { // Log ~1% of values for debugging
    console.log('includeChildren parsing sample:', {
      code,
      raw: includeChildrenRaw,
      type: typeof includeChildrenRaw,
      parsed: includeChildren,
      allKeys: Object.keys(value)
    });
  }
  
  // Detect refset IDs: check isRefset flag first, then fallback to pattern matching
  // Refsets use ^ operator in ECL instead of <<
  // The XML has <isRefset>true</isRefset> as a sibling element
  const isRefsetFlag = value.isRefset === true || 
                       value.isRefset === 'true' || 
                       value.isRefset === '1' ||
                       String(value.isRefset).toLowerCase() === 'true';
  
  // Pattern: codes starting with 999 and length >= 15 are typically refsets
  const isRefsetPattern = code.startsWith('999') && code.length >= 15;
  
  const isRefset = isRefsetFlag || isRefsetPattern;
  
  // Debug logging for refset detection
  if (code.startsWith('999')) {
    console.log('Refset detection:', { 
      code, 
      isRefsetFlag, 
      isRefsetPattern, 
      isRefsetValue: value.isRefset,
      isRefset,
      valueKeys: Object.keys(value)
    });
  }

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
