import { NextResponse } from 'next/server';
import { getAllConceptMapVersions, EMIS_TO_SNOMED_CANONICAL_URL, EMIS_TO_SNOMED_FALLBACK_CANONICAL_URL } from '@/lib/concept-map-resolver';
import { getAccessToken } from '@/lib/oauth-client';

/**
 * GET /api/terminology/concept-map-versions?type=primary|fallback
 * Returns all available versions of EMIS→SNOMED ConceptMaps
 * - type=primary: CodeID ConceptMap (default)
 * - type=fallback: DrugCodeID ConceptMap
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'primary';

    // Get OAuth token
    const token = await getAccessToken();

    // Select the appropriate canonical URL based on type
    const canonicalUrl = type === 'fallback'
      ? EMIS_TO_SNOMED_FALLBACK_CANONICAL_URL
      : EMIS_TO_SNOMED_CANONICAL_URL;

    // Get all versions of the ConceptMap
    const versions = await getAllConceptMapVersions(canonicalUrl, token);

    return NextResponse.json({
      versions,
      canonicalUrl,
      type,
    });
  } catch (error: any) {
    if (error?.digest === 'NEXT_PRERENDER_INTERRUPTED') throw error;
    console.error('Error fetching ConceptMap versions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ConceptMap versions' },
      { status: 500 }
    );
  }
}
