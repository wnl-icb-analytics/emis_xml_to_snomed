import * as fs from 'fs';
import * as path from 'path';
import { getRF2FolderName } from './rf2-version';

/**
 * In-memory cache for RF2 description data
 * Maps conceptId -> preferred display name (FSN or synonym)
 */
let descriptionCache: Map<string, string> | null = null;

/**
 * Gets the path to the RF2 Description file
 * Uses dynamic RF2 folder detection
 */
function getRf2DescriptionFilePath(): string {
  const rf2Folder = getRF2FolderName();

  if (!rf2Folder) {
    console.warn('No RF2 folder detected, description lookup will not work');
    return '';
  }

  // Find the description file dynamically
  const terminologyPath = path.join(process.cwd(), rf2Folder, 'Snapshot', 'Terminology');

  if (!fs.existsSync(terminologyPath)) {
    console.warn(`RF2 Terminology path not found: ${terminologyPath}`);
    return '';
  }

  // Find the description file (pattern: sct2_Description_UKPCSnapshot-en_*.txt)
  const files = fs.readdirSync(terminologyPath);
  const descriptionFile = files.find(f => f.startsWith('sct2_Description_UKPCSnapshot-en_') && f.endsWith('.txt'));

  if (!descriptionFile) {
    console.warn(`No description file found in ${terminologyPath}`);
    return '';
  }

  return path.join(terminologyPath, descriptionFile);
}

/**
 * Parses the RF2 Description file and creates an index
 * Prioritises FSN (900000000000003001) over synonyms (900000000000013009)
 * Only includes active descriptions (active === '1')
 */
function parseRf2DescriptionFile(): Map<string, string> {
  const descriptionMap = new Map<string, string>();
  // Track which concepts have FSN descriptions (so we don't overwrite FSN with synonym)
  const hasFSN = new Set<string>();

  try {
    const descriptionFilePath = getRf2DescriptionFilePath();
    if (!fs.existsSync(descriptionFilePath)) {
      console.warn(`RF2 description file not found at: ${descriptionFilePath}`);
      return descriptionMap;
    }

    const fileContent = fs.readFileSync(descriptionFilePath, 'utf-8');
    const lines = fileContent.split('\n');

    // Skip header line (index 0)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // RF2 files are tab-delimited
      // Columns: id, effectiveTime, active, moduleId, conceptId, languageCode, typeId, term, caseSignificanceId
      const columns = line.split('\t');
      if (columns.length < 9) continue;

      const active = columns[2]; // active column (index 2)
      const conceptId = columns[4]; // conceptId column (index 4)
      const typeId = columns[6]; // typeId column (index 6)
      const term = columns[7]; // term column (index 7)

      // Only include active descriptions
      if (active === '1' && conceptId && term) {
        const isFSN = typeId === '900000000000003001';
        const existingHasFSN = hasFSN.has(conceptId);
        
        // If we already have an FSN for this concept, don't overwrite with synonym
        // If this is an FSN, always use it (overwrites any existing synonym)
        // If no description exists yet, use this one
        if (!existingHasFSN) {
          descriptionMap.set(conceptId, term);
          if (isFSN) {
            hasFSN.add(conceptId);
          }
        } else if (isFSN) {
          // This is an FSN and we might have had a synonym before - replace it
          descriptionMap.set(conceptId, term);
          hasFSN.add(conceptId);
        }
      }
    }

    const fsnCount = hasFSN.size;
    console.log(`Loaded ${descriptionMap.size} concept descriptions from RF2 file (${fsnCount} FSNs)`);
  } catch (error) {
    console.error('Error parsing RF2 description file:', error);
  }

  return descriptionMap;
}

/**
 * Gets the description cache, loading it if necessary
 */
function getDescriptionCache(): Map<string, string> {
  if (descriptionCache === null) {
    console.log('Loading RF2 description data...');
    descriptionCache = parseRf2DescriptionFile();
  }
  return descriptionCache;
}

/**
 * Gets the display name for a concept from RF2 data
 * Returns empty string if not found
 */
export function getConceptDisplayName(conceptId: string): string {
  const cache = getDescriptionCache();
  return cache.get(conceptId) || '';
}

/**
 * Gets display names for multiple concepts from RF2 data
 * Returns a Map of conceptId -> display name
 */
export function getConceptDisplayNames(conceptIds: string[]): Map<string, string> {
  const cache = getDescriptionCache();
  const result = new Map<string, string>();
  
  for (const conceptId of conceptIds) {
    const displayName = cache.get(conceptId);
    if (displayName) {
      result.set(conceptId, displayName);
    }
  }

  return result;
}

/**
 * Clears the description cache (useful for testing or reloading)
 */
export function clearDescriptionCache(): void {
  descriptionCache = null;
}

