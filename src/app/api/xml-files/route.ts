import { NextResponse } from 'next/server';
import { listXmlBlobFiles } from '@/lib/blob-xml';

export async function GET() {
  try {
    const files = await listXmlBlobFiles();
    return NextResponse.json({
      success: true,
      files,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list XML files',
      },
      { status: 500 }
    );
  }
}
