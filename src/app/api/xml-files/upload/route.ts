import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { normalizeXmlFileName } from '@/lib/blob-xml';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const fileName = normalizeXmlFileName(pathname);

        return {
          allowedContentTypes: ['text/xml', 'application/xml'],
          maximumSizeInBytes: 1024 * 1024 * 100,
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify({ fileName }),
        };
      },
      onUploadCompleted: async () => {
        return;
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to prepare upload',
      },
      { status: 400 }
    );
  }
}
