/**
 * TRUD (Technology Reference data Update Distribution) API client
 * Used to check for newer SNOMED CT RF2 releases
 */

const TRUD_API_BASE = 'https://isd.digital.nhs.uk/trud/api/v1';
const UK_PRIMARY_CARE_ITEM_ID = '659'; // SNOMED CT UK Primary Care refset

interface TRUDRelease {
  id: string;
  name: string;
  releaseDate: string;
  archiveFileUrl: string;
  archiveFileName: string;
  archiveFileSizeBytes: number;
  archiveFileSha256: string;
}

interface TRUDResponse {
  apiVersion: string;
  releases: TRUDRelease[];
  httpStatus: number;
  message: string;
}

/**
 * Gets the latest SNOMED CT UK Primary Care RF2 release from TRUD
 * Returns null if TRUD_API_KEY is not configured or request fails
 */
export async function getLatestRF2Release(): Promise<TRUDRelease | null> {
  const apiKey = process.env.TRUD_API_KEY;

  if (!apiKey) {
    console.warn('TRUD_API_KEY not configured, skipping RF2 update check');
    return null;
  }

  try {
    // TRUD API uses the key in the URL path, not as a header
    const url = `${TRUD_API_BASE}/keys/${apiKey}/items/${UK_PRIMARY_CARE_ITEM_ID}/releases?latest`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`TRUD API request failed: ${response.status}`);
      console.warn(`Error details: ${errorText}`);
      return null;
    }

    const data: TRUDResponse = await response.json();

    if (data.releases && data.releases.length > 0) {
      // Return the most recent release (first in array)
      return data.releases[0];
    }

    return null;
  } catch (error) {
    console.warn('Error fetching latest RF2 release from TRUD:', error);
    return null;
  }
}

/**
 * Extracts the release date from a TRUD release and compares with local version
 * Returns true if TRUD has a newer version
 */
export function isNewerThanLocal(
  trudRelease: TRUDRelease,
  localReleaseId: string
): boolean {
  try {
    // Extract date from TRUD archive filename
    // Format: uk_sct2pc_59.0.0_20251211000000Z.zip
    const fileMatch = trudRelease.archiveFileName?.match(/_(\d{14})Z/);

    if (fileMatch) {
      const trudDate = fileMatch[1].substring(0, 8); // Extract YYYYMMDD from timestamp
      const localDate = localReleaseId.substring(0, 8); // Extract YYYYMMDD from release ID
      return trudDate > localDate;
    }

    // Fallback: try to extract date from release name
    const trudDateMatch = trudRelease.name.match(/(\d{8})/);
    if (trudDateMatch) {
      const trudDate = trudDateMatch[1]; // YYYYMMDD
      const localDate = localReleaseId.substring(0, 8);
      return trudDate > localDate;
    }

    console.warn('Could not extract date from TRUD release:', trudRelease);
    return false;
  } catch (error) {
    console.warn('Error comparing RF2 versions:', error);
    return false;
  }
}
