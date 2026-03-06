import { NextRequest, NextResponse } from 'next/server';
import { loadAgentDocument } from '@/lib/agent-document-store';
import { buildReportIndexEntry, buildReportSearchText } from '@/lib/agent-report-utils';

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

  const q = request.nextUrl.searchParams.get('q')?.trim().toLowerCase() || '';
  if (!q) {
    return NextResponse.json(
      { success: false, error: 'Missing required query parameter: q' },
      { status: 400 }
    );
  }

  const results = stored.data.reports
    .filter((report) => buildReportSearchText(report, stored.data.reports).includes(q))
    .map((report) => buildReportIndexEntry(report, stored.data.reports));

  return NextResponse.json({
    success: true,
    schemaVersion: '1',
    query: q,
    resultCount: results.length,
    results,
  });
}
