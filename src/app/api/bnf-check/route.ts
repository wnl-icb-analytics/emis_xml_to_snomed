import { NextRequest, NextResponse } from 'next/server';
import { fetchBnfSections, findBnfSection } from '@/lib/bnf-sections';

// fetchBnfSections uses 'use cache' directive, so results are cached automatically

/**
 * Proxy endpoint to check OpenPrescribing BNF page for matching sections
 * Uses Next.js cache to fetch fresh data on app reload
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const displayName = searchParams.get('displayName');

    if (!displayName) {
      return NextResponse.json(
        { error: 'displayName parameter is required' },
        { status: 400 }
      );
    }

    // Fetch BNF sections (cached via 'use cache' directive)
    const bnfSections = await fetchBnfSections();

    // Search for match
    const match = findBnfSection(displayName, bnfSections);

    if (match) {
      return NextResponse.json({ match });
    }

    return NextResponse.json({ match: null });
  } catch (error: any) {
    if (error?.digest === 'NEXT_PRERENDER_INTERRUPTED') throw error;
    console.error('BNF check error:', error);
    return NextResponse.json(
      { error: 'Failed to check BNF sections' },
      { status: 500 }
    );
  }
}
