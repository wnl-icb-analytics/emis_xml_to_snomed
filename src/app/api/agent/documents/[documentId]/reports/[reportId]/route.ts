import { NextRequest, NextResponse } from 'next/server';
import { loadAgentDocument } from '@/lib/agent-document-store';
import { buildReportLogicSummary } from '@/lib/agent-report-utils';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string; reportId: string }> }
) {
  const { documentId, reportId } = await params;
  const stored = await loadAgentDocument(documentId);

  if (!stored) {
    return NextResponse.json(
      { success: false, error: `Document not found: ${documentId}` },
      { status: 404 }
    );
  }

  const report = stored.data.reports.find((candidate) =>
    candidate.id === reportId ||
    candidate.xmlId === reportId ||
    candidate.searchName === reportId
  );

  if (!report) {
    return NextResponse.json(
      { success: false, error: `Report not found: ${reportId}` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    schemaVersion: '1',
    document: {
      id: stored.id,
      fileName: stored.fileName,
    },
    report: buildReportLogicSummary(report, stored.data.reports),
    raw: {
      criteriaGroups: report.criteriaGroups ?? [],
      columnGroups: report.columnGroups ?? [],
      valueSets: report.valueSets,
    },
  });
}
