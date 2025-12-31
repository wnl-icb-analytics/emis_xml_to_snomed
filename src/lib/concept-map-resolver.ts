import { getAccessToken } from './oauth-client';

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
        Accept: 'application/fhir+json',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn(`Failed to resolve ConceptMap from canonical URL ${canonicalUrl}: ${response.status}`);
      return null;
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
    console.warn(`Error resolving ConceptMap from canonical URL ${canonicalUrl}:`, error);
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
