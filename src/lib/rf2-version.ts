import fs from 'fs';
import path from 'path';

interface RF2VersionInfo {
  releaseDate: string; // Human-readable format: "11 December 2025"
  releaseId: string; // ISO format: "20251211T000000Z"
  folderName: string; // Full folder name
  module: string; // Module identifier
  edition: string; // Edition name
}

let cachedRF2Version: RF2VersionInfo | null = null;

/**
 * Detects the RF2 folder and extracts version information
 * Looks for folders matching the pattern: SnomedCT_*_PRODUCTION_*
 */
export function detectRF2Version(): RF2VersionInfo | null {
  // Return cached version if already detected
  if (cachedRF2Version) {
    return cachedRF2Version;
  }

  try {
    const projectRoot = process.cwd();
    const files = fs.readdirSync(projectRoot);

    // Find RF2 folder matching the pattern
    const rf2Folder = files.find((file) => {
      return file.startsWith('SnomedCT_') &&
             file.includes('_PRODUCTION_') &&
             fs.statSync(path.join(projectRoot, file)).isDirectory();
    });

    if (!rf2Folder) {
      console.warn('No RF2 folder found in project root');
      return null;
    }

    // Extract information from folder name
    // Format: SnomedCT_{Edition}RF2_PRODUCTION_{ReleaseId}
    // Example: SnomedCT_UKPrimaryCareRF2_PRODUCTION_20251211T000000Z
    const match = rf2Folder.match(/SnomedCT_(.+?)RF2_PRODUCTION_(\d{8}T\d{6}Z)/);

    if (!match) {
      console.warn(`RF2 folder found but doesn't match expected pattern: ${rf2Folder}`);
      return null;
    }

    const edition = match[1]; // e.g., "UKPrimaryCare"
    const releaseId = match[2]; // e.g., "20251211T000000Z"

    // Parse the date from releaseId (format: YYYYMMDDTHHMMSSZ)
    const year = releaseId.substring(0, 4);
    const month = releaseId.substring(4, 6);
    const day = releaseId.substring(6, 8);

    // Convert month number to name
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[parseInt(month, 10) - 1];

    const releaseDate = `${parseInt(day, 10)} ${monthName} ${year}`;

    // Try to detect module from folder structure
    let module = 'Unknown';
    try {
      const snapshotPath = path.join(projectRoot, rf2Folder, 'Snapshot', 'Refset');
      if (fs.existsSync(snapshotPath)) {
        const refsetFiles = fs.readdirSync(snapshotPath, { recursive: true }) as string[];
        const refsetFile = refsetFiles.find((f) => f.endsWith('.txt'));
        if (refsetFile) {
          // Extract module from filename (e.g., _1000230_)
          const moduleMatch = refsetFile.match(/_(\d{7,})_/);
          if (moduleMatch) {
            module = `${moduleMatch[1]}`;
            // Add known module names
            if (moduleMatch[1] === '1000230') {
              module = 'UK Primary Care (1000230)';
            }
          }
        }
      }
    } catch (error) {
      console.warn('Could not detect module from RF2 files:', error);
    }

    const versionInfo: RF2VersionInfo = {
      releaseDate,
      releaseId,
      folderName: rf2Folder,
      module,
      edition: edition.replace(/([A-Z])/g, ' $1').trim(), // Add spaces: "UKPrimaryCare" -> "UK Primary Care"
    };

    // Cache the result
    cachedRF2Version = versionInfo;

    return versionInfo;
  } catch (error) {
    console.error('Error detecting RF2 version:', error);
    return null;
  }
}

/**
 * Gets the RF2 version info for API responses
 */
export function getRF2VersionInfo(): RF2VersionInfo | null {
  return detectRF2Version();
}

/**
 * Gets the RF2 folder name dynamically
 * Returns null if no RF2 folder is found
 */
export function getRF2FolderName(): string | null {
  const versionInfo = detectRF2Version();
  return versionInfo?.folderName || null;
}
