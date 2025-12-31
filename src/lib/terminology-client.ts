import { getAccessToken } from './oauth-client';
import { FhirValueSetExpansion, SnomedConcept, ConceptMapTranslateResponse, TranslatedCode } from './types';

const TERMINOLOGY_SERVER_BASE =
  process.env.TERMINOLOGY_SERVER ||
  'https://ontology.onelondon.online/production1/fhir';

const EMIS_TO_SNOMED_CONCEPT_MAP_ID = '8d2953a3-b70b-4727-8a6a-8b4d912535ad'; // Version 2.1.4
const EMIS_TO_SNOMED_FALLBACK_CONCEPT_MAP_ID = 'b5519813-31eb-4cad-8c77-b8999420e3c9'; // DrugCodeID fallback
const EMIS_CODE_SYSTEM = 'http://LDS.nhs/EMIS/CodeID/cs';
const SNOMED_CODE_SYSTEM = 'http://snomed.info/sct';

// Only accept equivalent or narrower mappings
const ACCEPTED_EQUIVALENCES = ['equivalent', 'narrower'];

/**
 * Attempts translation using a specific ConceptMap ID
 * Returns the translated code if successful, null otherwise
 */
async function tryConceptMapTranslation(
  emisCode: string,
  conceptMapId: string,
  token: string
): Promise<TranslatedCode | null> {
  const url = `${TERMINOLOGY_SERVER_BASE}/ConceptMap/${conceptMapId}/$translate`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/fhir+json',
        'Content-Type': 'application/fhir+json',
      },
      body: JSON.stringify({
        resourceType: 'Parameters',
        parameter: [
          {
            name: 'code',
            valueCode: emisCode,
          },
          {
            name: 'system',
            valueUri: EMIS_CODE_SYSTEM,
          },
          {
            name: 'target',
            valueUri: SNOMED_CODE_SYSTEM,
          },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Code not found in this ConceptMap
      }
      // For other errors, log but don't throw - will try fallback
      const errorText = await response.text();
      console.warn(`ConceptMap ${conceptMapId} failed for code ${emisCode}: ${response.status}`, errorText.substring(0, 200));
      return null;
    }

    const data: ConceptMapTranslateResponse = await response.json();

    // Extract the first match from the translation result
    if (data.parameter) {
      const resultParam = data.parameter.find((p) => p.name === 'result');
      if (resultParam?.valueBoolean) {
        const matchParam = data.parameter.find((p) => p.name === 'match');
        if (matchParam?.part) {
          const equivalencePart = matchParam.part.find((p) => p.name === 'equivalence');
          const equivalence = equivalencePart?.valueCode || equivalencePart?.valueString;

          // CRITICAL: Only accept equivalent or narrower mappings
          if (equivalence && !ACCEPTED_EQUIVALENCES.includes(equivalence)) {
            return null; // Rejected due to equivalence - don't log, will try fallback
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
  } catch (error) {
    console.warn(`Error translating EMIS code ${emisCode} with ConceptMap ${conceptMapId}:`, error);
    return null;
  }
}

/**
 * Translates a single EMIS code to SNOMED using ConceptMap
 * Tries the main ConceptMap first, then falls back to the DrugCodeID ConceptMap if the main one fails
 * Only accepts mappings with equivalence "equivalent" or "narrower"
 * Returns null for "broader", "related", or other equivalences
 */
export async function translateEmisCodeToSnomed(
  emisCode: string
): Promise<TranslatedCode | null> {
  const token = await getAccessToken();

  // Try main ConceptMap first
  const result = await tryConceptMapTranslation(emisCode, EMIS_TO_SNOMED_CONCEPT_MAP_ID, token);
  if (result) {
    return result;
  }

  // If main ConceptMap failed (non-404 error) or returned no match, try fallback
  console.log(`Trying fallback ConceptMap for EMIS code ${emisCode}...`);
  const fallbackResult = await tryConceptMapTranslation(emisCode, EMIS_TO_SNOMED_FALLBACK_CONCEPT_MAP_ID, token);
  if (fallbackResult) {
    console.log(`Fallback ConceptMap succeeded for EMIS code ${emisCode}`);
    return fallbackResult;
  }

  return null;
}

/**
 * Batch translates EMIS codes to SNOMED using ConceptMap
 * Only accepts mappings with equivalence "equivalent" or "narrower"
 * Returns a map of EMIS code -> TranslatedCode (with display name)
 */
export async function translateEmisCodesToSnomed(
  emisCodes: string[]
): Promise<Map<string, TranslatedCode>> {
  const mapping = new Map<string, TranslatedCode>();
  const uniqueCodes = [...new Set(emisCodes)];

  console.log(`Translating ${uniqueCodes.length} unique EMIS codes to SNOMED (accepting only 'equivalent' or 'narrower')...`);

  const BATCH_SIZE = 10;
  let successCount = 0;
  let failureCount = 0;
  let rejectedCount = 0;

  for (let i = 0; i < uniqueCodes.length; i += BATCH_SIZE) {
    const batch = uniqueCodes.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (emisCode) => {
      const translatedCode = await translateEmisCodeToSnomed(emisCode);
      if (translatedCode) {
        mapping.set(emisCode, translatedCode);
        successCount++;
      } else {
        // Could be 404 or rejected equivalence
        failureCount++;
      }
    });

    await Promise.all(promises);

    // Small delay between batches
    if (i + BATCH_SIZE < uniqueCodes.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`ConceptMap translation complete: ${successCount} successful, ${failureCount} failed/rejected (equivalence filter: ${ACCEPTED_EQUIVALENCES.join(', ')})`);

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
 */
export async function resolveHistoricalConcept(
  conceptId: string
): Promise<{ currentConceptId: string; isHistorical: boolean; display?: string }> {
  const token = await getAccessToken();
  const url = `${TERMINOLOGY_SERVER_BASE}/CodeSystem/$lookup`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/fhir+json',
        'Content-Type': 'application/fhir+json',
      },
      body: JSON.stringify({
        resourceType: 'Parameters',
        parameter: [
          {
            name: 'system',
            valueUri: SNOMED_CODE_SYSTEM,
          },
          {
            name: 'code',
            valueCode: conceptId,
          },
          {
            name: 'property',
            valueCode: 'inactive',
          },
          {
            name: 'property',
            valueCode: 'SAME_AS',
          },
          {
            name: 'property',
            valueCode: 'REPLACED_BY',
          },
          {
            name: 'property',
            valueCode: 'POSSIBLY_EQUIVALENT_TO',
          },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      // 404 is acceptable - concept doesn't exist
      if (response.status === 404) {
        return { currentConceptId: conceptId, isHistorical: false };
      }

      // Server errors (500+) should throw
      if (response.status >= 500) {
        const errorText = await response.text();
        throw new Error(
          `Terminology server error ${response.status} when looking up concept ${conceptId}: ${errorText.substring(0, 200)}`
        );
      }

      // Other errors (400, 414, etc.) - log and return original
      console.warn(`Failed to lookup concept ${conceptId}: ${response.status}`);
      return { currentConceptId: conceptId, isHistorical: false };
    }

    const data = await response.json();

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

    // No historical association found - return original
    console.warn(`Concept ${conceptId} is inactive but has no historical association`);
    return { currentConceptId: conceptId, isHistorical: true, display };
  } catch (error) {
    console.error(`Error resolving historical concept ${conceptId}:`, error);
    return { currentConceptId: conceptId, isHistorical: false };
  }
}

/**
 * Batch resolves historical concepts to current concepts
 * Returns a map of original concept ID -> current concept ID
 */
export async function resolveHistoricalConcepts(
  conceptIds: string[]
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  const uniqueIds = [...new Set(conceptIds)];

  console.log(`Checking ${uniqueIds.length} concepts for historical associations...`);

  const BATCH_SIZE = 10;
  let historicalCount = 0;

  for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (conceptId) => {
      const result = await resolveHistoricalConcept(conceptId);
      mapping.set(conceptId, result.currentConceptId);
      if (result.isHistorical) {
        historicalCount++;
      }
    });

    await Promise.all(promises);

    // Small delay between batches
    if (i + BATCH_SIZE < uniqueIds.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

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
  // Match Snowflake implementation exactly:
  // 1. Python uses: quote(ecl_expression, safe='') from urllib.parse
  // 2. JavaScript equivalent: encodeURIComponent() (encodes all special chars except: A-Z a-z 0-9 - _ . ! ~ * ' ( ))
  //    Note: Python's quote with safe='' encodes more aggressively, but encodeURIComponent should work
  const encodedEcl = encodeURIComponent(eclExpression);
  const url = `${TERMINOLOGY_SERVER_BASE}/ValueSet/$expand`;
  
  // Construct the URL parameter exactly as Snowflake does: http://snomed.info/sct?fhir_vs=ecl/{encoded_ecl}
  const urlParam = `http://snomed.info/sct?fhir_vs=ecl/${encodedEcl}`;
  
  // Snowflake uses: requests.get(url, headers=headers, params={"url": url_param})
  // This means requests automatically URL-encodes the url_param value
  // In fetch, we need to manually encode it: ?url={encoded_url_param}
  const fullUrl = `${url}?url=${encodeURIComponent(urlParam)}`;
  

  let response: Response;
  try {
    response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/fhir+json',
      },
      // Add timeout and signal for better error handling
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });
  } catch (error: any) {
    // Handle network errors (fetch failures, timeouts, etc.)
    const errorDetails = {
      errorMessage: error?.message || 'Unknown error',
      errorName: error?.name || 'Unknown',
      errorStack: error?.stack || 'No stack trace',
      errorCause: error?.cause ? {
        message: error.cause?.message,
        name: error.cause?.name,
        stack: error.cause?.stack
      } : null,
      url: fullUrl.substring(0, 300),
      urlLength: fullUrl.length,
      serverBase: TERMINOLOGY_SERVER_BASE,
      hasToken: !!token,
      tokenPrefix: token ? token.substring(0, 20) + '...' : 'No token',
      errorType: error?.constructor?.name || typeof error,
      errorStringified: JSON.stringify(error, Object.getOwnPropertyNames(error)).substring(0, 500)
    };

    console.error('Network error fetching from terminology server - Full details:', errorDetails);
    console.error('Error object keys:', Object.keys(error || {}));
    console.error('Error object:', error);

    // Specific error messages for common network issues
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new Error(
        `Request timeout (30s): The terminology server did not respond in time. The server may be overloaded or experiencing issues.`
      );
    }

    if (error?.message?.includes('fetch') || error?.message?.includes('network')) {
      throw new Error(
        `Network error: Unable to connect to terminology server. Please check your internet connection.`
      );
    }

    throw new Error(
      `Network error connecting to terminology server: ${error?.message || 'Unknown error'} (${error?.name || 'Unknown error type'})`
    );
  }

  if (!response.ok) {
    const errorText = await response.text();

    // 404 is acceptable - means the concept doesn't exist in SNOMED
    if (response.status === 404) {
      console.warn(`Concept not found (404) in terminology server - returning empty result`);
      return [];
    }

    // Authentication/authorization errors - provide helpful message
    if (response.status === 401) {
      throw new Error(
        `Authentication failed (401): Invalid or expired OAuth token. Please check your credentials.`
      );
    }

    if (response.status === 403) {
      throw new Error(
        `Access forbidden (403): Your account does not have permission to access the terminology server.`
      );
    }

    // Rate limiting
    if (response.status === 429) {
      throw new Error(
        `Rate limited (429): Too many requests to terminology server. Please try again later.`
      );
    }

    // URI too long - this shouldn't happen with batching but catch it anyway
    if (response.status === 414) {
      throw new Error(
        `Request URI too long (414): ECL query exceeded URL length limit. This may indicate a batching issue.`
      );
    }

    // Server errors (500+)
    if (response.status >= 500) {
      console.error('Terminology server error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText.substring(0, 500)
      });
      throw new Error(
        `Terminology server error (${response.status}): ${response.statusText}. The server may be experiencing issues.`
      );
    }

    // All other 4xx errors
    console.error('Terminology server error:', {
      status: response.status,
      statusText: response.statusText,
      error: errorText.substring(0, 500)
    });
    throw new Error(
      `Terminology server request failed: ${response.status} ${response.statusText}. ${errorText.substring(0, 200)}`
    );
  }

  const data: FhirValueSetExpansion = await response.json();

  // Extract concepts
  const concepts: SnomedConcept[] = [];
  if (data.expansion?.contains) {
    for (const item of data.expansion.contains) {
      concepts.push({
        code: item.code,
        display: item.display,
        system: item.system,
        source: 'child', // Will be marked as 'parent' for original codes
      });
    }
  }

  // Log if we got no concepts but response was OK
  if (concepts.length === 0 && response.ok) {
    const codeMatches = eclExpression.match(/\d{6,}/g);
    console.warn(`⚠️ No concepts returned for ECL query (${codeMatches?.length || 0} codes)`);
  }

  // Return empty array if no expansion - parent codes will be added by caller
  return concepts;
}
