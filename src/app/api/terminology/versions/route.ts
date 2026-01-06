import { NextResponse } from 'next/server';
import { getPrimaryConceptMapId, getFallbackConceptMapId, getConceptMapVersions } from '@/lib/concept-map-resolver';
import { getAccessToken } from '@/lib/oauth-client';
import { getRF2VersionInfo } from '@/lib/rf2-version';
import { getLatestRF2Release, isNewerThanLocal } from '@/lib/trud-client';

/**
 * GET /api/terminology/versions
 * Returns the current ConceptMap and RF2 versions being used by the system
 * Actively resolves versions if not yet cached
 * Also checks TRUD for newer RF2 releases if API key is configured
 */
export async function GET() {
  try {
    // Get OAuth token
    const token = await getAccessToken();

    // Trigger ConceptMap resolution if not already cached (this will populate the cache)
    await Promise.all([
      getPrimaryConceptMapId(token),
      getFallbackConceptMapId(token),
    ]);

    // Get cached ConceptMap versions
    const conceptMapVersions = getConceptMapVersions();

    // Get RF2 version info
    const rf2Version = getRF2VersionInfo();

    // Check TRUD for updates (non-blocking)
    let rf2Update = null;
    if (rf2Version) {
      const latestRelease = await getLatestRF2Release();
      if (latestRelease && isNewerThanLocal(latestRelease, rf2Version.releaseId)) {
        rf2Update = {
          available: true,
          releaseName: latestRelease.name,
          releaseDate: latestRelease.releaseDate,
          downloadUrl: latestRelease.archiveFileUrl,
        };
      }
    }

    return NextResponse.json({
      conceptMaps: conceptMapVersions,
      rf2: rf2Version,
      rf2Update,
    });
  } catch (error) {
    console.error('Error fetching versions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch versions' },
      { status: 500 }
    );
  }
}
