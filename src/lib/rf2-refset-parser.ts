import { SnomedConcept } from './types';
import { getConceptDisplayNames } from './rf2-description-parser';
import { resolveHistoricalConcept } from './terminology-client';
import { getRF2FolderName } from './rf2-version';
import * as fs from 'fs';
import * as path from 'path';

/**
 * In-memory cache for RF2 refset data
 * Maps refsetId -> Set of concept IDs that are members of that refset
 */
let refsetCache: Map<string, Set<string>> | null = null;

/**
 * Gets the path to the RF2 Simple Refset file
 * Uses dynamic RF2 folder detection, tries project root first, then src/data as fallback
 * Using Snapshot version as it contains all current active members
 */
function getRf2RefsetFilePath(): string {
  const rf2Folder = getRF2FolderName();

  if (!rf2Folder) {
    console.warn('No RF2 folder detected, refset expansion will not work');
    return '';
  }

  // Find the simple refset file dynamically
  const refsetPath = path.join(process.cwd(), rf2Folder, 'Snapshot', 'Refset', 'Content');

  if (!fs.existsSync(refsetPath)) {
    console.warn(`RF2 Refset path not found: ${refsetPath}`);
    return '';
  }

  // Find the simple refset file (pattern: der2_Refset_SimpleUKPCSnapshot_*.txt)
  const files = fs.readdirSync(refsetPath);
  const simpleRefsetFile = files.find(f => f.startsWith('der2_Refset_SimpleUKPCSnapshot_') && f.endsWith('.txt'));

  if (!simpleRefsetFile) {
    console.warn(`No simple refset file found in ${refsetPath}`);
    return '';
  }

  return path.join(refsetPath, simpleRefsetFile);
}

/**
 * Parses the RF2 Simple Refset file and creates an index
 * Only includes active members (active === '1')
 * Returns a Map where key is refsetId and value is Set of concept IDs
 */
function parseRf2RefsetFile(): Map<string, Set<string>> {
  const refsetMap = new Map<string, Set<string>>();

  try {
    const rf2RefsetFilePath = getRf2RefsetFilePath();
    if (!fs.existsSync(rf2RefsetFilePath)) {
      console.warn(`RF2 refset file not found at: ${rf2RefsetFilePath}`);
      return refsetMap;
    }

    const fileContent = fs.readFileSync(rf2RefsetFilePath, 'utf-8');
    const lines = fileContent.split('\n');

    // Skip header line (index 0)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // RF2 files are tab-delimited
      const columns = line.split('\t');
      if (columns.length < 6) continue;

      const active = columns[2]; // active column (index 2)
      const refsetId = columns[4]; // refsetId column (index 4)
      const referencedComponentId = columns[5]; // referencedComponentId column (index 5)

      // Only include active members
      if (active === '1' && refsetId && referencedComponentId) {
        if (!refsetMap.has(refsetId)) {
          refsetMap.set(refsetId, new Set());
        }
        refsetMap.get(refsetId)!.add(referencedComponentId);
      }
    }

    console.log(`Loaded ${refsetMap.size} refsets from RF2 file with ${Array.from(refsetMap.values()).reduce((sum, set) => sum + set.size, 0)} total members`);
  } catch (error) {
    console.error('Error parsing RF2 refset file:', error);
  }

  return refsetMap;
}

/**
 * Gets the refset cache, loading it if necessary
 */
function getRefsetCache(): Map<string, Set<string>> {
  if (refsetCache === null) {
    console.log('Loading RF2 refset data...');
    refsetCache = parseRf2RefsetFile();
  }
  return refsetCache;
}

/**
 * Expands a refset using RF2 data
 * Returns an array of SNOMED concepts that are members of the refset
 * Returns empty array if refset not found in RF2 data
 * Includes display names from RF2 description file, with fallback to terminology server
 */
export async function expandRefsetFromRf2(refsetId: string): Promise<SnomedConcept[]> {
  const cache = getRefsetCache();
  const memberIds = cache.get(refsetId);

  if (!memberIds || memberIds.size === 0) {
    return [];
  }

  // Get display names for all member concepts from RF2
  const memberIdsArray = Array.from(memberIds);
  const rf2DisplayNames = getConceptDisplayNames(memberIdsArray);
  
  console.log(`  RF2 description lookup: ${rf2DisplayNames.size} of ${memberIdsArray.length} concepts found in RF2 descriptions`);

  // Find concepts that don't have display names in RF2 (likely standard SNOMED concepts)
  const conceptsWithoutDisplay = memberIdsArray.filter(id => !rf2DisplayNames.has(id));
  
  if (conceptsWithoutDisplay.length > 0) {
    console.log(`  ${conceptsWithoutDisplay.length} concepts need terminology server lookup (sample: ${conceptsWithoutDisplay.slice(0, 5).join(', ')})`);
  }

  // Look up display names from terminology server for concepts not in RF2
  let serverDisplayNames = new Map<string, string>();
  if (conceptsWithoutDisplay.length > 0) {
    console.log(`  Looking up ${conceptsWithoutDisplay.length} display names from terminology server for refset ${refsetId}...`);
    try {
      // Batch lookup display names using resolveHistoricalConcept which gets display names
      // Do this in smaller batches to avoid overwhelming the server
      const BATCH_SIZE = 20; // Reduced batch size to avoid timeouts
      let successCount = 0;
      let failureCount = 0;
      
      for (let i = 0; i < conceptsWithoutDisplay.length; i += BATCH_SIZE) {
        const batch = conceptsWithoutDisplay.slice(i, i + BATCH_SIZE);
        // Use resolveHistoricalConcept which gets display names from terminology server
        const lookupPromises = batch.map(async (conceptId) => {
          try {
            const { display } = await resolveHistoricalConcept(conceptId);
            if (display) {
              successCount++;
              return { conceptId, display };
            } else {
              failureCount++;
              return { conceptId, display: '' };
            }
          } catch (error) {
            failureCount++;
            console.warn(`    Failed to lookup display for concept ${conceptId}:`, error);
            return { conceptId, display: '' };
          }
        });
        const results = await Promise.all(lookupPromises);
        results.forEach(({ conceptId, display }) => {
          if (display) {
            serverDisplayNames.set(conceptId, display);
          }
        });
        
        // Small delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < conceptsWithoutDisplay.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log(`  Lookup complete: ${successCount} succeeded, ${failureCount} failed`);
    } catch (error) {
      console.error(`Failed to lookup display names from terminology server for refset ${refsetId}:`, error);
    }
  }

  // Combine RF2 and server display names
  const allDisplayNames = new Map([...rf2DisplayNames, ...serverDisplayNames]);

  // Convert Set of concept IDs to SnomedConcept array with display names
  const concepts: SnomedConcept[] = memberIdsArray.map((conceptId) => {
    const display = allDisplayNames.get(conceptId) || '';
    const concept: SnomedConcept = {
      code: conceptId,
      display: display.trim(), // Trim whitespace
      system: 'http://snomed.info/sct',
      source: 'rf2_file',
    };
    return concept;
  });

  const conceptsWithDisplay = concepts.filter(c => c.display && c.display.trim() !== '').length;
  const rf2OnlyCount = rf2DisplayNames.size;
  const serverOnlyCount = serverDisplayNames.size;
  
  console.log(`Expanded refset ${refsetId} from RF2: ${concepts.length} members (${conceptsWithDisplay} with display names: ${rf2OnlyCount} from RF2, ${serverOnlyCount} from server)`);
  
  // Log a sample if many concepts are missing display names
  if (conceptsWithDisplay < concepts.length && concepts.length > 0) {
    const missingCount = concepts.length - conceptsWithDisplay;
    const sampleWithoutDisplay = concepts.slice(0, 10).filter(c => !c.display || c.display.trim() === '').map(c => c.code);
    console.warn(`  Warning: ${missingCount} concepts missing display names. Sample codes: ${sampleWithoutDisplay.join(', ')}`);
    
    // Log a sample of concepts WITH display names to verify they're being set
    const sampleWithDisplay = concepts.slice(0, 5).filter(c => c.display && c.display.trim() !== '');
    if (sampleWithDisplay.length > 0) {
      console.log(`  Sample concepts WITH display: ${sampleWithDisplay.map(c => `${c.code}="${c.display}"`).join(', ')}`);
    }
  }
  
  return concepts;
}

/**
 * Gets the display name for a refset (the refset ID itself is a concept)
 */
export function getRefsetDisplayName(refsetId: string): string {
  return getConceptDisplayNames([refsetId]).get(refsetId) || '';
}

/**
 * Checks if a refset exists in the RF2 data
 */
export function refsetExistsInRf2(refsetId: string): boolean {
  const cache = getRefsetCache();
  return cache.has(refsetId) && cache.get(refsetId)!.size > 0;
}

/**
 * Expands multiple refsets from RF2 data
 * Returns a Map where key is refsetId and value is array of concepts
 */
export async function expandRefsetsFromRf2(refsetIds: string[]): Promise<Map<string, SnomedConcept[]>> {
  const result = new Map<string, SnomedConcept[]>();
  
  for (const refsetId of refsetIds) {
    const concepts = await expandRefsetFromRf2(refsetId);
    if (concepts.length > 0) {
      result.set(refsetId, concepts);
    }
  }

  return result;
}

/**
 * Clears the refset cache (useful for testing or reloading)
 */
export function clearRefsetCache(): void {
  refsetCache = null;
}

