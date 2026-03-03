import { getAccessToken } from './oauth-client';
import { FhirValueSetExpansion, SnomedConcept, ConceptMapTranslateResponse, TranslatedCode, EquivalenceFilter } from './types';
import { getPrimaryConceptMapId, getFallbackConceptMapId, getConceptMapVersions as _getConceptMapVersions } from './concept-map-resolver';
import { handleFhirResponse } from './fhir-error-handler';
import { withRetry, isRetryableStatus, sequentialWithDelay } from './concurrency';

const TERMINOLOGY_SERVER_BASE =
  process.env.TERMINOLOGY_SERVER ||
  'https://ontology.onelondon.online/production1/fhir';

const EMIS_CODE_SYSTEM = 'http://LDS.nhs/EMIS/CodeID/cs';
const SNOMED_CODE_SYSTEM = 'http://snomed.info/sct';

// Default: Only accept equivalent or narrower mappings
const ACCEPTED_EQUIVALENCES = ['equivalent', 'narrower'];

/**
 * Gets the list of accepted equivalences based on the filter setting
 */
function getAcceptedEquivalences(filter: EquivalenceFilter): string[] {
  switch (filter) {
    case 'strict':
      return ['equivalent', 'narrower'];
    case 'with-broader':
      return ['equivalent', 'narrower', 'broader'];
    case 'with-related':
      return ['equivalent', 'narrower', 'related-to'];
    case 'all':
      return ['equivalent', 'narrower', 'broader', 'related-to', 'inexact'];
    default:
      return ['equivalent', 'narrower'];
  }
}

/**
 * Re-export ConceptMap versions for convenience
 */
export function getConceptMapVersions() {
  return _getConceptMapVersions();
}

/**
 * Attempts translation using a specific ConceptMap ID
 * Returns the translated code if successful, null otherwise
 * Includes retry logic for transient server errors (502, 503, 504, 429)
 */
async function tryConceptMapTranslation(
  emisCode: string,
  conceptMapId: string,
  token: string,
  acceptedEquivalences: string[]
): Promise<TranslatedCode | null> {
  const url = `${TERMINOLOGY_SERVER_BASE}/ConceptMap/${conceptMapId}/$translate`;

  try {
    return await withRetry(async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/fhir+json; charset=utf-8',
          'Content-Type': 'application/fhir+json; charset=utf-8',
        },
        body: JSON.stringify({
          resourceType: 'Parameters',
          parameter: [
            { name: 'code', valueCode: emisCode },
            { name: 'system', valueUri: EMIS_CODE_SYSTEM },
            { name: 'target', valueUri: SNOMED_CODE_SYSTEM },
          ],
        }),
        signal: AbortSignal.timeout(10000),
      });

      // Check for retryable HTTP status codes before processing
      if (isRetryableStatus(response.status)) {
        throw new Error(
          `Terminology server returned ${response.status}: Server overloaded or rate limited.`
        );
      }

      // Handle errors - only 404 should try fallback, other errors should throw
      const errorResult = await handleFhirResponse(response, {
        overrides: { 404: 'RETURN_NULL' },
        context: `translating code ${emisCode} via ConceptMap ${conceptMapId}`
      });

      if (errorResult !== null) {
        return null; // 404 - try fallback ConceptMap
      }

      // Safely parse JSON
      let data: ConceptMapTranslateResponse;
      try {
        const responseText = await response.text();
        if (!responseText.trim().startsWith('{')) {
          console.warn(`ConceptMap translation returned non-JSON for ${emisCode}:`, responseText.substring(0, 200));
          return null;
        }
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.warn(`Failed to parse ConceptMap response for ${emisCode}:`, parseError);
        return null;
      }

      // Extract the first match from the translation result
      if (data.parameter) {
        const resultParam = data.parameter.find((p) => p.name === 'result');
        if (resultParam?.valueBoolean) {
          const matchParam = data.parameter.find((p) => p.name === 'match');
          if (matchParam?.part) {
            const equivalencePart = matchParam.part.find((p) => p.name === 'equivalence');
            const equivalence = equivalencePart?.valueCode || equivalencePart?.valueString;

            if (equivalence && !acceptedEquivalences.includes(equivalence)) {
              return null; // Rejected due to equivalence filter
            }

            const conceptPart = matchParam.part.find((p) => p.name === 'concept');
            if (conceptPart?.valueCoding?.code) {
              return {
                code: conceptPart.valueCoding.code,
                display: conceptPart.valueCoding.display,
                equivalence,
              };
            }
          }
        }
      }

      return null;
    }, {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 15000,
      context: `ConceptMap translation for ${emisCode}`
    });
  } catch (error) {
    console.warn(`Error translating EMIS code ${emisCode} with ConceptMap ${conceptMapId}:`, error);
    return null;
  }
}

/**
 * Translates a single EMIS code to SNOMED using ConceptMap
 * Tries the main ConceptMap first, then falls back to the DrugCodeID ConceptMap if the main one fails
 * Accepts mappings based on the equivalence filter setting
 */
export async function translateEmisCodeToSnomed(
  emisCode: string,
  equivalenceFilter: EquivalenceFilter = 'strict'
): Promise<TranslatedCode | null> {
  const token = await getAccessToken();
  const acceptedEquivalences = getAcceptedEquivalences(equivalenceFilter);

  // Resolve latest ConceptMap IDs on first call
  const primaryId = await getPrimaryConceptMapId(token);
  const fallbackId = await getFallbackConceptMapId(token);

  // Try main ConceptMap first
  const result = await tryConceptMapTranslation(emisCode, primaryId, token, acceptedEquivalences);
  if (result) {
    return result;
  }

  // If main ConceptMap failed (non-404 error) or returned no match, try fallback
  console.log(`Trying fallback ConceptMap for EMIS code ${emisCode}...`);
  const fallbackResult = await tryConceptMapTranslation(emisCode, fallbackId, token, acceptedEquivalences);
  if (fallbackResult) {
    console.log(`Fallback ConceptMap succeeded for EMIS code ${emisCode}`);
    return fallbackResult;
  }

  return null;
}

/**
 * Batch translates EMIS codes to SNOMED using ConceptMap
 * Accepts mappings based on the equivalence filter setting
 * Returns a map of EMIS code -> TranslatedCode (with display name)
 *
 * Processes codes sequentially with 10ms delay to avoid overwhelming the terminology server
 */
export async function translateEmisCodesToSnomed(
  emisCodes: string[],
  equivalenceFilter: EquivalenceFilter = 'strict'
): Promise<Map<string, TranslatedCode>> {
  const mapping = new Map<string, TranslatedCode>();
  const uniqueCodes = [...new Set(emisCodes)];
  const acceptedEquivalences = getAcceptedEquivalences(equivalenceFilter);

  console.log(`Translating ${uniqueCodes.length} unique EMIS codes to SNOMED (filter: ${equivalenceFilter}, accepting: ${acceptedEquivalences.join(', ')})...`);

  let successCount = 0;
  let failureCount = 0;

  await sequentialWithDelay(uniqueCodes, async (emisCode) => {
    const translatedCode = await translateEmisCodeToSnomed(emisCode, equivalenceFilter);
    if (translatedCode) {
      mapping.set(emisCode, translatedCode);
      successCount++;
    } else {
      failureCount++;
    }
  }, 10);

  console.log(`ConceptMap translation complete: ${successCount} successful, ${failureCount} failed/rejected (equivalence filter: ${equivalenceFilter}, accepted: ${acceptedEquivalences.join(', ')})`);

  if (mapping.size < uniqueCodes.length) {
    const missing = uniqueCodes.filter(code => !mapping.has(code));
    if (missing.length <= 10) {
      console.warn(`Failed to translate EMIS codes: ${missing.join(', ')}`);
    } else {
      console.warn(`Failed to translate ${missing.length} EMIS codes (first 10): ${missing.slice(0, 10).join(', ')}...`);
    }
  }

  return mapping;
}

/**
 * Checks if a SNOMED concept is inactive and resolves to current concept if historical
 * Returns the current concept ID or the original if still active
 * Includes retry logic for transient server errors (502, 503, 504, 429)
 */
export async function resolveHistoricalConcept(
  conceptId: string
): Promise<{ currentConceptId: string; isHistorical: boolean; display?: string }> {
  const token = await getAccessToken();
  const url = `${TERMINOLOGY_SERVER_BASE}/CodeSystem/$lookup`;

  try {
    return await withRetry(async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/fhir+json; charset=utf-8',
          'Content-Type': 'application/fhir+json; charset=utf-8',
        },
        body: JSON.stringify({
          resourceType: 'Parameters',
          parameter: [
            { name: 'system', valueUri: SNOMED_CODE_SYSTEM },
            { name: 'code', valueCode: conceptId },
            { name: 'property', valueCode: 'inactive' },
            { name: 'property', valueCode: 'SAME_AS' },
            { name: 'property', valueCode: 'REPLACED_BY' },
            { name: 'property', valueCode: 'POSSIBLY_EQUIVALENT_TO' },
          ],
        }),
        signal: AbortSignal.timeout(10000),
      });

      // Check for retryable HTTP status codes before processing
      if (isRetryableStatus(response.status)) {
        throw new Error(
          `Terminology server returned ${response.status}: Server overloaded or rate limited.`
        );
      }

      // Handle errors - 404 returns null (concept not found), other errors should throw
      const errorResult = await handleFhirResponse(response, {
        overrides: { 404: 'RETURN_NULL' },
        context: `looking up historical concept ${conceptId}`
      });

      if (errorResult !== null) {
        return { currentConceptId: conceptId, isHistorical: false };
      }

      // Safely parse JSON
      let data: any;
      try {
        const responseText = await response.text();
        if (!responseText.trim().startsWith('{')) {
          console.warn(`Historical concept lookup returned non-JSON for ${conceptId}:`, responseText.substring(0, 200));
          return { currentConceptId: conceptId, isHistorical: false };
        }
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.warn(`Failed to parse historical concept response for ${conceptId}:`, parseError);
        return { currentConceptId: conceptId, isHistorical: false };
      }

      // Extract display name
      let display: string | undefined;
      const displayParam = data.parameter?.find((p: any) => p.name === 'display');
      if (displayParam?.valueString) {
        display = displayParam.valueString;
      }

      // Check if concept is inactive
      let isInactive = false;
      if (data.parameter) {
        const inactiveProperty = data.parameter.find(
          (p: any) => p.name === 'property' && p.part?.some((part: any) => part.name === 'code' && part.valueCode === 'inactive')
        );
        if (inactiveProperty?.part) {
          const valuePart = inactiveProperty.part.find((p: any) => p.name === 'value');
          isInactive = valuePart?.valueBoolean === true;
        }
      }

      if (!isInactive) {
        return { currentConceptId: conceptId, isHistorical: false, display };
      }

      // Concept is inactive - look for historical associations in priority order
      const associationPriority = ['SAME_AS', 'REPLACED_BY', 'POSSIBLY_EQUIVALENT_TO'];

      for (const associationType of associationPriority) {
        if (data.parameter) {
          const associationProperty = data.parameter.find(
            (p: any) => p.name === 'property' && p.part?.some((part: any) => part.name === 'code' && part.valueCode === associationType)
          );
          if (associationProperty?.part) {
            const valuePart = associationProperty.part.find((p: any) => p.name === 'value');
            if (valuePart?.valueCode) {
              console.log(`Resolved historical concept ${conceptId} -> ${valuePart.valueCode} (${associationType})`);
              return { currentConceptId: valuePart.valueCode, isHistorical: true, display };
            }
          }
        }
      }

      console.warn(`Concept ${conceptId} is inactive but has no historical association`);
      return { currentConceptId: conceptId, isHistorical: true, display };
    }, {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 15000,
      context: `historical concept lookup for ${conceptId}`
    });
  } catch (error) {
    console.error(`Error resolving historical concept ${conceptId}:`, error);
    return { currentConceptId: conceptId, isHistorical: false };
  }
}

/**
 * Batch resolves historical concepts to current concepts
 * Returns a map of original concept ID -> current concept ID
 *
 * Processes concepts sequentially with 10ms delay to avoid overwhelming the terminology server
 */
export async function resolveHistoricalConcepts(
  conceptIds: string[]
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  const uniqueIds = [...new Set(conceptIds)];

  console.log(`Checking ${uniqueIds.length} concepts for historical associations...`);

  let historicalCount = 0;

  await sequentialWithDelay(uniqueIds, async (conceptId) => {
    const result = await resolveHistoricalConcept(conceptId);
    mapping.set(conceptId, result.currentConceptId);
    if (result.isHistorical) {
      historicalCount++;
    }
  }, 10);

  console.log(`Historical resolution complete: ${historicalCount} historical concepts updated`);

  return mapping;
}

export async function expandEclQuery(
  eclExpression: string
): Promise<SnomedConcept[]> {
  // Handle empty ECL expression
  if (!eclExpression || eclExpression.trim() === '') {
    console.warn('Empty ECL expression provided - returning empty result');
    return [];
  }

  const token = await getAccessToken();

  // URL encode the ECL expression
  const encodedEcl = encodeURIComponent(eclExpression);
  const url = `${TERMINOLOGY_SERVER_BASE}/ValueSet/$expand`;

  // Construct the URL parameter: http://snomed.info/sct?fhir_vs=ecl/{encoded_ecl}
  const urlParam = `http://snomed.info/sct?fhir_vs=ecl/${encodedEcl}`;
  const fullUrl = `${url}?url=${encodeURIComponent(urlParam)}`;

  // Wrap the fetch in retry logic for transient server errors (502, 503, 504, 429)
  return withRetry(async () => {
    let response: Response;
    try {
      response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/fhir+json; charset=utf-8',
        },
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });
    } catch (error: any) {
      // Handle network errors (fetch failures, timeouts, etc.)
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        throw new Error(
          `Request timeout (30s): The terminology server did not respond in time. The server may be overloaded.`
        );
      }
      if (error?.message?.includes('fetch') || error?.message?.includes('network')) {
        throw new Error(
          `Network error: Unable to connect to terminology server. Please check your internet connection.`
        );
      }
      throw new Error(
        `Network error connecting to terminology server: ${error?.message || 'Unknown error'}`
      );
    }

    // Check for retryable HTTP status codes before processing
    if (isRetryableStatus(response.status)) {
      throw new Error(
        `Terminology server returned ${response.status}: Server overloaded or rate limited.`
      );
    }

    // Handle FHIR errors - 404 returns empty array for this operation
    const errorResult = await handleFhirResponse(response, {
      overrides: { 404: 'RETURN_EMPTY' },
      context: 'expanding ValueSet'
    });

    if (errorResult !== null) {
      return errorResult; // Returns [] for 404
    }

    // Safely parse JSON with better error handling
    let data: FhirValueSetExpansion;
    try {
      const responseText = await response.text();

      // Check if response looks like JSON
      if (!responseText.trim().startsWith('{') && !responseText.trim().startsWith('[')) {
        console.error('Terminology server returned non-JSON response:', {
          status: response.status,
          contentType: response.headers.get('content-type'),
          bodyPreview: responseText.substring(0, 500),
        });
        throw new Error(
          `Terminology server returned unexpected response (not JSON). ` +
          `Status: ${response.status}. This may indicate server overload or a proxy error.`
        );
      }

      data = JSON.parse(responseText);
    } catch (parseError: any) {
      if (parseError.message?.includes('not JSON') || parseError.message?.includes('unexpected response')) {
        throw parseError;
      }
      console.error('Failed to parse terminology server response as JSON:', parseError);
      throw new Error(
        `Failed to parse terminology server response: ${parseError.message}. ` +
        `The server may be returning an error page or rate limiting response.`
      );
    }

    // Extract concepts
    const concepts: SnomedConcept[] = [];
    if (data.expansion?.contains) {
      for (const item of data.expansion.contains) {
        concepts.push({
          code: item.code,
          display: item.display,
          system: item.system,
          source: 'child',
        });
      }
    }

    // Log if we got no concepts but response was OK
    if (concepts.length === 0 && response.ok) {
      const codeMatches = eclExpression.match(/\d{6,}/g);
      console.warn(`⚠️ No concepts returned for ECL query (${codeMatches?.length || 0} codes)`);
    }

    return concepts;
  }, {
    maxRetries: 3,
    baseDelayMs: 2000, // Start with 2s delay for server overload
    maxDelayMs: 30000,
    context: 'ECL expansion'
  });
}
