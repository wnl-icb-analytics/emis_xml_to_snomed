/**
 * Code system utility functions for styling and display
 */

export type CodeSystem =
  | 'SNOMED_CONCEPT'
  | 'SCT_CONST'
  | 'SCT_DRGGRP'
  | 'EMISINTERNAL'
  | 'EMIS'
  | string;

/**
 * Gets the Tailwind CSS classes for a code system badge
 * Returns color-coded badges for different code systems
 */
export function getCodeSystemBadgeClass(codeSystem?: string): string {
  if (!codeSystem) {
    return 'text-xs bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700';
  }

  const system = codeSystem.toUpperCase();

  // SNOMED_CONCEPT (blue)
  if (system === 'SNOMED_CONCEPT') {
    return 'text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800';
  }
  // SCT_CONST (pink)
  if (system === 'SCT_CONST') {
    return 'text-xs bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950 dark:text-pink-300 dark:border-pink-800';
  }
  // SCT_DRGGRP (green)
  if (system === 'SCT_DRGGRP') {
    return 'text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800';
  }
  // EMISINTERNAL (purple)
  if (system === 'EMISINTERNAL' || system === 'EMIS') {
    return 'text-xs bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800';
  }

  return 'text-xs bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700';
}

/**
 * Gets a human-readable display name for a code system
 */
export function getCodeSystemDisplayName(codeSystem?: string): string {
  if (!codeSystem) return 'Unknown';

  const system = codeSystem.toUpperCase();

  const displayNames: Record<string, string> = {
    'SNOMED_CONCEPT': 'SNOMED Concept',
    'SCT_CONST': 'SNOMED Constraint',
    'SCT_DRGGRP': 'SNOMED Drug Group',
    'EMISINTERNAL': 'EMIS Internal',
    'EMIS': 'EMIS',
  };

  return displayNames[system] || codeSystem;
}

/**
 * Checks if a code system is a SNOMED-related system
 */
export function isSnomedCodeSystem(codeSystem?: string): boolean {
  if (!codeSystem) return false;
  const system = codeSystem.toUpperCase();
  return system.startsWith('SNOMED') || system.startsWith('SCT_');
}

/**
 * Checks if a code system is an EMIS-related system
 */
export function isEmisCodeSystem(codeSystem?: string): boolean {
  if (!codeSystem) return false;
  const system = codeSystem.toUpperCase();
  return system === 'EMISINTERNAL' || system === 'EMIS';
}

/**
 * Checks if a SNOMED code is a NHS dm+d code based on namespace
 * NHS dm+d codes use namespace 1000001 (UK Drug Extension)
 * SNOMED CT structure: [item ID][namespace 7 digits][check digit 1 digit]
 *
 * NOTE: Codes with namespace 1000033 are EMIS-assigned codes that need
 * ConceptMap translation to NHS dm+d codes (namespace 1000001).
 *
 * Examples of NHS dm+d codes (namespace 1000001):
 * - 13532911000001104 (Dabigatran etexilate 75mg capsules)
 * - 29903211000001100 (Edoxaban 15mg tablets)
 * - 14254711000001104 (Rivaroxaban 10mg tablets)
 */
export function isDmdCode(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  // Must be numeric, at least 9 digits (1 item + 7 namespace + 1 check)
  // NHS dm+d namespace 1000001 appears before the final check digit
  return /^\d+1000001\d{2}$/.test(code);
}

/**
 * Gets dm+d info for display purposes
 */
export function getDmdCodeInfo(code: string): { isDmd: true; namespace: string; type: string } | null {
  if (!isDmdCode(code)) return null;
  return {
    isDmd: true,
    namespace: '1000001',
    type: 'NHS dm+d', // UK Drug Extension - VMP, AMP, VMPP, or AMPP
  };
}
