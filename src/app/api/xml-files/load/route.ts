import { NextRequest, NextResponse } from 'next/server';
import { parseXmlBlobToSession } from '@/lib/blob-xml';

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

    return NextResponse.json({
      success: true,
      fileName: loaded.fileName,
      data: loaded.minimalData,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load XML file',
      },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
