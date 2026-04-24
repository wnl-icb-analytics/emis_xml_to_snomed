/**
 * Client-side data model assembly for batch extraction.
 * Builds metadata (failed codes, exceptions, original codes) from raw expansion results.
 */

import { TranslatedCode, SnomedConcept, RawValueSetExpansion } from './types';
import { isDmdCode } from './code-system-utils';
import { formatForSql } from './sql-formatter';

export interface OriginalCodeMetadata {
  originalCode: string;
  displayName: string;
  codeSystem: string;
  includeChildren: boolean;
  isRefset: boolean;
  translatedTo?: string;
  translatedToDisplay?: string;
}

export interface FailedCode {
  originalCode: string;
  displayName: string;
  codeSystem: string;
  reason: string;
}

export interface ExceptionMetadata {
  originalExcludedCode: string;
  originalExcludedDisplay: string;
  translatedToSnomedCode: string | null;
  includedInEcl: boolean;
  translationError: string | null;
}

/** Build original codes metadata from raw inputs and pre-computed maps */
export function buildOriginalCodesMetadata(
  parentCodes: string[],
  codeIndices: number[],
  displayNames: string[] | undefined,
  codeSystems: string[] | undefined,
  includeChildren: boolean[],
  isRefset: boolean[] | undefined,
  translationMap: Record<string, TranslatedCode | null>,
  historicalMap: Record<string, string>,
): OriginalCodeMetadata[] {
  return codeIndices.map((idx: number) => {
    const originalCode = parentCodes[idx];
    const translatedCode = translationMap[originalCode];
    const snomedCode = translatedCode?.code || originalCode;
    const currentCode = historicalMap[snomedCode] || snomedCode;

    return {
      originalCode,
      displayName: displayNames?.[idx] || '',
      codeSystem: codeSystems?.[idx] || 'EMISINTERNAL',
      includeChildren: includeChildren[idx] || false,
      isRefset: isRefset?.[idx] || false,
      translatedTo: translatedCode ? currentCode : undefined,
      translatedToDisplay: translatedCode?.display,
    };
  });
}

/** Detect failed codes — codes not found in expanded concepts */
export function detectFailedCodes(
  originalCodes: OriginalCodeMetadata[],
  expandedConcepts: SnomedConcept[],
  successfulSctConstCodes: string[],
  rf2RefsetIds: string[],
  sctConstNoProducts: Record<string, { substanceCode: string; displayName: string }>,
): FailedCode[] {
  const expandedCodeSet = new Set(expandedConcepts.map(c => c.code));
  const successfulSctConstSet = new Set(successfulSctConstCodes);
  const rf2RefsetSet = new Set(rf2RefsetIds);
  const dmdCodeSet = new Set(
    originalCodes
      .filter(oc => isDmdCode(oc.originalCode) || (oc.translatedTo && isDmdCode(oc.translatedTo)))
      .map(oc => oc.originalCode)
  );

  return originalCodes
    .filter(oc => {
      if (oc.codeSystem === 'SCT_CONST' && successfulSctConstSet.has(oc.originalCode)) return false;
      if (oc.isRefset && rf2RefsetSet.has(oc.translatedTo || oc.originalCode)) return false;
      if (dmdCodeSet.has(oc.originalCode)) return false;

      const translatedCode = oc.translatedTo || oc.originalCode;
      return !expandedCodeSet.has(translatedCode) && !expandedCodeSet.has(oc.originalCode);
    })
    .map(oc => {
      if (oc.codeSystem === 'SCT_CONST' && sctConstNoProducts[oc.originalCode]) {
        const info = sctConstNoProducts[oc.originalCode];
        if (info.substanceCode === oc.originalCode) {
          return {
            originalCode: oc.originalCode,
            displayName: oc.displayName,
            codeSystem: oc.codeSystem,
            reason: 'No ConceptMap translation available. Cannot expand UK Products without a valid SNOMED CT substance code.',
          };
        }
        return {
          originalCode: oc.originalCode,
          displayName: oc.displayName,
          codeSystem: oc.codeSystem,
          reason: `No UK Products found for substance ${info.substanceCode} (${info.displayName}) or its modifications.`,
        };
      }

      return {
        originalCode: oc.originalCode,
        displayName: oc.displayName,
        codeSystem: oc.codeSystem,
        reason: oc.translatedTo
          ? 'Not found in terminology server expansion'
          : 'No translation found from ConceptMap',
      };
    });
}

/** Build exception metadata for excluded codes.
 *  Always preserves the raw XML code and displayName in the output row,
 *  regardless of whether ConceptMap translation succeeded — translation_error
 *  carries the failure reason separately.
 */
export function buildExceptionsMetadata(
  excludedCodes: string[],
  excludedDisplayNames: string[] | undefined,
  translationMap: Record<string, TranslatedCode | null>,
  historicalMap: Record<string, string>,
): ExceptionMetadata[] {
  return excludedCodes.map((originalCode, idx) => {
    const originalDisplay = excludedDisplayNames?.[idx] || '';
    const translatedCode = translationMap[originalCode];

    if (!translatedCode) {
      return {
        originalExcludedCode: originalCode,
        originalExcludedDisplay: originalDisplay,
        translatedToSnomedCode: null,
        includedInEcl: false,
        translationError: 'No translation found from ConceptMap',
      };
    }

    const snomedCode = translatedCode.code;
    const resolved = historicalMap[snomedCode] || snomedCode;

    return {
      originalExcludedCode: originalCode,
      originalExcludedDisplay: originalDisplay,
      translatedToSnomedCode: resolved,
      includedInEcl: true,
      translationError: null,
    };
  });
}

/** Assemble a full ValueSetGroup-equivalent from raw expansion + pre-computed maps */
export function assembleValueSetData(
  raw: RawValueSetExpansion,
  parentCodes: string[],
  codeIndices: number[],
  excludedCodes: string[],
  excludedDisplayNames: string[] | undefined,
  displayNames: string[] | undefined,
  codeSystems: string[] | undefined,
  includeChildren: boolean[],
  isRefset: boolean[] | undefined,
  translationMap: Record<string, TranslatedCode | null>,
  historicalMap: Record<string, string>,
) {
  const originalCodes = buildOriginalCodesMetadata(
    parentCodes, codeIndices, displayNames, codeSystems,
    includeChildren, isRefset, translationMap, historicalMap,
  );

  const failedCodes = detectFailedCodes(
    originalCodes, raw.concepts, raw.successfulSctConstCodes,
    raw.rf2RefsetIds, raw.sctConstNoProducts,
  );

  const exceptions = buildExceptionsMetadata(excludedCodes, excludedDisplayNames, translationMap, historicalMap);

  const sqlFormattedCodes = formatForSql(raw.concepts.map(c => c.code));

  // Check if expansion failed for refsets
  const allRefsets = codeIndices.length > 0 &&
    codeIndices.every((idx: number) => isRefset?.[idx] || false);
  const parentCodeSet = new Set(raw.parentCodes);
  const hasOnlyOriginalCodes = raw.concepts.length > 0 &&
    raw.concepts.every(c => parentCodeSet.has(c.code));
  const expansionError = allRefsets && hasOnlyOriginalCodes
    ? 'Reference set not found. This reference set is not available in the terminology server.'
    : undefined;

  return {
    concepts: raw.concepts,
    parentCodes: raw.parentCodes,
    sqlFormattedCodes,
    originalCodes,
    failedCodes: failedCodes.length > 0 ? failedCodes : undefined,
    exceptions: exceptions.length > 0 ? exceptions : undefined,
    expansionError,
  };
}
