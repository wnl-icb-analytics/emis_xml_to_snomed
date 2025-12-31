// === XML Structure Types ===

export interface EmisXmlDocument {
  namespace: string;
  reports: EmisReport[];
  parsedAt: string;
}

export interface EmisReport {
  id: string; // Deterministic ID generated from report content
  xmlId: string; // Original GUID from XML <id> element
  name: string;
  searchName: string; // Extracted from [search_name] brackets
  description?: string; // Description from XML
  parentType?: 'ACTIVE' | 'ALL' | 'POP' | string; // Parent population type (ACTIVE=registered, ALL=all including deducted/deceased, POP=based on another search)
  parentReportId?: string; // If parentType is POP, the GUID of the parent report (matches xmlId of parent)
  rule: string; // Determined by parent structure in XML
  valueSets: EmisValueSet[];
}

export interface EmisValueSet {
  id: string;
  codeSystem?: string; // e.g., "SNOMED_CONCEPT", "EMIS", etc.
  values: EmisValue[];
  exceptions: EmisException[];
}

export interface EmisValue {
  code: string; // EMIS or SNOMED code (codeSystem determines if translation needed)
  displayName: string;
  includeChildren: boolean;
  isRefset?: boolean; // True if this is a refset ID (should use ^ operator in ECL)
}

export interface EmisException {
  code: string;
}

// === Hierarchical Display Types ===

export interface RuleGroup {
  ruleName: string;
  features: Feature[];
}

export interface Feature {
  id: string;
  name: string;
  displayName: string;
  rule: string;
  valueSets: EmisValueSet[];
  isSelected: boolean;
  isExpanding: boolean;
  expandedCodes?: ExpandedCodeSet;
  error?: string;
}

// === API Response Types ===

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export interface FhirValueSetExpansion {
  resourceType: 'ValueSet';
  expansion: {
    identifier: string;
    timestamp: string;
    total: number;
    contains: FhirConcept[];
  };
}

export interface FhirConcept {
  system: string;
  code: string;
  display: string;
}

export interface ConceptMapTranslateResponse {
  resourceType: 'Parameters';
  parameter?: Array<{
    name: string;
    valueBoolean?: boolean;
    valueString?: string;
    part?: Array<{
      name: string;
      valueCode?: string;
      valueString?: string;
      valueCoding?: {
        system: string;
        code: string;
        display?: string;
      };
    }>;
  }>;
}

export interface TranslatedCode {
  code: string;
  display?: string;
  equivalence?: string;
}

export interface ExpandedCodeSet {
  featureId: string;
  featureName: string;
  concepts: SnomedConcept[];
  totalCount: number;
  sqlFormattedCodes: string; // Single-quoted, comma-separated
  expandedAt: string;
  equivalenceFilterSetting: EquivalenceFilter; // ConceptMap equivalence filter setting used during expansion
  valueSetGroups?: ValueSetGroup[]; // Codes grouped by ValueSet
  error?: string; // Error message if expansion failed
}

export interface ValueSetGroup {
  valueSetId: string; // UUID - unique identifier for the valueset
  valueSetIndex: number;
  valueSetHash: string; // Hash of all codes for duplicate detection
  valueSetFriendlyName: string; // Machine/human readable name (e.g., "diabetes_register_vs1")
  valueSetUniqueName: string; // Same as valueSetId (UUID)
  concepts: SnomedConcept[];
  sqlFormattedCodes: string;
  parentCodes: string[];
  eclExpression?: string; // Formatted ECL expression representing the entire valueset (no URL encoding, no descriptions)
  expansionError?: string; // Error message if expansion failed (e.g., refsets not available)
  failedCodes?: Array<{
    originalCode: string;
    displayName: string;
    codeSystem: string;
    reason: string; // Why it failed (e.g., "No translation found", "Not in terminology server")
  }>;
  // Refset metadata (if this ValueSet contains refsets)
  refsets?: Array<{
    refsetId: string;
    refsetName: string;
  }>;
  // Original XML metadata for debugging
  originalCodes?: Array<{
    originalCode: string;
    displayName: string;
    codeSystem: string;
    includeChildren: boolean;
    isRefset: boolean;
    translatedTo?: string; // SNOMED code after ConceptMap translation
    translatedToDisplay?: string; // Display name of translated SNOMED code
  }>;
}

export interface SnomedConcept {
  code: string;
  display: string;
  system: string;
  source: 'parent' | 'child' | 'rf2_file' | 'terminology_server'; // Track source: original code, expanded child, RF2 file, or terminology server
  excludeChildren?: boolean; // True if includeChildren was false for the parent code
  isRefset?: boolean; // True if this code is a refset ID
}

// === ECL Query Types ===

export interface EclQuery {
  expression: string;
  parentCodes: string[];
  excludedCodes: string[];
}

// === Application State Types ===

export interface AppState {
  xmlFile: File | null;
  parsedData: EmisXmlDocument | null;
  ruleGroups: RuleGroup[];
  selectedFeatures: Set<string>;
  expandedFeatures: Map<string, ExpandedCodeSet>;
  isProcessing: boolean;
  error: string | null;
}

// === API Request/Response Types ===

export interface ParseXmlRequest {
  xmlContent: string;
}

export interface ParseXmlResponse {
  success: boolean;
  data?: EmisXmlDocument;
  error?: string;
}

export type EquivalenceFilter = 'strict' | 'with-broader' | 'with-related' | 'all';

export interface ExpandCodesRequest {
  featureId: string;
  featureName: string;
  parentCodes: string[];
  displayNames?: string[];
  excludedCodes: string[];
  includeChildren: boolean[];
  isRefset?: boolean[]; // Track which codes are refsets
  codeSystems?: string[]; // Code system for each code (e.g., "SNOMED_CONCEPT", "EMIS")
  valueSetMapping?: ValueSetMapping[]; // Track which codes belong to which ValueSet
  equivalenceFilter?: EquivalenceFilter; // ConceptMap equivalence filter setting
}

export interface ValueSetMapping {
  valueSetId: string;
  valueSetIndex: number;
  codeIndices: number[]; // Indices in parentCodes array that belong to this ValueSet
  excludedCodes: string[];
}

export interface ExpandCodesResponse {
  success: boolean;
  data?: ExpandedCodeSet;
  error?: string;
}

export interface BatchExpandRequest {
  features: Array<{
    featureId: string;
    featureName: string;
    parentCodes: string[];
    excludedCodes: string[];
    includeChildren: boolean[];
  }>;
}

export interface BatchExpandResponse {
  success: boolean;
  results: Array<{
    featureId: string;
    data?: ExpandedCodeSet;
    error?: string;
  }>;
}
