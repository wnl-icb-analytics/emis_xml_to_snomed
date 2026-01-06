import { NextRequest, NextResponse } from 'next/server';
import { parseEmisXml } from '@/lib/xml-parser';
import { ParseXmlRequest, ParseXmlResponse } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    // Handle FormData upload instead of JSON to avoid body size limits
    const formData = await request.formData();
    const xmlFile = formData.get('xmlFile') as File | null;

    if (!xmlFile) {
      return NextResponse.json<ParseXmlResponse>(
        { success: false, error: 'No XML file provided' },
        { status: 400 }
      );
    }

    const xmlContent = await xmlFile.text();
    const parsedData = await parseEmisXml(xmlContent);

    return NextResponse.json<ParseXmlResponse>({
      success: true,
      data: parsedData,
    });
  } catch (error) {
    console.error('XML parsing error:', error);
    return NextResponse.json<ParseXmlResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to parse XML',
      },
      { status: 500 }
    );
  }
}
export const maxDuration = 30;
// Body size limit is configured in next.config.ts via middlewareClientMaxBodySize
