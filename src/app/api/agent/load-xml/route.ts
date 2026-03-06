import { NextRequest, NextResponse } from 'next/server';
import { parseEmisXml } from '@/lib/xml-parser';
import { saveAgentDocument } from '@/lib/agent-document-store';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const xmlFile = formData.get('xmlFile') as File | null;

    if (!xmlFile) {
      return NextResponse.json(
        { success: false, error: 'No XML file provided' },
        { status: 400 }
      );
    }

    const xmlContent = await xmlFile.text();
    const parsedData = await parseEmisXml(xmlContent);
    const stored = await saveAgentDocument(xmlFile.name || 'uploaded.xml', xmlContent, parsedData);

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
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load XML document',
      },
      { status: 500 }
    );
  }
}

export const maxDuration = 30;
