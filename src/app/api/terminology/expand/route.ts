import { NextRequest, NextResponse } from 'next/server';
import {
  ExpandCodesRequest,
  ExpandCodesResponse,
  ExpandedCodeSet,
  ValueSetGroup,
  EmisValue,
} from '@/lib/types';
import { buildBatchedEclQuery, buildBatchedEclQueryWithoutRefsets, buildUkProductEcl, separateRefsets, buildFormattedEclExpression } from '@/lib/ecl-builder';
import {
  expandEclQuery,
  translateEmisCodesToSnomed,
  resolveHistoricalConcepts
} from '@/lib/terminology-client';
import { formatForSql } from '@/lib/sql-formatter';
import { generateValueSetHash, generateValueSetFriendlyName, generateValueSetId } from '@/lib/valueset-utils';
import { expandRefsetsFromRf2, refsetExistsInRf2, getRefsetDisplayName } from '@/lib/rf2-refset-parser';

// Internal type for values with additional metadata during expansion
interface ValueWithMetadata extends EmisValue {
  originalCode: string;
  translatedSnomedCode?: string;
  codeSystem: string;
}

/**
 * Expands a single ValueSet by processing its codes through translation,
 * historical resolution, and expansion via RF2/terminology server.
 *
 * This handles the complex multi-step process:
 * 1. Build values array with translated/resolved codes
 * 2. Handle SCT_CONST (UK Product expansion)
 * 3. Separate and expand refsets from RF2 files
 * 4. Expand remaining codes via ECL queries
 * 5. Track failed codes and generate metadata
 */
async function expandSingleValueSet(
  mapping: any,
  parentCodes: string[],
  displayNames: string[] | undefined,
  includeChildren: boolean[],
  isRefset: boolean[] | undefined,
  codeSystems: string[] | undefined,
  codeToSnomedMap: Map<string, any>,
  historicalMap: Map<string, string>,
  featureId: string,
  featureName: string,
  allConceptsMap: Map<string, any>
): Promise<ValueSetGroup> {
  const vsOriginalParentCodes = mapping.codeIndices.map((idx: number) => parentCodes[idx]);
  const vsOriginalExcludedCodes = mapping.excludedCodes || [];
  
  // Debug: log excluded codes
  if (vsOriginalExcludedCodes.length > 0) {
    console.log(`[expandSingleValueSet] ValueSet ${mapping.valueSetIndex + 1} has ${vsOriginalExcludedCodes.length} excluded codes:`, vsOriginalExcludedCodes.slice(0, 5));
  }
  
  // Translate and resolve excluded codes (same process as parent codes)
  const vsExcludedCodes = vsOriginalExcludedCodes.map((code: string) => {
    const translatedCode = codeToSnomedMap.get(code);
    const snomedCode = translatedCode?.code || code;
    return historicalMap.get(snomedCode) || snomedCode;
  });
  
  // Debug: log translated/resolved excluded codes
  if (vsExcludedCodes.length > 0) {
    console.log(`[expandSingleValueSet] ValueSet ${mapping.valueSetIndex + 1} has ${vsExcludedCodes.length} translated/resolved excluded codes:`, vsExcludedCodes.slice(0, 5));
  }
  
  const vsExcludedSet = new Set(vsExcludedCodes);

  // Build values array for this specific ValueSet
  const vsValues: ValueWithMetadata[] = mapping.codeIndices.map((idx: number) => {
    const originalCode = parentCodes[idx];
    const translatedCode = codeToSnomedMap.get(originalCode);
    const snomedCode = translatedCode?.code || originalCode;
    const currentCode = historicalMap.get(snomedCode) || snomedCode;

    return {
      code: currentCode,
      originalCode,
      translatedSnomedCode: translatedCode?.code, // Store the ConceptMap translated code for SCT_CONST
      displayName: displayNames?.[idx] || '',
      includeChildren: includeChildren[idx] || false,
      isRefset: isRefset?.[idx] || false,
      codeSystem: codeSystems?.[idx] || 'EMISINTERNAL',
    };
  });

  // Handle SCT_CONST codes - expand UK Products for substance codes
  const sctConstCodes = vsValues.filter((v: ValueWithMetadata) => v.codeSystem === 'SCT_CONST');
  let ukProductConcepts: any[] = [];
  // Track which SCT_CONST codes successfully expanded to products (to exclude from failed codes)
  const successfullyExpandedSctConstCodes = new Set<string>();

  if (sctConstCodes.length > 0) {
    console.log(`Found ${sctConstCodes.length} SCT_CONST codes, expanding UK Products...`);

    for (const sctConstValue of sctConstCodes) {
      // Use the translated SNOMED code from ConceptMap, not the original XML code
      // If no translation exists, fall back to the resolved code
      const substanceCode = sctConstValue.translatedSnomedCode || sctConstValue.code;

      if (!sctConstValue.translatedSnomedCode) {
        console.warn(`  SCT_CONST code ${sctConstValue.originalCode} has no ConceptMap translation, using resolved code ${substanceCode}`);
      }

      try {
        // Build UK Product ECL query using the translated substance code
        const ukProductEcl = buildUkProductEcl(substanceCode);
        console.log(`  Expanding UK Products for substance ${substanceCode} (original: ${sctConstValue.originalCode}): ${ukProductEcl}`);

        // Expand the ECL query
        const products = await expandEclQuery(ukProductEcl);
        console.log(`  -> Found ${products.length} UK Products for substance ${substanceCode}`);

        // If we got products, mark this SCT_CONST code as successfully expanded
        if (products.length > 0) {
          successfullyExpandedSctConstCodes.add(sctConstValue.originalCode);
        }

        // Mark all products as from terminology server
        products.forEach((product: any) => {
          product.source = 'terminology_server';
          product.excludeChildren = !sctConstValue.includeChildren;
        });

        ukProductConcepts.push(...products);
      } catch (error) {
        console.error(`Error expanding UK Products for substance ${substanceCode}:`, error);
        // Continue with other substances
      }
    }
  }

  // Filter out SCT_CONST codes from normal expansion (they're handled separately)
  const nonSctConstValues = vsValues.filter((v: ValueWithMetadata) => v.codeSystem !== 'SCT_CONST');

  // Separate refsets from non-refsets
  const { refsets: refsetValues, nonRefsets: nonRefsetValues } = separateRefsets(nonSctConstValues);

  // Also check codes that failed ConceptMap translation - they might be refsets in RF2
  // Check both the original code and the resolved code (after historical resolution)
  const codesThatFailedConceptMap = nonSctConstValues.filter((v: ValueWithMetadata) => {
    const translatedCode = codeToSnomedMap.get(v.originalCode);
    return !translatedCode && !v.isRefset; // Failed translation and not already marked as refset
  });

  // Check if any of these failed codes (or their resolved codes) are refsets in RF2
  const potentialRefsetsFromRf2: ValueWithMetadata[] = [];
  for (const value of codesThatFailedConceptMap) {
    // Check both the original code and the resolved code
    const codesToCheck = [value.code, value.originalCode].filter(Boolean);
    for (const codeToCheck of codesToCheck) {
      if (refsetExistsInRf2(codeToCheck)) {
        console.log(`  Code ${value.originalCode} (resolved: ${value.code}) not translated by ConceptMap but found as refset ${codeToCheck} in RF2`);
        potentialRefsetsFromRf2.push({ ...value, code: codeToCheck, isRefset: true });
        break; // Found it, no need to check other codes
      }
    }
  }

  // Combine detected refsets with potential refsets from RF2
  const allRefsetValues = [...refsetValues, ...potentialRefsetsFromRf2];
  // Filter out potential refsets from non-refsets by comparing codes (since nonRefsetValues are EmisValue type)
  const allNonRefsetValues = nonRefsetValues.filter((v: EmisValue) =>
    !potentialRefsetsFromRf2.some((pr: ValueWithMetadata) => pr.code === v.code || pr.originalCode === v.code)
  );

  console.log(`Expanding ValueSet ${mapping.valueSetIndex + 1} with ${nonSctConstValues.length} codes (${allRefsetValues.length} refsets including ${potentialRefsetsFromRf2.length} found in RF2, ${allNonRefsetValues.length} non-refsets, ${sctConstCodes.length} SCT_CONST handled separately)...`);

  let vsConcepts: any[] = [];

  // First, try expanding refsets from RF2 files
  const refsetIds = allRefsetValues.map(v => v.code);
  const rf2RefsetResults = await expandRefsetsFromRf2(refsetIds);
  const rf2RefsetIds = Array.from(rf2RefsetResults.keys());
  const refsetsNotFoundInRf2 = refsetIds.filter(id => !rf2RefsetIds.includes(id));

  // Add RF2 refset results
  for (const [refsetId, concepts] of rf2RefsetResults) {
    vsConcepts.push(...concepts);
    console.log(`  -> Expanded refset ${refsetId} from RF2: ${concepts.length} members`);
  }

  // For refsets not found in RF2, fall back to ECL queries
  const refsetsToQueryViaEcl = allRefsetValues.filter(v => refsetsNotFoundInRf2.includes(v.code));

  // Build ECL query for non-refsets and refsets not found in RF2
  const valuesForEcl = [...allNonRefsetValues, ...refsetsToQueryViaEcl];

  // Expand via terminology server if needed - use batching to avoid 414 Request-URI Too Large errors
  // Each ECL code with << operator adds ~20-30 characters to the URL
  // Most servers limit URLs to ~8KB, so batch at 50 codes to be safe
  const BATCH_SIZE = 50;

  if (valuesForEcl.length > 0) {
    if (valuesForEcl.length > BATCH_SIZE) {
      console.log(`  -> ValueSet has ${valuesForEcl.length} codes, batching into groups of ${BATCH_SIZE} to avoid URL length limits`);

      for (let i = 0; i < valuesForEcl.length; i += BATCH_SIZE) {
        const batch = valuesForEcl.slice(i, i + BATCH_SIZE);
        const batchEclExpression = buildBatchedEclQuery(batch, vsExcludedCodes);

        try {
          const batchConcepts = await expandEclQuery(batchEclExpression);
          console.log(`  -> Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(valuesForEcl.length / BATCH_SIZE)}: Got ${batchConcepts.length} concepts`);
          vsConcepts.push(...batchConcepts);

          // Small delay between batches to avoid rate limiting
          if (i + BATCH_SIZE < valuesForEcl.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error) {
          console.error(`  -> Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, error);
          // Continue with other batches
        }
      }
    } else {
      const eclExpression = buildBatchedEclQuery(valuesForEcl, vsExcludedCodes);
      try {
        const eclConcepts = await expandEclQuery(eclExpression);
        console.log(`  -> Got ${eclConcepts.length} concepts from terminology server for ValueSet ${mapping.valueSetIndex + 1}`);
        vsConcepts.push(...eclConcepts);
      } catch (error) {
        console.error(`Error expanding ValueSet ${mapping.valueSetIndex + 1} via ECL:`, error);
        // Continue with concepts we already have from RF2
      }
    }
  }

  // Combine normal concepts with UK Product concepts
  vsConcepts = [...vsConcepts, ...ukProductConcepts];

  // Mark parent codes in this ValueSet (preserve source from RF2 or terminology server)
  const vsParentConceptIdSet = new Set(vsValues.map((v: ValueWithMetadata) => v.code));
  vsConcepts.forEach((concept) => {
    // Don't overwrite source - RF2 concepts already have 'rf2_file', ECL concepts have 'terminology_server'
    if (vsParentConceptIdSet.has(concept.code)) {
      const valueIndex = vsValues.findIndex((v: ValueWithMetadata) => v.code === concept.code);
      if (valueIndex !== -1) {
        concept.isRefset = vsValues[valueIndex].isRefset;
        concept.excludeChildren = !vsValues[valueIndex].includeChildren;
      }
    }
    // Add to global concepts map
    if (!allConceptsMap.has(concept.code)) {
      allConceptsMap.set(concept.code, { ...concept });
    }
  });

  // Filter out excluded codes
  const filteredConcepts = vsConcepts.filter(
    (c) => !vsExcludedSet.has(c.code)
  );

  // Check if expansion failed for refsets
  const vsIsRefsetFlags = mapping.codeIndices.map((idx: number) => isRefset?.[idx] || false);
  const allRefsets = vsIsRefsetFlags.length > 0 && vsIsRefsetFlags.every((flag: boolean) => flag === true);
  // Check if we only got back the original codes (no expansion happened)
  const originalCodeSet = new Set(vsValues.map((v: ValueWithMetadata) => v.code));
  const hasOnlyOriginalCodes = filteredConcepts.length > 0 && filteredConcepts.every((c: any) => originalCodeSet.has(c.code));
  const expansionError = allRefsets && hasOnlyOriginalCodes
    ? 'Reference set not found. This reference set is not available in the terminology server.'
    : undefined;

  const vsSqlFormatted = formatForSql(filteredConcepts.map((c) => c.code));

  // Build original codes metadata and track failed codes
  const originalCodesMetadata = mapping.codeIndices.map((idx: number) => {
    const originalCode = parentCodes[idx];
    const translatedCode = codeToSnomedMap.get(originalCode);
    const snomedCode = translatedCode?.code || originalCode;
    const currentCode = historicalMap.get(snomedCode) || snomedCode;

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

  // Track refsets that were successfully expanded from RF2
  const successfullyExpandedRefsets = new Set(rf2RefsetIds);

  // Get refset metadata (code and name) for successfully expanded refsets
  const refsetsMetadata = rf2RefsetIds.map(refsetId => ({
    refsetId,
    refsetName: getRefsetDisplayName(refsetId) || `Refset ${refsetId}`,
  }));

  // Track failed codes - codes that don't appear in expanded concepts
  // Exclude SCT_CONST codes that successfully expanded to UK Products
  // Exclude refsets that successfully expanded from RF2 (refset ID itself isn't a concept)
  const expandedCodeSet = new Set(filteredConcepts.map((c: any) => c.code));
  const failedCodes = originalCodesMetadata
    .filter((oc: any) => {
      // Skip SCT_CONST codes that successfully expanded to UK Products
      // (The substance codes themselves won't appear in expanded concepts, only the products will)
      if (oc.codeSystem === 'SCT_CONST' && successfullyExpandedSctConstCodes.has(oc.originalCode)) {
        return false;
      }

      // Skip refsets that successfully expanded from RF2
      // (The refset ID itself isn't a concept, so it won't appear in expanded concepts)
      if (oc.isRefset && successfullyExpandedRefsets.has(oc.translatedTo || oc.originalCode)) {
        return false;
      }

      // Code failed if it doesn't appear in expanded concepts
      // Check both the translated code (if available) and the original code
      const translatedCode = oc.translatedTo || oc.originalCode;
      const codeFound = expandedCodeSet.has(translatedCode) || expandedCodeSet.has(oc.originalCode);

      return !codeFound;
    })
    .map((oc: any) => ({
      originalCode: oc.originalCode,
      displayName: oc.displayName,
      codeSystem: oc.codeSystem,
      reason: oc.translatedTo
        ? 'Not found in terminology server expansion'
        : 'No translation found from ConceptMap',
    }));

  const vsSnomedParentCodes = vsValues.map((v: ValueWithMetadata) => v.code);

  // Generate hash from original XML codes (before translation) for duplicate detection
  const xmlCodes = vsOriginalParentCodes.sort();
  const valueSetHash = generateValueSetHash(xmlCodes);
  const valueSetFriendlyName = generateValueSetFriendlyName(featureName, mapping.valueSetIndex);
  // Generate deterministic ID based on report ID, valueset index, and valueset hash
  const valueSetId = generateValueSetId(featureId, valueSetHash, mapping.valueSetIndex);

  // Build formatted ECL expression for display (includes all codes for this ValueSet)
  // Convert vsValues to EmisValue format for ECL builder
  const eclValues = vsValues.map((v: ValueWithMetadata) => ({
    code: v.code,
    displayName: v.displayName,
    includeChildren: v.includeChildren,
    isRefset: v.isRefset,
  }));
  
  // Debug: log before building ECL
  if (vsExcludedCodes.length > 0) {
    console.log(`[expandSingleValueSet] Building ECL for ValueSet ${mapping.valueSetIndex + 1} with ${vsExcludedCodes.length} excluded codes:`, vsExcludedCodes.slice(0, 5));
  }
  
  const eclExpression = buildFormattedEclExpression(eclValues, vsExcludedCodes, allConceptsMap);
  
  // Debug: log the generated ECL
  if (vsExcludedCodes.length > 0) {
    console.log(`[expandSingleValueSet] Generated ECL expression for ValueSet ${mapping.valueSetIndex + 1}:`, eclExpression.substring(0, 200));
  }

  return {
    valueSetId,
    valueSetIndex: mapping.valueSetIndex,
    valueSetHash,
    valueSetFriendlyName,
    valueSetUniqueName: valueSetId, // Use UUID as unique name too
    concepts: filteredConcepts,
    sqlFormattedCodes: vsSqlFormatted,
    parentCodes: vsSnomedParentCodes,
    eclExpression: eclExpression || undefined,
    expansionError,
    failedCodes: failedCodes.length > 0 ? failedCodes : undefined,
    refsets: refsetsMetadata.length > 0 ? refsetsMetadata : undefined,
    originalCodes: originalCodesMetadata,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: ExpandCodesRequest = await request.json();
    const {
      featureId,
      featureName,
      parentCodes,
      displayNames,
      excludedCodes,
      includeChildren,
      isRefset,
      codeSystems,
      valueSetMapping,
      equivalenceFilter = 'strict', // Default to strict filter
    } = body;

    if (!parentCodes || parentCodes.length === 0) {
      return NextResponse.json<ExpandCodesResponse>(
        { success: false, error: 'No parent codes provided' },
        { status: 400 }
      );
    }

    // Strategy: Try ConceptMap translation for ALL codes
    // If translation succeeds -> use translated code
    // If translation fails (404) -> assume already valid SNOMED
    // This handles unreliable codeSystem labels in XML

    console.log(`Attempting ConceptMap translation for all ${parentCodes.length} codes (equivalence filter: ${equivalenceFilter})...`);
    const codeToSnomedMap = await translateEmisCodesToSnomed(parentCodes, equivalenceFilter);
    console.log(`ConceptMap results: ${codeToSnomedMap.size} codes translated, ${parentCodes.length - codeToSnomedMap.size} assumed already SNOMED`);

    // Log first few translated mappings
    let loggedMappings = 0;
    codeToSnomedMap.forEach((translatedCode, originalCode) => {
      if (loggedMappings < 5) {
        console.log(`  Translated: ${originalCode} -> ${translatedCode.code} (${translatedCode.display || 'no display'}, equivalence: ${translatedCode.equivalence || 'unknown'})`);
        loggedMappings++;
      }
    });

    // Fallback: Check if codes that failed ConceptMap translation are refsets in RF2
    const codesNotTranslated = parentCodes.filter(code => !codeToSnomedMap.has(code));
    if (codesNotTranslated.length > 0) {
      console.log(`Checking ${codesNotTranslated.length} untranslated codes against RF2 refsets...`);
      for (const code of codesNotTranslated) {
        // Check if this code exists as a refset in RF2
        if (refsetExistsInRf2(code)) {
          console.log(`  Code ${code} found as refset in RF2, will expand from RF2`);
          // Mark as refset if not already marked
          const codeIndex = parentCodes.indexOf(code);
          if (codeIndex !== -1 && isRefset) {
            isRefset[codeIndex] = true;
          }
        }
      }
    }

    // Collect all SNOMED codes (translated or original if translation failed)
    const allSnomedCodes: string[] = [];
    parentCodes.forEach((code) => {
      const translatedCode = codeToSnomedMap.get(code);
      allSnomedCodes.push(translatedCode?.code || code); // Use translated code if available, else original
    });

    // Resolve historical SNOMED concepts to current ones
    const historicalMap = await resolveHistoricalConcepts(allSnomedCodes);

    // Build values array for ECL construction
    const values: Array<{
      code: string;
      originalCode: string;
      displayName: string;
      includeChildren: boolean;
      isRefset: boolean;
    }> = [];

    parentCodes.forEach((originalCode, idx) => {
      // Try translated code first, fallback to original
      const translatedCode = codeToSnomedMap.get(originalCode);
      const snomedCode = translatedCode?.code || originalCode;

      // Get current concept (resolving historical if needed)
      const currentCode = historicalMap.get(snomedCode) || snomedCode;

      values.push({
        code: currentCode, // Use current SNOMED concept ID
        originalCode, // Keep original code for reference
        displayName: displayNames?.[idx] || '',
        includeChildren: includeChildren[idx] || false,
        isRefset: isRefset?.[idx] || false,
      });
    });

    console.log(`Total codes for ECL query: ${values.length}`);

    // CRITICAL FIX: Expand each ValueSet separately to track which child concepts belong to which ValueSet
    // This prevents the bug where all child concepts were added to any ValueSet with includeChildren=true

    const valueSetGroups: ValueSetGroup[] = [];
    const allExcludedCodes = excludedCodes || [];

    // Track all unique concepts across all ValueSets for the combined SQL output
    const allConceptsMap = new Map<string, any>();

    if (valueSetMapping && valueSetMapping.length > 0) {
      // Expand each ValueSet separately
      for (const mapping of valueSetMapping) {
        const valueSetGroup = await expandSingleValueSet(
          mapping,
          parentCodes,
          displayNames,
          includeChildren,
          isRefset,
          codeSystems,
          codeToSnomedMap,
          historicalMap,
          featureId,
          featureName,
          allConceptsMap
        );

        valueSetGroups.push(valueSetGroup);

        // Small delay between ValueSet expansions to avoid rate limiting
        if (mapping !== valueSetMapping[valueSetMapping.length - 1]) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    } else {
      // No ValueSet mapping - expand all codes together (legacy behavior)
      const BATCH_SIZE = 50;
      const expandedConcepts: any[] = [];

      // Separate refsets from non-refsets
      const { refsets: refsetValues, nonRefsets: nonRefsetValues } = separateRefsets(values);
      
      // Expand refsets from RF2 first
      const refsetIds = refsetValues.map(v => v.code);
      const rf2RefsetResults = await expandRefsetsFromRf2(refsetIds);
      const rf2RefsetIds = Array.from(rf2RefsetResults.keys());
      const refsetsNotFoundInRf2 = refsetIds.filter(id => !rf2RefsetIds.includes(id));
      
      // Add RF2 refset results
      for (const [refsetId, concepts] of rf2RefsetResults) {
        expandedConcepts.push(...concepts);
        console.log(`Expanded refset ${refsetId} from RF2: ${concepts.length} members`);
      }
      
      // For refsets not found in RF2, add them back to values for ECL query
      const refsetsToQueryViaEcl = refsetValues.filter(v => refsetsNotFoundInRf2.includes(v.code));
      const valuesForEcl = [...nonRefsetValues, ...refsetsToQueryViaEcl];

      if (valuesForEcl.length > BATCH_SIZE) {
        for (let i = 0; i < valuesForEcl.length; i += BATCH_SIZE) {
          const batch = valuesForEcl.slice(i, i + BATCH_SIZE);
          const eclExpression = buildBatchedEclQuery(batch, allExcludedCodes);

          try {
            const batchConcepts = await expandEclQuery(eclExpression);
            expandedConcepts.push(...batchConcepts);

            if (i + BATCH_SIZE < valuesForEcl.length) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          } catch (error) {
            console.error(`Error expanding batch:`, error);
          }
        }
      } else if (valuesForEcl.length > 0) {
        const eclExpression = buildBatchedEclQuery(valuesForEcl, allExcludedCodes);
        try {
          const concepts = await expandEclQuery(eclExpression);
          expandedConcepts.push(...concepts);
        } catch (error) {
          console.error(`Error expanding codes:`, error);
        }
      }

      expandedConcepts.forEach((concept) => {
        allConceptsMap.set(concept.code, concept);
      });
    }

    // Get all concepts from the map for combined SQL output
    const concepts = Array.from(allConceptsMap.values());

    // Format for SQL (all codes combined)
    const sqlFormatted = formatForSql(concepts.map((c) => c.code));

    const result: ExpandedCodeSet = {
      featureId,
      featureName,
      concepts,
      totalCount: concepts.length,
      sqlFormattedCodes: sqlFormatted,
      expandedAt: new Date().toISOString(),
      equivalenceFilterSetting: equivalenceFilter,
      valueSetGroups: valueSetGroups.length > 0 ? valueSetGroups : undefined,
    };

    return NextResponse.json<ExpandCodesResponse>({
      success: true,
      data: result,
    });
  } catch (error) {
    const errorDetails = {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : typeof error,
      errorStack: error instanceof Error ? error.stack : 'No stack trace',
      errorCause: error instanceof Error && (error as any).cause ? {
        message: (error as any).cause?.message,
        name: (error as any).cause?.name
      } : null,
      errorStringified: JSON.stringify(error, Object.getOwnPropertyNames(error || {})).substring(0, 1000)
    };
    
    console.error('Code expansion error - Full details:', errorDetails);
    console.error('Error object:', error);
    
    return NextResponse.json<ExpandCodesResponse>(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to expand codes',
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const maxDuration = 60;
