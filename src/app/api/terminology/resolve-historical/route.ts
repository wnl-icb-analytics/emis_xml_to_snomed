import { NextRequest, NextResponse } from 'next/server';
import { ResolveHistoricalRequest, ResolveHistoricalResponse } from '@/lib/types';
import { resolveHistoricalConcept } from '@/lib/terminology-client';
import { sequentialWithDelay } from '@/lib/concurrency';

export async function POST(request: NextRequest) {
  try {
    const body: ResolveHistoricalRequest = await request.json();
    const { conceptIds } = body;

    if (!conceptIds || conceptIds.length === 0) {
      return NextResponse.json<ResolveHistoricalResponse>(
        { success: false, error: 'No concept IDs provided' },
        { status: 400 }
      );
    }

    const uniqueIds = [...new Set(conceptIds)];
    console.log(`Resolving ${uniqueIds.length} unique concepts for historical associations...`);

    const resolutions: Record<string, { currentConceptId: string; isHistorical: boolean; display?: string }> = {};

    await sequentialWithDelay(uniqueIds, async (conceptId) => {
      resolutions[conceptId] = await resolveHistoricalConcept(conceptId);
    }, 10);

    const historicalCount = Object.values(resolutions).filter(r => r.isHistorical).length;
    console.log(`Historical resolution complete: ${historicalCount} historical concepts updated`);

    return NextResponse.json<ResolveHistoricalResponse>({
      success: true,
      resolutions,
    });
  } catch (error) {
    console.error('Historical resolution error:', error);
    return NextResponse.json<ResolveHistoricalResponse>(
      { success: false, error: error instanceof Error ? error.message : 'Resolution failed' },
      { status: 500 }
    );
  }
}

export const maxDuration = 300;
