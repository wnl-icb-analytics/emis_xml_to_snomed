import { NextRequest, NextResponse } from 'next/server';
import { TranslateCodesRequest, TranslateCodesResponse, TranslatedCode } from '@/lib/types';
import { translateEmisCodeToSnomed } from '@/lib/terminology-client';
import { sequentialWithDelay } from '@/lib/concurrency';

export async function POST(request: NextRequest) {
  try {
    const body: TranslateCodesRequest = await request.json();
    const { codes, equivalenceFilter } = body;

    if (!codes || codes.length === 0) {
      return NextResponse.json<TranslateCodesResponse>(
        { success: false, error: 'No codes provided' },
        { status: 400 }
      );
    }

    const uniqueCodes = [...new Set(codes)];
    console.log(`Translating ${uniqueCodes.length} unique EMIS codes (filter: ${equivalenceFilter})...`);

    const translations: Record<string, TranslatedCode | null> = {};

    await sequentialWithDelay(uniqueCodes, async (code) => {
      translations[code] = await translateEmisCodeToSnomed(code, equivalenceFilter);
    }, 10);

    const successCount = Object.values(translations).filter(t => t !== null).length;
    console.log(`Translation complete: ${successCount}/${uniqueCodes.length} successful`);

    return NextResponse.json<TranslateCodesResponse>({
      success: true,
      translations,
    });
  } catch (error) {
    console.error('Translation error:', error);
    return NextResponse.json<TranslateCodesResponse>(
      { success: false, error: error instanceof Error ? error.message : 'Translation failed' },
      { status: 500 }
    );
  }
}

export const maxDuration = 300;
