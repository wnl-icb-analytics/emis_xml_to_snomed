import { NextResponse } from 'next/server';
import { loadAgentDocument } from '@/lib/agent-document-store';
import { buildReportIndexEntry } from '@/lib/agent-report-utils';

export async function GET(
  request: Request,
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

  return NextResponse.json({
    success: true,
    schemaVersion: '1',
    document: {
      id: stored.id,
      fileName: stored.fileName,
      createdAt: stored.createdAt,
      xmlSha256: stored.xmlSha256,
      parsedAt: stored.data.parsedAt,
      reportCount: stored.data.reports.length,
      reports: stored.data.reports.map((report) => buildReportIndexEntry(report, stored.data.reports)),
    },
  });
}
