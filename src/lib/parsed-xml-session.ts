import type { EmisXmlDocument } from '@/lib/types';

export function buildMinimalParsedXmlData(parsedData: EmisXmlDocument, fileName: string) {
  return {
    fileName,
    namespace: parsedData.namespace,
    parsedAt: parsedData.parsedAt,
    reports: parsedData.reports.map((report) => ({
      id: report.id,
      xmlId: report.xmlId,
      name: report.name,
      searchName: report.searchName,
      description: report.description,
      parentType: report.parentType,
      parentReportId: report.parentReportId,
      rule: report.rule,
      valueSets: report.valueSets.map((vs) => ({
        id: vs.id,
        codeSystem: vs.codeSystem,
        description: vs.description,
        values: vs.values.map((value) => ({
          code: value.code,
          includeChildren: value.includeChildren,
          isRefset: value.isRefset,
          displayName: value.displayName && value.displayName !== value.code ? value.displayName : undefined,
        })),
        exceptions: vs.exceptions.map((exception) => exception.code),
      })),
      reportType: report.reportType,
      criteriaGroups: report.criteriaGroups,
      columnGroups: report.columnGroups,
    })),
  };
}
