import { getAccessToken } from './oauth-client';
import { handleFhirResponse } from './fhir-error-handler';

const TERMINOLOGY_SERVER_BASE =
  process.env.TERMINOLOGY_SERVER ||
  'https://ontology.onelondon.online/production1/fhir';

// Canonical URLs for ConceptMaps (version-agnostic)
export const EMIS_TO_SNOMED_CANONICAL_URL = 'http://LDS.nhs/EMIStoSNOMED/CodeID/cm';
export const EMIS_TO_SNOMED_FALLBACK_CANONICAL_URL = 'http://LDS.nhs/EMIS_to_Snomed/DrugCodeID/cm';

// Fallback IDs if canonical URL resolution fails
export const EMIS_TO_SNOMED_FALLBACK_ID = '8d2953a3-b70b-4727-8a6a-8b4d912535ad'; // Version 2.1.0
export const EMIS_TO_SNOMED_DRUG_FALLBACK_ID = 'b5519813-31eb-4cad-8c77-b8999420e3c9'; // Version 7.1

// Cache for resolved ConceptMap IDs and versions
let cachedPrimaryConceptMapId: string | null = null;
let cachedPrimaryConceptMapVersion: string | null = null;
let cachedFallbackConceptMapId: string | null = null;
let cachedFallbackConceptMapVersion: string | null = null;

/**
 * Resolves the latest active ConceptMap ID from a canonical URL
 * Returns the ID and version, or null if resolution fails
 * Uses standardized FHIR error handling - only 404 is treated as "not found"
 * Auth/rate-limit errors throw to alert about system issues
 */
export async function resolveLatestConceptMap(
  canonicalUrl: string,
  token: string
): Promise<{ id: string; version: string } | null> {
  try {
    const url = `${TERMINOLOGY_SERVER_BASE}/ConceptMap?url=${encodeURIComponent(canonicalUrl)}&_sort=-version&_count=1&status=active`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/fhir+json; charset=utf-8',
      },
      signal: AbortSignal.timeout(5000),
    });

    // Use standardized error handling - 404 returns null, other errors throw
    const errorResult = await handleFhirResponse(response, {
      overrides: { 404: 'RETURN_NULL' },
      context: `resolving ConceptMap from ${canonicalUrl}`
    });

    if (errorResult !== null) {
      return null; // 404 - ConceptMap not found
    }

    const bundle = await response.json();

    if (bundle.entry && bundle.entry.length > 0) {
      const resource = bundle.entry[0].resource;
      return {
        id: resource.id,
        version: resource.version,
      };
    }

    return null;
  } catch (error) {
    // Log the error and return null to trigger fallback to hardcoded ID
    console.warn(`Error resolving ConceptMap from canonical URL ${canonicalUrl}, will use fallback ID:`, error);
    return null;
  }
}

/**
 * Resolves a ConceptMap ID by canonical URL and version
 * If version is "latest", resolves the latest active version
 * Otherwise, resolves the specific version requested
 * Returns the ID or null if resolution fails
 */
export async function resolveConceptMapByVersion(
  canonicalUrl: string,
  version: string,
  token: string
): Promise<{ id: string; version: string } | null> {
  try {
    if (version === 'latest') {
      return await resolveLatestConceptMap(canonicalUrl, token);
    }

    // Search for specific version
    const url = `${TERMINOLOGY_SERVER_BASE}/ConceptMap?url=${encodeURIComponent(canonicalUrl)}&version=${encodeURIComponent(version)}&_count=1`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/fhir+json; charset=utf-8',
      },
      signal: AbortSignal.timeout(5000),
    });

    // Use standardized error handling - 404 returns null, other errors throw
    const errorResult = await handleFhirResponse(response, {
      overrides: { 404: 'RETURN_NULL' },
      context: `resolving ConceptMap version ${version} from ${canonicalUrl}`
    });

    if (errorResult !== null) {
      return null; // 404 - ConceptMap version not found
    }

    const bundle = await response.json();

    if (bundle.entry && bundle.entry.length > 0) {
      const resource = bundle.entry[0].resource;
      return {
        id: resource.id,
        version: resource.version,
      };
    }

    return null;
  } catch (error) {
    console.warn(`Error resolving ConceptMap version ${version} from ${canonicalUrl}:`, error);
    return null;
  }
}

/**
 * Gets the primary ConceptMap ID, resolving from canonical URL on first call
 * Falls back to hardcoded ID if resolution fails
 */
export async function getPrimaryConceptMapId(token: string): Promise<string> {
  if (cachedPrimaryConceptMapId) {
    return cachedPrimaryConceptMapId;
  }

  const resolved = await resolveLatestConceptMap(EMIS_TO_SNOMED_CANONICAL_URL, token);

  if (resolved) {
    cachedPrimaryConceptMapId = resolved.id;
    cachedPrimaryConceptMapVersion = resolved.version;
    console.log(`Using EMIS→SNOMED ConceptMap version ${resolved.version} (ID: ${resolved.id})`);
    return resolved.id;
  }

  // Fall back to hardcoded ID
  console.warn(`Failed to resolve latest ConceptMap, falling back to hardcoded ID`);
  cachedPrimaryConceptMapId = EMIS_TO_SNOMED_FALLBACK_ID;
  return EMIS_TO_SNOMED_FALLBACK_ID;
}

/**
 * Gets the fallback ConceptMap ID, resolving from canonical URL on first call
 * Falls back to hardcoded ID if resolution fails
 */
export async function getFallbackConceptMapId(token: string): Promise<string> {
  if (cachedFallbackConceptMapId) {
    return cachedFallbackConceptMapId;
  }

  const resolved = await resolveLatestConceptMap(EMIS_TO_SNOMED_FALLBACK_CANONICAL_URL, token);

  if (resolved) {
    cachedFallbackConceptMapId = resolved.id;
    cachedFallbackConceptMapVersion = resolved.version;
    console.log(`Using EMIS→SNOMED DrugCodeID ConceptMap version ${resolved.version} (ID: ${resolved.id})`);
    return resolved.id;
  }

  // Fall back to hardcoded ID
  console.warn(`Failed to resolve latest fallback ConceptMap, falling back to hardcoded ID`);
  cachedFallbackConceptMapId = EMIS_TO_SNOMED_DRUG_FALLBACK_ID;
  return EMIS_TO_SNOMED_DRUG_FALLBACK_ID;
}

/**
 * Gets the currently cached ConceptMap versions for display purposes
 */
export function getConceptMapVersions(): {
  primary: string | null;
  fallback: string | null;
} {
  return {
    primary: cachedPrimaryConceptMapVersion,
    fallback: cachedFallbackConceptMapVersion,
  };
}

/**
 * Fetches all available versions of a ConceptMap by canonical URL
 * Returns sorted by version descending (newest first)
 */
export async function getAllConceptMapVersions(
  canonicalUrl: string,
  token: string
): Promise<Array<{ id: string; version: string; status: string }>> {
  try {
    const url = `${TERMINOLOGY_SERVER_BASE}/ConceptMap?url=${encodeURIComponent(canonicalUrl)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/fhir+json; charset=utf-8',
      },
      signal: AbortSignal.timeout(10000),
    });

    const errorResult = await handleFhirResponse(response, {
      overrides: { 404: 'RETURN_NULL' },
      context: `fetching all ConceptMap versions from ${canonicalUrl}`
    });

    if (errorResult !== null) {
      return []; // 404 - ConceptMap not found
    }

    const bundle = await response.json();

    if (bundle.entry && bundle.entry.length > 0) {
      const versions = bundle.entry.map((entry: any) => ({
        id: entry.resource.id,
        version: entry.resource.version,
        status: entry.resource.status,
      }));

      // Sort by version descending (newest first)
      // Assumes semantic versioning (e.g., "2.1.4", "2.1.3", etc.)
      versions.sort((a: { id: string; version: string; status: string }, b: { id: string; version: string; status: string }) => {
        const aParts = a.version.split('.').map(Number);
        const bParts = b.version.split('.').map(Number);

        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const aNum = aParts[i] || 0;
          const bNum = bParts[i] || 0;
          if (aNum !== bNum) {
            return bNum - aNum; // Descending
          }
        }
        return 0;
      });

      return versions;
    }

    return [];
  } catch (error) {
    console.warn(`Error fetching all ConceptMap versions from ${canonicalUrl}:`, error);
    return [];
  }
}
