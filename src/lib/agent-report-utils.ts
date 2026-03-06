import type {
  ColumnGroup,
  CriteriaGroup,
  EmisReport,
  EmisValueSet,
  DateRange,
  RangeBoundary,
  SearchCriterion,
  SearchRestriction,
  ColumnFilter,
  RestrictionCondition,
} from '@/lib/types';
import { formatColumnFilterRange, formatOperator, formatRelationship, formatRestriction, formatRangeBoundary } from '@/lib/rule-format-utils';
import { generateValueSetFriendlyName } from '@/lib/valueset-utils';

export interface ValueSetSummary {
  id: string;
  friendlyName: string;
  preview: string;
  codeCount: number;
  codeSystem: string;
  cluster: string | null;
  exceptionCount: number;
  codes: Array<{
    code: string;
    displayName: string;
    includeChildren: boolean;
    isRefset: boolean;
  }>;
}

export interface CriterionDisplayData {
  dedupedValueSets: EmisValueSet[];
  extraValueSets: EmisValueSet[];
  filters: { label: string; value: string }[];
  restrictions: { label: string; value: string }[];
}

export interface RangeBoundarySummary {
  operator: string | null;
  operatorSymbol: string | null;
  value: string | null;
  unit: string | null;
  relation: string | null;
  rendered: string;
}

export interface DateRangeSummary {
  from: RangeBoundarySummary | null;
  to: RangeBoundarySummary | null;
  rendered: string;
}

export interface CriterionFilterSummary {
  columns: string[];
  displayName: string | null;
  operator: string | null;
  operatorSymbol: string | null;
  singleValue: string | null;
  rendered: string;
  range: DateRangeSummary | null;
  valueSets: ValueSetSummary[];
}

export interface RestrictionConditionSummary {
  column: string;
  operator: string;
  operatorSymbol: string;
  valueSets: string[];
  rangeValues: string[];
}

export interface CriterionRestrictionSummary {
  type: string;
  description: string;
  recordCount: number | null;
  direction: string | null;
  conditions: RestrictionConditionSummary[];
}

export interface RelationshipSummary {
  parentColumn: string | null;
  childColumn: string | null;
  rendered: string;
  range: DateRangeSummary | null;
}

export interface CriterionLogicSummary {
  id: string;
  displayName: string;
  table: string;
  negation: boolean;
  rendered: string;
  relationship: RelationshipSummary | null;
  valueSets: ValueSetSummary[];
  extraValueSets: ValueSetSummary[];
  filters: CriterionFilterSummary[];
  restrictions: CriterionRestrictionSummary[];
  linkedCriteria: CriterionLogicSummary[];
}

export interface ReportCounts {
  criteriaGroups: number;
  columnGroups: number;
  criteria: number;
  linkedCriteria: number;
  valueSets: number;
  uniqueValueSets: number;
}

export interface ReportDependencySummary {
  parentPopulationReport: { xmlId: string; searchName: string } | null;
  populationCriteriaReports: Array<{ xmlId: string; searchName: string }>;
  libraryItemRefs: string[];
  libraryItems: LibraryItemReferenceSummary[];
}

export interface RuleDecisionSummary {
  kind: 'criteria-group' | 'column-group';
  label: string;
  operator: string | null;
  passAction: string;
  failAction: string;
  clauseType: 'must-match' | 'must-not-match' | 'include-if-match' | 'include-if-not-match' | 'informational';
  clauseText: string;
  criteria: string[];
  criteriaDetails: CriterionLogicSummary[];
  populationCriteria: Array<{ xmlId: string; searchName: string }>;
  libraryItems: LibraryItemReferenceSummary[];
}

export interface ParentChainEntry {
  id: string;
  xmlId: string;
  title: string;
  searchName: string;
  parentPopulation: string;
  plainEnglishSummary: string;
  booleanLogic: string | null;
  unresolvedLibraryItemRefs: string[];
  unresolvedLibraryItems: LibraryItemReferenceSummary[];
  valueSets: Array<{
    friendlyName: string;
    preview: string;
    codeSystem: string;
    cluster: string | null;
    codeCount: number;
  }>;
}

export interface LibraryItemReferenceSummary {
  ref: string;
  inferredName: string | null;
  wrapperReports: Array<{
    xmlId: string;
    searchName: string;
    title: string;
  }>;
}

function codeSystemLabel(cs?: string): string {
  switch (cs?.toUpperCase()) {
    case 'SNOMED_CONCEPT': return 'SNOMED';
    case 'SCT_CONST': return 'SCT Const';
    case 'SCT_DRGGRP': return 'Drug Group';
    case 'SCT_APPNAME': return 'Brand';
    case 'EMISINTERNAL': return 'Internal';
    case 'EMIS': return 'EMIS';
    case 'LIBRARY_ITEM': return 'Library';
    default: return cs || 'Unknown';
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case 'SELECT': return 'Include';
    case 'REJECT': return 'Exclude';
    case 'NEXT': return 'Next rule';
    default: return action;
  }
}

function toSentenceCase(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isSingleLibraryItemWrapper(report: EmisReport, ref: string): boolean {
  if ((report.criteriaGroups?.length ?? 0) !== 1) return false;
  if ((report.columnGroups?.length ?? 0) > 0) return false;

  const group = report.criteriaGroups?.[0];
  if (!group) return false;

  return (
    group.criteria.length === 0 &&
    group.populationCriteria.length === 0 &&
    (group.libraryItemRefs?.length ?? 0) === 1 &&
    group.libraryItemRefs?.[0] === ref
  );
}

function cleanLibraryWrapperName(name: string): string {
  return name
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^LTC LCS:\s*/i, '')
    .replace(/\*+$/, '')
    .trim();
}

export function buildLibraryItemReferenceSummary(ref: string, allReports: EmisReport[]): LibraryItemReferenceSummary {
  const wrapperReports = allReports
    .filter((report) => isSingleLibraryItemWrapper(report, ref))
    .map((report) => ({
      xmlId: report.xmlId,
      searchName: report.searchName,
      title: report.name,
    }));

  const inferredName = wrapperReports.length > 0
    ? cleanLibraryWrapperName(wrapperReports[0].title)
    : null;

  return {
    ref,
    inferredName,
    wrapperReports,
  };
}

function formatLibraryItemReference(ref: string, allReports: EmisReport[]): string {
  const summary = buildLibraryItemReferenceSummary(ref, allReports);
  return summary.inferredName
    ? `${summary.inferredName} (library item ${ref})`
    : `library item ${ref}`;
}

export function formatValueSetPreview(vs: EmisValueSet): string {
  const displayNames = vs.values
    .map((v) => v.displayName)
    .filter(Boolean);

  if (displayNames.length > 0) {
    const preview = displayNames.slice(0, 3).join(', ');
    const remainder = displayNames.length > 3 ? ` +${displayNames.length - 3} more` : '';
    return `${preview}${remainder}`;
  }

  const isRefsetOnly = vs.values.length > 0 && vs.values.every((v) => v.isRefset);
  if (isRefsetOnly) {
    return `Refset${vs.values.length > 1 ? 's' : ''}: ${vs.values.map((v) => v.code).join(', ')}`;
  }

  return vs.description || 'No display names';
}

export function getCriterionDisplayData(criterion: SearchCriterion): CriterionDisplayData {
  const seenCodeHashes = new Set<string>();
  const dedupedValueSets: EmisValueSet[] = [];
  for (const vs of criterion.valueSets) {
    const codeKey = vs.values.map((v) => v.code).sort().join(',');
    if (!seenCodeHashes.has(codeKey)) {
      seenCodeHashes.add(codeKey);
      dedupedValueSets.push(vs);
    }
  }

  const criterionVsIds = new Set(criterion.valueSets.map((vs) => vs.id));
  const extraValueSets: EmisValueSet[] = [];
  for (const cf of criterion.columnFilters) {
    if (cf.valueSets && cf.columns[0]?.toUpperCase() === 'READCODE') {
      for (const vs of cf.valueSets) {
        const codeKey = vs.values.map((v) => v.code).sort().join(',');
        if (!criterionVsIds.has(vs.id) && !seenCodeHashes.has(codeKey)) {
          seenCodeHashes.add(codeKey);
          extraValueSets.push(vs);
          criterionVsIds.add(vs.id);
        }
      }
    }
  }

  const restrictions: { label: string; value: string }[] = [];
  const filters: { label: string; value: string }[] = [];
  for (const r of criterion.restrictions) {
    restrictions.push({ label: '', value: formatRestriction(r) });
  }
  for (const cf of criterion.columnFilters) {
    const primaryCol = cf.columns[0] || '';
    const name = cf.displayName || cf.columns.join(', ');
    const op = cf.inNotIn || '';
    const rangeStr = formatColumnFilterRange(cf.range, primaryCol);
    const singleVal = cf.singleValue;

    if (cf.valueSets && cf.valueSets.length > 0 && primaryCol.toUpperCase() !== 'READCODE') {
      const isDrugFilter = primaryCol.toUpperCase() === 'DRUG' ||
        name.toUpperCase().startsWith('DRUG');
      if (isDrugFilter) {
        continue;
      }
      const vsNames = cf.valueSets.flatMap((vs) => vs.values.map((v) => v.displayName)).filter(Boolean);
      if (vsNames.length > 0) {
        const cleanLabel = name.replace(/\s*\(.*\)\s*$/, '').trim();
        filters.push({ label: `${cleanLabel} =`, value: vsNames.join(', ') });
        continue;
      }
    }

    const valStr = rangeStr || singleVal || '';
    if (valStr) {
      const skipOp = op === 'IN' && (/^[<>=!]/.test(valStr) || /^[a-z]/i.test(valStr));
      filters.push({ label: name, value: skipOp ? valStr : `${op ? op + ' ' : ''}${valStr}` });
    }
  }

  return { dedupedValueSets, extraValueSets, filters, restrictions };
}

function collectCriteria(criteria: SearchCriterion[], accumulator: SearchCriterion[]) {
  for (const criterion of criteria) {
    accumulator.push(criterion);
    collectCriteria(criterion.linkedCriteria, accumulator);
  }
}

function collectValueSets(criteria: SearchCriterion[], friendlyNameMap: Map<string, string>, codeHashToName: Map<string, string>, reportName: string, vsIndexRef: { value: number }) {
  for (const criterion of criteria) {
    for (const vs of criterion.valueSets) {
      if (!friendlyNameMap.has(vs.id)) {
        const codeKey = vs.values.map((v) => v.code).sort().join(',');
        const existing = codeHashToName.get(codeKey);
        if (existing) {
          friendlyNameMap.set(vs.id, existing);
        } else {
          const name = generateValueSetFriendlyName(reportName, vsIndexRef.value);
          friendlyNameMap.set(vs.id, name);
          codeHashToName.set(codeKey, name);
          vsIndexRef.value++;
        }
      }
    }
    collectValueSets(criterion.linkedCriteria, friendlyNameMap, codeHashToName, reportName, vsIndexRef);
  }
}

export function buildFriendlyNameMap(report: EmisReport): Map<string, string> {
  const friendlyNameMap = new Map<string, string>();
  const codeHashToName = new Map<string, string>();
  const vsIndexRef = { value: 0 };

  for (const group of report.criteriaGroups ?? []) {
    collectValueSets(group.criteria, friendlyNameMap, codeHashToName, report.name, vsIndexRef);
  }
  for (const group of report.columnGroups ?? []) {
    collectValueSets(group.criteria, friendlyNameMap, codeHashToName, report.name, vsIndexRef);
  }

  for (const vs of report.valueSets) {
    if (!friendlyNameMap.has(vs.id)) {
      const codeKey = vs.values.map((v) => v.code).sort().join(',');
      const existing = codeHashToName.get(codeKey);
      if (existing) {
        friendlyNameMap.set(vs.id, existing);
      } else {
        const name = generateValueSetFriendlyName(report.name, vsIndexRef.value);
        friendlyNameMap.set(vs.id, name);
        codeHashToName.set(codeKey, name);
        vsIndexRef.value++;
      }
    }
  }

  return friendlyNameMap;
}

export function getParentPopulation(report: EmisReport, allReports: EmisReport[]): string {
  if (report.parentType === 'ACTIVE') {
    return 'Currently registered patients';
  }
  if (report.parentType === 'ALL') {
    return 'All patients (including deducted and deceased)';
  }
  if (report.parentType === 'POP') {
    if (!report.parentReportId) return 'Based on another search';
    const parentReport = allReports.find((r) => r.xmlId === report.parentReportId);
    if (parentReport) {
      return `Based on "${parentReport.searchName}" search results`;
    }
    return `Based on another search (${report.parentReportId})`;
  }
  return report.parentType || 'Not specified';
}

function buildValueSetSummary(vs: EmisValueSet, friendlyNameMap: Map<string, string>): ValueSetSummary {
  return {
    id: vs.id,
    friendlyName: friendlyNameMap.get(vs.id) || '(not assigned)',
    preview: formatValueSetPreview(vs),
    codeCount: vs.values.length,
    codeSystem: codeSystemLabel(vs.codeSystem),
    cluster: vs.description || null,
    exceptionCount: vs.exceptions.length,
    codes: vs.values.map((value) => ({
      code: value.code,
      displayName: value.displayName,
      includeChildren: value.includeChildren,
      isRefset: Boolean(value.isRefset),
    })),
  };
}

function buildRangeBoundarySummary(boundary: RangeBoundary | undefined, column?: string): RangeBoundarySummary | null {
  if (!boundary) return null;
  const operatorSymbol = boundary.operator ? formatOperator(boundary.operator) : null;
  const rendered = (!boundary.unit && !boundary.relation)
    ? [operatorSymbol, boundary.value].filter(Boolean).join(' ').trim()
    : formatColumnFilterRange({ from: boundary }, column) || formatRangeBoundary(boundary);
  return {
    operator: boundary.operator || null,
    operatorSymbol,
    value: boundary.value || null,
    unit: boundary.unit || null,
    relation: boundary.relation || null,
    rendered,
  };
}

function buildDateRangeSummary(range: DateRange | undefined, column?: string): DateRangeSummary | null {
  if (!range) return null;
  return {
    from: buildRangeBoundarySummary(range.from, column),
    to: buildRangeBoundarySummary(range.to, column),
    rendered: formatColumnFilterRange(range, column),
  };
}

function buildRestrictionConditionSummary(condition: RestrictionCondition): RestrictionConditionSummary {
  return {
    column: condition.column,
    operator: condition.operator,
    operatorSymbol: formatOperator(condition.operator),
    valueSets: condition.valueSets ?? [],
    rangeValues: condition.rangeValues ?? [],
  };
}

function buildRestrictionSummary(restriction: SearchRestriction): CriterionRestrictionSummary {
  return {
    type: restriction.type,
    description: restriction.description,
    recordCount: restriction.recordCount ?? null,
    direction: restriction.direction ?? null,
    conditions: (restriction.conditions ?? []).map(buildRestrictionConditionSummary),
  };
}

function buildFilterSummary(
  filter: ColumnFilter,
  friendlyNameMap: Map<string, string>,
): CriterionFilterSummary {
  const primaryColumn = filter.columns[0] || '';
  const displayName = filter.displayName || filter.columns.join(', ') || null;
  const renderedValue = formatColumnFilterRange(filter.range, primaryColumn) || filter.singleValue || '';
  const rendered = renderedValue
    ? `${displayName || primaryColumn}${filter.inNotIn ? ` ${filter.inNotIn}` : ''} ${renderedValue}`.trim()
    : displayName || primaryColumn;

  return {
    columns: filter.columns,
    displayName,
    operator: filter.inNotIn || null,
    operatorSymbol: filter.inNotIn ? formatOperator(filter.inNotIn) : null,
    singleValue: filter.singleValue || null,
    rendered,
    range: buildDateRangeSummary(filter.range, primaryColumn),
    valueSets: (filter.valueSets ?? []).map((vs) => buildValueSetSummary(vs, friendlyNameMap)),
  };
}

function buildRelationshipSummary(criterion: SearchCriterion): RelationshipSummary | null {
  if (!criterion.relationship) return null;
  return {
    parentColumn: criterion.relationship.parentColumn || null,
    childColumn: criterion.relationship.childColumn || null,
    rendered: formatRelationship(criterion.relationship),
    range: buildDateRangeSummary(criterion.relationship.rangeValue, criterion.relationship.childColumn),
  };
}

function buildCriterionLogicSummary(
  criterion: SearchCriterion,
  friendlyNameMap: Map<string, string>,
): CriterionLogicSummary {
  const displayData = getCriterionDisplayData(criterion);
  return {
    id: criterion.id,
    displayName: criterion.displayName || 'Unnamed criterion',
    table: criterion.table,
    negation: criterion.negation,
    rendered: buildCriterionPhrase(criterion),
    relationship: buildRelationshipSummary(criterion),
    valueSets: displayData.dedupedValueSets.map((vs) => buildValueSetSummary(vs, friendlyNameMap)),
    extraValueSets: displayData.extraValueSets.map((vs) => buildValueSetSummary(vs, friendlyNameMap)),
    filters: criterion.columnFilters.map((filter) => buildFilterSummary(filter, friendlyNameMap)),
    restrictions: criterion.restrictions.map(buildRestrictionSummary),
    linkedCriteria: criterion.linkedCriteria.map((linked) => buildCriterionLogicSummary(linked, friendlyNameMap)),
  };
}

export function getReportCounts(report: EmisReport): ReportCounts {
  const criteria: SearchCriterion[] = [];
  for (const group of report.criteriaGroups ?? []) {
    collectCriteria(group.criteria, criteria);
  }
  for (const group of report.columnGroups ?? []) {
    collectCriteria(group.criteria, criteria);
  }

  const linkedCriteria = criteria.filter((criterion) => criterion.linkedCriteria.length > 0)
    .reduce((sum, criterion) => sum + criterion.linkedCriteria.length, 0);
  const uniqueValueSetKeys = new Set(report.valueSets.map((vs) => vs.values.map((value) => value.code).sort().join(',')));

  return {
    criteriaGroups: report.criteriaGroups?.length ?? 0,
    columnGroups: report.columnGroups?.length ?? 0,
    criteria: criteria.length,
    linkedCriteria,
    valueSets: report.valueSets.length,
    uniqueValueSets: uniqueValueSetKeys.size,
  };
}

function getUniqueValueSets(report: EmisReport): EmisValueSet[] {
  const seen = new Set<string>();
  const unique: EmisValueSet[] = [];
  for (const vs of report.valueSets) {
    const key = vs.values.map((value) => value.code).sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(vs);
  }
  return unique;
}

export function buildRulesMarkdown(report: EmisReport, allReports: EmisReport[]): string {
  const groups = report.criteriaGroups ?? [];
  const colGroups = report.columnGroups ?? [];
  const friendlyNameMap = buildFriendlyNameMap(report);
  const lines: string[] = [];

  const resolveReportName = (reportGuid: string): string => {
    const ref = allReports.find((r) => r.xmlId === reportGuid);
    return ref ? ref.searchName : `${reportGuid.slice(0, 8)}...`;
  };

  const addValueSet = (vs: EmisValueSet, indent: string) => {
    const summary = buildValueSetSummary(vs, friendlyNameMap);
    lines.push(`${indent}- ValueSet friendly name: \`${summary.friendlyName}\``);
    lines.push(`${indent}- Preview: ${summary.preview}`);
    lines.push(`${indent}- Code count: ${summary.codeCount}`);
    lines.push(`${indent}- Code system: ${summary.codeSystem}`);
    if (summary.cluster) {
      lines.push(`${indent}- Cluster: ${summary.cluster}`);
    }
    if (summary.exceptionCount > 0) {
      lines.push(`${indent}- Excluded codes: ${summary.exceptionCount}`);
    }
  };

  const addCriterion = (criterion: SearchCriterion, indent: string) => {
    const criterionSummary = buildCriterionLogicSummary(criterion, friendlyNameMap);
    lines.push(`${indent}- ${criterion.displayName || 'Unnamed criterion'} [${criterion.table}]`);
    if (criterion.negation) {
      lines.push(`${indent}  - NOT`);
    }
    if (criterionSummary.relationship) {
      lines.push(`${indent}  - Linked relationship: ${criterionSummary.relationship.rendered}`);
      if (criterionSummary.relationship.range) {
        if (criterionSummary.relationship.range.from) {
          lines.push(`${indent}    - From: ${criterionSummary.relationship.range.from.rendered}`);
        }
        if (criterionSummary.relationship.range.to) {
          lines.push(`${indent}    - To: ${criterionSummary.relationship.range.to.rendered}`);
        }
      }
    }

    const { dedupedValueSets, extraValueSets, filters, restrictions } = getCriterionDisplayData(criterion);

    if (dedupedValueSets.length > 0) {
      lines.push(`${indent}  - ValueSets:`);
      for (const vs of dedupedValueSets) addValueSet(vs, `${indent}    `);
    }
    if (extraValueSets.length > 0) {
      lines.push(`${indent}  - Additional READCODE ValueSets:`);
      for (const vs of extraValueSets) addValueSet(vs, `${indent}    `);
    }
    if (filters.length > 0) {
      const where = filters.map((filter) => (filter.label ? `${filter.label} ${filter.value}` : filter.value)).join(' AND ');
      lines.push(`${indent}  - Where: ${where}`);
      for (const filter of criterionSummary.filters) {
        lines.push(`${indent}    - Filter detail: ${filter.rendered}`);
        if (filter.range?.from) {
          lines.push(`${indent}      - From boundary: ${filter.range.from.rendered}`);
        }
        if (filter.range?.to) {
          lines.push(`${indent}      - To boundary: ${filter.range.to.rendered}`);
        }
        if (filter.valueSets.length > 0) {
          lines.push(`${indent}      - Filter ValueSets: ${filter.valueSets.map((vs) => `\`${vs.friendlyName}\``).join(', ')}`);
        }
      }
    }
    if (restrictions.length > 0) {
      const then = restrictions.map((restriction) => (restriction.label ? `${restriction.label} ${restriction.value}` : restriction.value)).join(' AND ');
      lines.push(`${indent}  - Then: ${then}`);
      for (const restriction of criterionSummary.restrictions) {
        lines.push(`${indent}    - Restriction detail: ${restriction.description}`);
        if (restriction.recordCount !== null) {
          lines.push(`${indent}      - Record count: ${restriction.recordCount}`);
        }
        if (restriction.direction) {
          lines.push(`${indent}      - Direction: ${restriction.direction}`);
        }
        for (const condition of restriction.conditions) {
          const conditionParts: string[] = [
            `${condition.column} ${condition.operatorSymbol || condition.operator}`,
          ];
          if (condition.valueSets.length > 0) {
            conditionParts.push(condition.valueSets.join(', '));
          }
          if (condition.rangeValues.length > 0) {
            conditionParts.push(condition.rangeValues.join(' and '));
          }
          lines.push(`${indent}      - Condition: ${conditionParts.join(' | ')}`);
        }
      }
    }
    if (criterion.linkedCriteria.length > 0) {
      lines.push(`${indent}  - Linked criteria:`);
      for (const linked of criterion.linkedCriteria) addCriterion(linked, `${indent}    `);
    }
  };

  lines.push(`# ${report.name}`);
  lines.push(`Title: ${report.name}`);
  if (report.searchName !== report.name) lines.push(`Search name: ${report.searchName}`);
  if (report.description) lines.push(`Description: ${report.description}`);
  lines.push(`Parent population: ${getParentPopulation(report, allReports)}`);
  lines.push(`ValueSets: ${report.valueSets.length}`);
  lines.push('');

  if (groups.length > 0) {
    for (let idx = 0; idx < groups.length; idx++) {
      const group = groups[idx];
      let ruleName = `Rule ${idx + 1}`;
      if (groups.length > 1) {
        ruleName += idx === 0 ? ' (Primary)' : ' (Additional)';
      }
      lines.push(`## ${ruleName}`);
      lines.push(`Pass: ${actionLabel(group.actionIfTrue)}`);
      lines.push(`Fail: ${actionLabel(group.actionIfFalse)}`);
      if (group.populationCriteria.length > 0) {
        for (const pc of group.populationCriteria) {
          lines.push(`Patients included in search: ${resolveReportName(pc.reportGuid)}`);
        }
      }
      if (group.criteria.length > 0) {
        lines.push(`Criteria operator: ${group.memberOperator}`);
        for (const criterion of group.criteria) addCriterion(criterion, '');
      } else if (group.libraryItemRefs && group.libraryItemRefs.length > 0) {
        lines.push(`Library item references: ${group.libraryItemRefs.map((ref) => formatLibraryItemReference(ref, allReports)).join(', ')}`);
      } else {
        lines.push('No criteria in this rule.');
      }
      lines.push('');
    }
  }

  if (colGroups.length > 0) {
    lines.push('## Column Groups');
    for (const cg of colGroups) {
      lines.push(`### ${cg.displayName} [${cg.logicalTableName}]`);
      if (cg.listColumns.length > 0) {
        lines.push(`Shows: ${cg.listColumns.map((lc) => lc.displayName).join(', ')}`);
      }
      if (cg.criteria.length > 0) {
        for (const criterion of cg.criteria) addCriterion(criterion, '');
      } else {
        lines.push('No criteria in this column.');
      }
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

function buildCriteriaSearchText(criteria: SearchCriterion[]): string {
  const parts: string[] = [];
  const visit = (criterion: SearchCriterion) => {
    parts.push(criterion.displayName || '');
    parts.push(criterion.table);
    for (const { dedupedValueSets, extraValueSets, filters, restrictions } of [getCriterionDisplayData(criterion)]) {
      for (const vs of [...dedupedValueSets, ...extraValueSets]) {
        parts.push(formatValueSetPreview(vs));
        parts.push(vs.description || '');
        parts.push(vs.values.map((value) => value.displayName).join(' '));
        parts.push(vs.values.map((value) => value.code).join(' '));
      }
      for (const filter of filters) parts.push(`${filter.label} ${filter.value}`);
      for (const restriction of restrictions) parts.push(`${restriction.label} ${restriction.value}`);
    }
    for (const linked of criterion.linkedCriteria) visit(linked);
  };
  for (const criterion of criteria) visit(criterion);
  return parts.join(' ').toLowerCase();
}

function buildCriterionPhrase(criterion: SearchCriterion): string {
  const parts: string[] = [];
  const { dedupedValueSets, extraValueSets, filters, restrictions } = getCriterionDisplayData(criterion);
  const label = criterion.displayName || criterion.table;
  parts.push(`${label} [${criterion.table}]`);
  if (criterion.negation) {
    parts.push('NOT');
  }
  const previewSets = [...dedupedValueSets, ...extraValueSets].map((vs) => formatValueSetPreview(vs));
  if (previewSets.length > 0) {
    parts.push(`with ${previewSets.join(' OR ')}`);
  }
  if (filters.length > 0) {
    parts.push(`where ${filters.map((filter) => filter.label ? `${filter.label} ${filter.value}` : filter.value).join(' AND ')}`);
  }
  if (restrictions.length > 0) {
    parts.push(`then ${restrictions.map((restriction) => restriction.label ? `${restriction.label} ${restriction.value}` : restriction.value).join(' AND ')}`);
  }
  return parts.join(' ');
}

function buildGroupClauseText(group: CriteriaGroup, allReports: EmisReport[]): string {
  const criteriaParts = group.criteria.map((criterion) => buildCriterionPhrase(criterion));
  const populationRefs = group.populationCriteria.map((pc) => {
    const report = allReports.find((candidate) => candidate.xmlId === pc.reportGuid);
    return `patients included in search ${report?.searchName || pc.reportGuid}`;
  });
  const libraryRefs = (group.libraryItemRefs ?? []).map((ref) => formatLibraryItemReference(ref, allReports));
  const allParts = [...populationRefs, ...criteriaParts, ...libraryRefs];
  return allParts.join(` ${group.memberOperator} `);
}

function buildColumnGroupClauseText(group: ColumnGroup): string {
  if (group.criteria.length === 0) {
    return `${group.displayName} [${group.logicalTableName}]`;
  }
  return group.criteria.map((criterion) => buildCriterionPhrase(criterion)).join(' AND ');
}

function getClauseType(passAction: string, failAction: string): RuleDecisionSummary['clauseType'] {
  if (passAction === 'Next rule' && failAction === 'Exclude') return 'must-match';
  if (passAction === 'Exclude' && failAction === 'Next rule') return 'must-not-match';
  if (passAction === 'Include' && failAction === 'Exclude') return 'include-if-match';
  if (passAction === 'Exclude' && failAction === 'Include') return 'include-if-not-match';
  return 'informational';
}

function clauseTextForType(clauseType: RuleDecisionSummary['clauseType'], clauseText: string): string {
  switch (clauseType) {
    case 'must-match':
      return `Must match: ${clauseText}`;
    case 'must-not-match':
      return `Must not match: ${clauseText}`;
    case 'include-if-match':
      return `Included if matches: ${clauseText}`;
    case 'include-if-not-match':
      return `Included if it does not match: ${clauseText}`;
    default:
      return clauseText;
  }
}

function buildDecisionFlow(report: EmisReport, allReports: EmisReport[]): RuleDecisionSummary[] {
  const decisions: RuleDecisionSummary[] = [];
  const friendlyNameMap = buildFriendlyNameMap(report);

  for (let idx = 0; idx < (report.criteriaGroups ?? []).length; idx++) {
    const group = report.criteriaGroups![idx];
    let label = `Rule ${idx + 1}`;
    if ((report.criteriaGroups?.length ?? 0) > 1) {
      label += idx === 0 ? ' (Primary)' : ' (Additional)';
    }
    const passAction = actionLabel(group.actionIfTrue);
    const failAction = actionLabel(group.actionIfFalse);
    const clauseType = getClauseType(passAction, failAction);
    const clauseText = buildGroupClauseText(group, allReports);
    decisions.push({
      kind: 'criteria-group',
      label,
      operator: group.memberOperator,
      passAction,
      failAction,
      clauseType,
      clauseText: clauseTextForType(clauseType, clauseText),
      criteria: group.criteria.map((criterion) => buildCriterionPhrase(criterion)),
      criteriaDetails: group.criteria.map((criterion) => buildCriterionLogicSummary(criterion, friendlyNameMap)),
      populationCriteria: group.populationCriteria.map((pc) => {
        const match = allReports.find((candidate) => candidate.xmlId === pc.reportGuid);
        return {
          xmlId: pc.reportGuid,
          searchName: match?.searchName || pc.reportGuid,
        };
      }),
      libraryItems: (group.libraryItemRefs ?? []).map((ref) => buildLibraryItemReferenceSummary(ref, allReports)),
    });
  }

  for (const group of report.columnGroups ?? []) {
    const clauseText = buildColumnGroupClauseText(group);
    decisions.push({
      kind: 'column-group',
      label: group.displayName,
      operator: 'AND',
      passAction: 'Informational',
      failAction: 'Informational',
      clauseType: 'informational',
      clauseText,
      criteria: group.criteria.map((criterion) => buildCriterionPhrase(criterion)),
      criteriaDetails: group.criteria.map((criterion) => buildCriterionLogicSummary(criterion, friendlyNameMap)),
      populationCriteria: [],
      libraryItems: [],
    });
  }

  return decisions;
}

function buildDependencies(report: EmisReport, allReports: EmisReport[]): ReportDependencySummary {
  const populationCriteriaReports: Array<{ xmlId: string; searchName: string }> = [];
  const libraryItemRefs: string[] = [];
  const libraryItems: LibraryItemReferenceSummary[] = [];

  for (const group of report.criteriaGroups ?? []) {
    for (const pc of group.populationCriteria) {
      const match = allReports.find((candidate) => candidate.xmlId === pc.reportGuid);
      populationCriteriaReports.push({
        xmlId: pc.reportGuid,
        searchName: match?.searchName || pc.reportGuid,
      });
    }
    for (const ref of group.libraryItemRefs ?? []) {
      libraryItemRefs.push(ref);
      libraryItems.push(buildLibraryItemReferenceSummary(ref, allReports));
    }
  }

  const parentPopulationReport = report.parentType === 'POP' && report.parentReportId
    ? (() => {
        const match = allReports.find((candidate) => candidate.xmlId === report.parentReportId);
        return {
          xmlId: report.parentReportId,
          searchName: match?.searchName || report.parentReportId,
        };
      })()
    : null;

  return {
    parentPopulationReport,
    populationCriteriaReports,
    libraryItemRefs,
    libraryItems,
  };
}

function buildAgentInterpretation(report: EmisReport, allReports: EmisReport[]) {
  const decisionFlow = buildDecisionFlow(report, allReports);
  const requiredClauses = decisionFlow
    .filter((decision) => decision.clauseType === 'must-match')
    .map((decision) => decision.clauseText.replace(/^Must match:\s*/, ''));
  const excludedClauses = decisionFlow
    .filter((decision) => decision.clauseType === 'must-not-match')
    .map((decision) => decision.clauseText.replace(/^Must not match:\s*/, ''));
  const finalIncludeClauses = decisionFlow
    .filter((decision) => decision.clauseType === 'include-if-match')
    .map((decision) => decision.clauseText.replace(/^Included if matches:\s*/, ''));
  const finalIncludeNotClauses = decisionFlow
    .filter((decision) => decision.clauseType === 'include-if-not-match')
    .map((decision) => decision.clauseText.replace(/^Included if it does not match:\s*/, ''));

  const booleanLogicParts: string[] = [];
  for (const clause of requiredClauses) booleanLogicParts.push(`(${clause})`);
  for (const clause of excludedClauses) booleanLogicParts.push(`NOT (${clause})`);
  for (const clause of finalIncludeClauses) booleanLogicParts.push(`(${clause})`);
  for (const clause of finalIncludeNotClauses) booleanLogicParts.push(`NOT (${clause})`);

  const summaryParts = [
    `Start with ${getParentPopulation(report, allReports).toLowerCase()}.`,
  ];
  if (requiredClauses.length > 0) {
    summaryParts.push(`Require ${requiredClauses.map((clause) => toSentenceCase(clause)).join('; ')}.`);
  }
  if (excludedClauses.length > 0) {
    summaryParts.push(`Exclude patients who match ${excludedClauses.map((clause) => toSentenceCase(clause)).join('; ')}.`);
  }
  if (finalIncludeClauses.length > 0) {
    summaryParts.push(`Finally include patients who match ${finalIncludeClauses.map((clause) => toSentenceCase(clause)).join('; ')}.`);
  }
  if (finalIncludeNotClauses.length > 0) {
    summaryParts.push(`Finally include patients who do not match ${finalIncludeNotClauses.map((clause) => toSentenceCase(clause)).join('; ')}.`);
  }

  return {
    decisionFlow,
    dependencies: buildDependencies(report, allReports),
    inclusionCriteria: [...requiredClauses, ...finalIncludeClauses],
    exclusionCriteria: excludedClauses,
    booleanLogic: booleanLogicParts.join(' AND ') || null,
    plainEnglishSummary: summaryParts.join(' '),
  };
}

function buildParentChain(report: EmisReport, allReports: EmisReport[]): ParentChainEntry[] {
  const chain: ParentChainEntry[] = [];
  const seen = new Set<string>();
  let current = report;

  while (current.parentType === 'POP' && current.parentReportId) {
    const parent = allReports.find((candidate) => candidate.xmlId === current.parentReportId);
    if (!parent || seen.has(parent.id)) {
      break;
    }
    seen.add(parent.id);
    const friendlyNameMap = buildFriendlyNameMap(parent);
    const uniqueValueSets = getUniqueValueSets(parent).map((vs) => buildValueSetSummary(vs, friendlyNameMap));
    const interpretation = buildAgentInterpretation(parent, allReports);
    chain.push({
      id: parent.id,
      xmlId: parent.xmlId,
      title: parent.name,
      searchName: parent.searchName,
      parentPopulation: getParentPopulation(parent, allReports),
      plainEnglishSummary: interpretation.plainEnglishSummary,
      booleanLogic: interpretation.booleanLogic,
      unresolvedLibraryItemRefs: interpretation.dependencies.libraryItemRefs,
      unresolvedLibraryItems: interpretation.dependencies.libraryItems,
      valueSets: uniqueValueSets.map((vs) => ({
        friendlyName: vs.friendlyName,
        preview: vs.preview,
        codeSystem: vs.codeSystem,
        cluster: vs.cluster,
        codeCount: vs.codeCount,
      })),
    });
    current = parent;
  }

  return chain;
}

function addCriterionDetailMarkdown(lines: string[], criterion: CriterionLogicSummary, indent = '') {
  lines.push(`${indent}- ${criterion.displayName} [${criterion.table}]${criterion.negation ? ' (NOT)' : ''}`);
  if (criterion.valueSets.length > 0) {
    lines.push(`${indent}  - ValueSets: ${criterion.valueSets.map((vs) => `\`${vs.friendlyName}\``).join(', ')}`);
  }
  if (criterion.extraValueSets.length > 0) {
    lines.push(`${indent}  - Additional ValueSets: ${criterion.extraValueSets.map((vs) => `\`${vs.friendlyName}\``).join(', ')}`);
  }
  if (criterion.relationship) {
    lines.push(`${indent}  - Relationship: ${criterion.relationship.rendered}`);
  }
  for (const filter of criterion.filters) {
    lines.push(`${indent}  - Filter: ${filter.rendered}`);
    if (filter.range?.from) {
      lines.push(`${indent}    - From: ${filter.range.from.rendered}`);
    }
    if (filter.range?.to) {
      lines.push(`${indent}    - To: ${filter.range.to.rendered}`);
    }
    if (filter.valueSets.length > 0) {
      lines.push(`${indent}    - Filter ValueSets: ${filter.valueSets.map((vs) => `\`${vs.friendlyName}\``).join(', ')}`);
    }
  }
  for (const restriction of criterion.restrictions) {
    lines.push(`${indent}  - Restriction: ${restriction.description}`);
    for (const condition of restriction.conditions) {
      const parts = [`${condition.column} ${condition.operatorSymbol || condition.operator}`];
      if (condition.valueSets.length > 0) parts.push(condition.valueSets.join(', '));
      if (condition.rangeValues.length > 0) parts.push(condition.rangeValues.join(' and '));
      lines.push(`${indent}    - Condition: ${parts.join(' | ')}`);
    }
  }
  for (const linked of criterion.linkedCriteria) {
    lines.push(`${indent}  - Linked criterion:`);
    addCriterionDetailMarkdown(lines, linked, `${indent}    `);
  }
}

function buildImplementationGuideMarkdown(report: EmisReport, allReports: EmisReport[]) {
  const currentSummary = buildAgentInterpretation(report, allReports);
  const parentChain = buildParentChain(report, allReports);
  const lines: string[] = [];

  lines.push(`# Implementation Guide: ${report.searchName}`);
  lines.push('');
  lines.push(`Target report: ${report.name}`);
  lines.push(`Parent population: ${getParentPopulation(report, allReports)}`);
  lines.push('');
  lines.push('## Parent Chain');
  if (parentChain.length === 0) {
    lines.push('- No parent reports.');
  } else {
    for (const parent of parentChain) {
      lines.push(`- ${parent.searchName}: ${parent.plainEnglishSummary}`);
      if (parent.unresolvedLibraryItems.length > 0) {
        const labels = parent.unresolvedLibraryItems.map((item) =>
          item.inferredName ? `${item.inferredName} (${item.ref})` : item.ref
        );
        lines.push(`  Library refs: ${labels.join(', ')}`);
      }
    }
  }
  lines.push('');
  lines.push('## Library Items');
  if (currentSummary.dependencies.libraryItems.length === 0 && parentChain.every((parent) => parent.unresolvedLibraryItems.length === 0)) {
    lines.push('- None');
  } else {
    for (const parent of parentChain.slice().reverse()) {
      for (const item of parent.unresolvedLibraryItems) {
        const wrapperList = item.wrapperReports.length > 0
          ? `; wrapper reports: ${item.wrapperReports.map((wrapper) => wrapper.searchName).join(', ')}`
          : '';
        lines.push(`- ${parent.searchName}: ${item.inferredName || 'Unknown library item'} (${item.ref})${wrapperList}`);
      }
    }
    for (const item of currentSummary.dependencies.libraryItems) {
      const wrapperList = item.wrapperReports.length > 0
        ? `; wrapper reports: ${item.wrapperReports.map((wrapper) => wrapper.searchName).join(', ')}`
        : '';
      lines.push(`- ${report.searchName}: ${item.inferredName || 'Unknown library item'} (${item.ref})${wrapperList}`);
    }
  }
  lines.push('');
  lines.push('## Target Report Logic');
  lines.push(currentSummary.plainEnglishSummary);
  if (currentSummary.booleanLogic) {
    lines.push('');
    lines.push('Boolean logic:');
    lines.push(currentSummary.booleanLogic);
  }
  lines.push('');
  lines.push('## Detailed Rule Logic');
  for (const rule of currentSummary.decisionFlow) {
    lines.push(`### ${rule.label}`);
    lines.push(`- Clause type: ${rule.clauseType}`);
    lines.push(`- Pass: ${rule.passAction}`);
    lines.push(`- Fail: ${rule.failAction}`);
    if (rule.operator) {
      lines.push(`- Operator: ${rule.operator}`);
    }
    lines.push(`- Summary: ${rule.clauseText}`);
    for (const population of rule.populationCriteria) {
      lines.push(`- Population ref: ${population.searchName} (${population.xmlId})`);
    }
    for (const libraryItem of rule.libraryItems) {
      lines.push(`- Library item: ${libraryItem.inferredName || 'Unknown library item'} (${libraryItem.ref})`);
    }
    for (const criterion of rule.criteriaDetails) {
      addCriterionDetailMarkdown(lines, criterion);
    }
    lines.push('');
  }
  lines.push('');
  lines.push('## ValueSet Friendly Names');

  const addReportValueSets = (label: string, entries: Array<{ friendlyName: string; preview: string; codeSystem: string; cluster: string | null; codeCount: number }>) => {
    lines.push(`### ${label}`);
    for (const entry of entries) {
      lines.push(`- \`${entry.friendlyName}\` (${entry.codeSystem}, ${entry.codeCount} codes): ${entry.preview}${entry.cluster ? ` | Cluster: ${entry.cluster}` : ''}`);
    }
    if (entries.length === 0) {
      lines.push('- None');
    }
  };

  for (const parent of parentChain.slice().reverse()) {
    addReportValueSets(parent.searchName, parent.valueSets);
  }
  const currentFriendlyNameMap = buildFriendlyNameMap(report);
  addReportValueSets(report.searchName, getUniqueValueSets(report).map((vs) => {
    const summary = buildValueSetSummary(vs, currentFriendlyNameMap);
    return {
      friendlyName: summary.friendlyName,
      preview: summary.preview,
      codeSystem: summary.codeSystem,
      cluster: summary.cluster,
      codeCount: summary.codeCount,
    };
  }));

  return lines.join('\n').trim();
}

function buildLibraryItemSearchText(report: EmisReport, allReports: EmisReport[]): string {
  const parts: string[] = [];
  for (const group of report.criteriaGroups ?? []) {
    for (const ref of group.libraryItemRefs ?? []) {
      const summary = buildLibraryItemReferenceSummary(ref, allReports);
      parts.push(ref);
      parts.push(summary.inferredName || '');
      for (const wrapper of summary.wrapperReports) {
        parts.push(wrapper.searchName);
        parts.push(wrapper.title);
      }
    }
  }
  return parts.join(' ').toLowerCase();
}

export function buildReportSearchText(report: EmisReport, allReports: EmisReport[]): string {
  const friendlyNameMap = buildFriendlyNameMap(report);
  const criteriaText = [
    ...(report.criteriaGroups ?? []).map((group) => buildCriteriaSearchText(group.criteria)),
    ...(report.columnGroups ?? []).map((group) => buildCriteriaSearchText(group.criteria)),
  ].join(' ');
  const valueSetText = getUniqueValueSets(report)
    .map((vs) => [
      friendlyNameMap.get(vs.id) || '',
      formatValueSetPreview(vs),
      vs.description || '',
      vs.values.map((value) => value.displayName).join(' '),
      vs.values.map((value) => value.code).join(' '),
    ].join(' '))
    .join(' ');

  return [
    report.id,
    report.xmlId,
    report.name,
    report.searchName,
    report.description || '',
    report.rule,
    report.reportType,
    getParentPopulation(report, allReports),
    criteriaText,
    valueSetText,
    buildLibraryItemSearchText(report, allReports),
  ].join(' ').toLowerCase();
}

export function buildReportLogicSummary(report: EmisReport, allReports: EmisReport[]) {
  const friendlyNameMap = buildFriendlyNameMap(report);
  const counts = getReportCounts(report);
  const uniqueValueSets = getUniqueValueSets(report);
  const agentInterpretation = buildAgentInterpretation(report, allReports);
  const parentChain = buildParentChain(report, allReports);
  return {
    id: report.id,
    xmlId: report.xmlId,
    title: report.name,
    searchName: report.searchName,
    description: report.description || null,
    folderPath: report.rule,
    reportType: report.reportType,
    parentPopulation: getParentPopulation(report, allReports),
    counts,
    agentInterpretation,
    parentChain,
    valueSets: uniqueValueSets.map((vs) => buildValueSetSummary(vs, friendlyNameMap)),
    logicMarkdown: buildRulesMarkdown(report, allReports),
    implementationGuideMarkdown: buildImplementationGuideMarkdown(report, allReports),
  };
}

export function buildReportIndexEntry(report: EmisReport, allReports: EmisReport[]) {
  const dependencies = buildDependencies(report, allReports);
  return {
    id: report.id,
    xmlId: report.xmlId,
    title: report.name,
    searchName: report.searchName,
    description: report.description || null,
    folderPath: report.rule,
    reportType: report.reportType,
    parentPopulation: getParentPopulation(report, allReports),
    counts: getReportCounts(report),
    libraryItems: dependencies.libraryItems,
  };
}

export function buildDocumentGraph(reports: EmisReport[]) {
  const nodes: Array<{ id: string; type: string; label: string; metadata?: Record<string, string | number | boolean | null> }> = [];
  const edges: Array<{ from: string; to: string; type: string; label: string }> = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();
  const addNode = (id: string, type: string, label: string, metadata?: Record<string, string | number | boolean | null>) => {
    if (seenNodes.has(id)) return;
    seenNodes.add(id);
    nodes.push({ id, type, label, metadata });
  };
  const addEdge = (from: string, to: string, type: string, label: string) => {
    const key = `${from}|${to}|${type}|${label}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from, to, type, label });
  };

  for (const report of reports) {
    const friendlyNameMap = buildFriendlyNameMap(report);
    addNode(`report:${report.id}`, 'report', report.searchName, {
      title: report.name,
      folderPath: report.rule,
      reportType: report.reportType,
    });

    if (report.parentType === 'POP' && report.parentReportId) {
      const parent = reports.find((candidate) => candidate.xmlId === report.parentReportId);
      const parentNodeId = parent ? `report:${parent.id}` : `external-report:${report.parentReportId}`;
      addNode(parentNodeId, parent ? 'report' : 'external-report', parent?.searchName || report.parentReportId);
      addEdge(`report:${report.id}`, parentNodeId, 'parent-population', 'parent population');
    }

    const addCriteriaEdges = (criteria: SearchCriterion[]) => {
      for (const criterion of criteria) {
        for (const vs of criterion.valueSets) {
          addNode(`valueset:${vs.id}`, 'valueset', friendlyNameMap.get(vs.id) || vs.id, {
            codeCount: vs.values.length,
            cluster: vs.description || null,
          });
          addEdge(`report:${report.id}`, `valueset:${vs.id}`, 'uses-valueset', criterion.displayName || criterion.table);
        }
        for (const linked of criterion.linkedCriteria) addCriteriaEdges([linked]);
      }
    };

    for (const group of report.criteriaGroups ?? []) {
      for (const populationRef of group.populationCriteria) {
        const target = reports.find((candidate) => candidate.xmlId === populationRef.reportGuid);
        const targetNodeId = target ? `report:${target.id}` : `external-report:${populationRef.reportGuid}`;
        addNode(targetNodeId, target ? 'report' : 'external-report', target?.searchName || populationRef.reportGuid);
        addEdge(`report:${report.id}`, targetNodeId, 'population-criteria', 'patients included in search');
      }
        for (const libraryRef of group.libraryItemRefs ?? []) {
          const libraryNodeId = `library-item:${libraryRef}`;
        const summary = buildLibraryItemReferenceSummary(libraryRef, reports);
        addNode(libraryNodeId, 'library-item', summary.inferredName || libraryRef, {
          ref: libraryRef,
          inferredName: summary.inferredName,
          wrapperReportCount: summary.wrapperReports.length,
        });
        addEdge(`report:${report.id}`, libraryNodeId, 'library-item', 'library item ref');
      }
      addCriteriaEdges(group.criteria);
    }

    for (const group of report.columnGroups ?? []) {
      addCriteriaEdges(group.criteria);
    }
  }

  return { nodes, edges };
}
