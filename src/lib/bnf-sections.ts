/**
 * BNF Section definitions
 * Fetched from https://openprescribing.net/bnf/
 * Updated manually when BNF structure changes
 * 
 * Format: BNF code -> Display name
 * Includes chapters down to 3rd level (e.g., 2.8.1)
 */

export interface BnfSection {
  code: string; // Display code (e.g., "2.8.2")
  urlCode: string; // Zero-padded URL code (e.g., "020802")
  name: string;
}

/**
 * Fetches and parses BNF sections from OpenPrescribing
 * Returns sections down to 3rd level (e.g., 2.8.1)
 * Uses Next.js 16 'use cache' directive to cache results
 */
export async function fetchBnfSections(): Promise<BnfSection[]> {
  'use cache';
  try {
    const response = await fetch('https://openprescribing.net/bnf/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EMIS-XML-Analyser/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch BNF page: ${response.status}`);
    }

    const html = await response.text();
    const sections: BnfSection[] = [];
    
    // Parse anchor tags containing BNF sections
    // Format: <a href="/bnf/020802/">2.8.2: Oral anticoagulants</a>
    // We want sections up to 3rd level (X.Y.Z format)
    // Extract both the URL code (020802) and display code (2.8.2)
    const anchorPattern = /<a[^>]*href="\/bnf\/(\d+)\/">(\d+(?:\.\d+){0,2}):\s*([^<]+)<\/a>/g;
    const matches = html.matchAll(anchorPattern);
    
    for (const match of matches) {
      const [, urlCode, code, name] = match;
      // Only include up to 3rd level (max 2 dots in code: X, X.Y, or X.Y.Z)
      const dotCount = (code.match(/\./g) || []).length;
      if (dotCount <= 2) {
        sections.push({ code, urlCode, name: name.trim() });
      }
    }

    return sections;
  } catch (error) {
    console.error('Failed to fetch BNF sections:', error);
    return [];
  }
}

/**
 * Searches BNF sections for a match against display name
 * Returns the best matching section if found
 */
export function findBnfSection(displayName: string, sections: BnfSection[]): BnfSection | null {
  const searchLower = displayName.toLowerCase();
  
  // Try exact match first
  let match = sections.find((section) => {
    const nameLower = section.name.toLowerCase();
    return nameLower === searchLower;
  });
  
  if (match) return match;
  
  // Try partial matches
  match = sections.find((section) => {
    const nameLower = section.name.toLowerCase();
    
    // Check if BNF name contains our search term
    if (nameLower.includes(searchLower)) return true;
    
    // Check if search term contains BNF name (or part after colon)
    if (searchLower.includes(nameLower)) return true;
    
    // Check part after colon (for "Chapter X: Name" format)
    const namePart = nameLower.split(':')[1]?.trim() || nameLower;
    if (searchLower.includes(namePart) || namePart.includes(searchLower)) return true;
    
    return false;
  });
  
  return match || null;
}

