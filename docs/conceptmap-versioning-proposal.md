# ConceptMap Versioning Proposal

## Current Problem

We currently hardcode specific ConceptMap version IDs in our code:

```typescript
const EMIS_TO_SNOMED_CONCEPT_MAP_ID = '8d2953a3-b70b-4727-8a6a-8b4d912535ad'; // Version 2.1.4
const EMIS_TO_SNOMED_FALLBACK_CONCEPT_MAP_ID = 'b5519813-31eb-4cad-8c77-b8999420e3c9'; // DrugCodeID fallback
```

**Issues:**
- Locks us to specific versions (2.1.0 and 7.1)
- Newer versions exist (2.1.5 and 7.1.1) that we're not using
- Requires code changes and redeployment to update ConceptMap versions
- No automatic access to improved mappings as they're released

## Proposed Solution

Query the FHIR terminology server using canonical URLs to automatically get the latest active version.

### ConceptMap Canonical URLs

**Primary ConceptMap:**
- Canonical URL: `http://LDS.nhs/EMIStoSNOMED/CodeID/cm`
- Current version in code: 2.1.0
- Latest version available: 2.1.5 (23 versions total)

**Fallback ConceptMap:**
- Canonical URL: `http://LDS.nhs/EMIS_to_Snomed/DrugCodeID/cm`
- Current version in code: 7.1
- Latest version available: 7.1.1 (8 versions total, 4 retired)

### FHIR Query Approach

Instead of querying by ID:
```
GET /ConceptMap/{id}/$translate
```

Query by canonical URL to get the latest version first:
```
GET /ConceptMap?url={canonical_url}&_sort=-version&_count=1&status=active
```

Then use the returned ID for translation:
```
POST /ConceptMap/{latest_id}/$translate
```

### Implementation Strategy

#### Option 1: Resolve at Startup (Recommended)
Resolve the latest ConceptMap IDs once when the application starts and cache them:

```typescript
let primaryConceptMapId: string;
let fallbackConceptMapId: string;

async function initializeConceptMaps(token: string) {
  // Query for latest primary ConceptMap
  const primaryBundle = await fetch(
    `${TERMINOLOGY_SERVER}/ConceptMap?url=${encodeURIComponent(PRIMARY_CANONICAL_URL)}&_sort=-version&_count=1&status=active`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const primaryData = await primaryBundle.json();
  primaryConceptMapId = primaryData.entry[0].resource.id;

  // Query for latest fallback ConceptMap
  const fallbackBundle = await fetch(
    `${TERMINOLOGY_SERVER}/ConceptMap?url=${encodeURIComponent(FALLBACK_CANONICAL_URL)}&_sort=-version&_count=1&status=active`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const fallbackData = await fallbackBundle.json();
  fallbackConceptMapId = fallbackData.entry[0].resource.id;
}
```

**Pros:**
- Latest versions are used automatically
- Only one extra query at startup (minimal performance impact)
- Simple to implement
- Can still cache the IDs for the session

**Cons:**
- Requires initialization before first translation
- If new version is published mid-session, won't be picked up until restart

#### Option 2: Lazy Resolution with Caching
Resolve the latest ConceptMap ID on first use and cache it:

**Pros:**
- No startup delay
- Only queries when needed

**Cons:**
- First translation slightly slower
- Still requires session restart to pick up new versions

#### Option 3: Periodic Refresh
Refresh the ConceptMap IDs periodically (e.g., hourly):

**Pros:**
- Can pick up new versions without restart
- Latest mappings used throughout the day

**Cons:**
- More complex
- Unnecessary for most use cases

### Recommended Approach

**Option 1 (Startup Resolution)** is recommended because:
- Simple and predictable
- Minimal performance impact (one extra query per ConceptMap at startup)
- Always uses the latest version available
- Easy to add caching or fallback to hardcoded IDs if resolution fails

### Code Changes Required

1. **src/lib/terminology-client.ts:**
   - Add canonical URL constants
   - Add `getLatestConceptMapId()` function
   - Modify initialization to resolve IDs at startup
   - Keep hardcoded IDs as fallback if resolution fails

2. **Documentation (src/components/docs/code-expansion-steps.tsx):**
   - Update to mention that latest versions are used automatically
   - Remove specific version numbers from documentation

### Backwards Compatibility

Keep hardcoded IDs as fallback in case:
- FHIR server is unavailable during startup
- Canonical URL query fails
- `_sort` parameter is not supported

### Testing

The script `scripts/query-concept-maps.ts` demonstrates:
- ✅ Querying by canonical URL works
- ✅ `_sort=-version&_count=1` returns latest version
- ✅ Authentication with OAuth works
- ✅ Can retrieve ConceptMap metadata (id, version, status)

## Benefits

1. **Always up-to-date:** Automatically uses the latest EMIS→SNOMED mappings
2. **No code changes needed:** New mapping versions are picked up automatically
3. **Better translations:** Access to improved and corrected mappings as they're released
4. **Future-proof:** Works for all future versions without code modification
5. **Transparent:** Version being used can be logged at startup for debugging

## Risks & Mitigation

| Risk | Mitigation |
|------|------------|
| FHIR server query failure | Fall back to hardcoded IDs |
| Breaking changes in new version | Keep hardcoded IDs as override option via env var |
| Performance impact | Cache resolved IDs for session duration |
| Version incompatibility | Filter by `status=active` to exclude draft/retired versions |
