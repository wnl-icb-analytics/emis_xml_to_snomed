import { EmisValueSet, EquivalenceFilter } from './types';

/**
 * Prepares a ValueSet for expansion by extracting codes, display names, and metadata
 * into arrays suitable for the terminology expansion API
 */
export function prepareValueSetForExpansion(
  vs: EmisValueSet,
  vsIndex: number
) {
  const parentCodes: string[] = [];
  const displayNames: string[] = [];
  const includeChildren: boolean[] = [];
  const isRefset: boolean[] = [];
  const codeSystems: string[] = [];
  const vsExcludedCodes: string[] = [];

  vs.values.forEach((v) => {
    parentCodes.push(v.code);
    displayNames.push(v.displayName || v.code);
    includeChildren.push(v.includeChildren);
    isRefset.push(v.isRefset || false);
    codeSystems.push(vs.codeSystem || 'EMISINTERNAL');
  });

  vs.exceptions.forEach((e) => {
    vsExcludedCodes.push(e.code);
  });

  const valueSetMapping = [{
    valueSetId: vs.id,
    valueSetIndex: vsIndex,
    codeIndices: parentCodes.map((_, idx) => idx),
    excludedCodes: vsExcludedCodes,
  }];

  return {
    parentCodes,
    displayNames,
    includeChildren,
    isRefset,
    codeSystems,
    excludedCodes: vsExcludedCodes,
    valueSetMapping,
  };
}

/**
 * Calls the terminology expansion API for a single ValueSet
 * Returns the parsed JSON response
 */
export async function expandValueSet(
  reportId: string,
  reportName: string,
  vs: EmisValueSet,
  vsIndex: number,
  equivalenceFilter?: EquivalenceFilter
) {
  const preparedData = prepareValueSetForExpansion(vs, vsIndex);

  const response = await fetch('/api/terminology/expand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      featureId: reportId,
      featureName: reportName,
      ...preparedData,
      ...(equivalenceFilter && { equivalenceFilter }),
    }),
  });

  // Safely parse response - handle non-JSON responses (timeouts, HTML error pages, etc.)
  let data: any;
  try {
    const responseText = await response.text();

    // Check if response looks like JSON before parsing
    if (!responseText.trim().startsWith('{') && !responseText.trim().startsWith('[')) {
      console.error('API returned non-JSON response:', {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        bodyPreview: responseText.substring(0, 500),
      });

      // Provide helpful error message based on status code
      if (response.status === 504 || response.status === 408) {
        throw new Error(`Request timeout (${response.status}). The terminology server may be overloaded. Try again in a few minutes.`);
      } else if (response.status === 429) {
        throw new Error('Rate limited by server. Please wait a moment and try again.');
      } else if (response.status >= 500) {
        throw new Error(`Server error (${response.status}). The terminology server may be experiencing issues.`);
      } else {
        throw new Error(`Unexpected response from server (${response.status}). Please try again.`);
      }
    }

    data = JSON.parse(responseText);
  } catch (parseError: any) {
    // Re-throw if it's our custom error
    if (parseError.message?.includes('timeout') ||
        parseError.message?.includes('Rate limited') ||
        parseError.message?.includes('Server error') ||
        parseError.message?.includes('Unexpected response')) {
      throw parseError;
    }

    console.error('Failed to parse API response:', parseError);
    throw new Error(`Failed to parse server response: ${parseError.message}. The server may be overloaded or experiencing issues.`);
  }

  if (!response.ok || !data.success) {
    // Preserve the error message from the API route
    const errorMessage = data.error || `API request failed: ${response.status} ${response.statusText}`;
    throw new Error(errorMessage);
  }

  return data;
}
