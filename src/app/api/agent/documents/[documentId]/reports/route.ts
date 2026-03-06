import { NextRequest, NextResponse } from 'next/server';
import { loadAgentDocument } from '@/lib/agent-document-store';
import { buildReportIndexEntry } from '@/lib/agent-report-utils';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;
  const stored = await loadAgentDocument(documentId);

  if (!stored) {
    return NextResponse.json(
      { success: false, error: `Document not found: ${documentId}` },
      { status: 404 }
    );
  }

  const reports = stored.data.reports.map((report) => buildReportIndexEntry(report, stored.data.reports));

  return NextResponse.json({
    success: true,
    schemaVersion: '1',
    document: {
      id: stored.id,
      fileName: stored.fileName,
      createdAt: stored.createdAt,
      reportCount: reports.length,
    },
    reports,
  });
}
