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

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}
