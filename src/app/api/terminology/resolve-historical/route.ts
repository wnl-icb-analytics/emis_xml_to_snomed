import { NextRequest, NextResponse } from 'next/server';
import { ResolveHistoricalRequest, ResolveHistoricalResponse } from '@/lib/types';
import { batchResolveHistorical } from '@/lib/terminology-client';

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
    console.log(`Batch resolving ${uniqueIds.length} unique concepts for historical associations...`);

    const resolutions = await batchResolveHistorical(uniqueIds);

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
