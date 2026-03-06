import { NextRequest, NextResponse } from 'next/server';
import { parseXmlBlobToSession } from '@/lib/blob-xml';
import { saveAgentDocument } from '@/lib/agent-document-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { pathname?: string };

    if (!body.pathname) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: pathname' },
        { status: 400 }
      );
    }

    const loaded = await parseXmlBlobToSession(body.pathname);
    const stored = await saveAgentDocument(loaded.fileName, loaded.xmlContent, loaded.parsedData);

    return NextResponse.json({
      success: true,
      schemaVersion: '1',
      document: {
        id: stored.id,
        fileName: stored.fileName,
        createdAt: stored.createdAt,
        xmlSha256: stored.xmlSha256,
        reportCount: stored.data.reports.length,
        parsedAt: stored.data.parsedAt,
        pathname: body.pathname,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load XML document from blob',
      },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
