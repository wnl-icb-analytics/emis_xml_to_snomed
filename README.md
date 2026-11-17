# EMIS XML SNOMED Analyzer

A Next.js application for analyzing EMIS XML exports and expanding SNOMED codes using a terminology server API.

## Features

- **Drag-and-drop XML upload**: Upload EMIS search export XML files
- **Hierarchical display**: View searches organized by Rules and Features
- **Selective processing**: Choose specific searches to analyze or select all
- **On-demand code expansion**: Query terminology server only when needed
- **Batched API requests**: Minimize API calls by batching parent codes with ECL OR operators
- **SQL-ready output**: Copy formatted codes as single-quoted, comma-separated values for SQL IN clauses
- **Compare mode**: Diff two versions of a search set (e.g. LTC LCS R5 vs R6) and export the diff as JSON or Markdown

## Setup

### Prerequisites

- Node.js 18+ and npm
- Access to OntoServer terminology API
- OAuth credentials (CLIENT_ID and CLIENT_SECRET)

### Installation

1. Clone or navigate to the project directory:
```bash
cd C:\Projects\emis_xml_analyser_and_snomed_exporter
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:

Copy `.env.example` to `.env.local` and fill in your credentials:

```bash
ACCESS_TOKEN_URL=https://ontology.onelondon.online/authorisation/auth/realms/terminology/protocol/openid-connect/token
CLIENT_ID=your_client_id_here
CLIENT_SECRET=your_client_secret_here
TERMINOLOGY_SERVER=https://ontology.onelondon.online/production1/fhir
```

### Development

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm run start
```

## Usage

1. **Upload XML**: Drag and drop an EMIS XML export file or click to select
2. **Review Searches**: Expand Rules to see Features (searches) within each Rule
3. **Select Features**: Check boxes next to searches you want to analyze, or use "Select All"
4. **Expand Codes**: Click "Expand Codes" on individual features to query the terminology server
5. **Copy SQL**: Use the "Copy SQL" button to copy formatted codes for database queries

## Comparing search sets

Compare mode diffs two shared XML files. Pick the older and newer file in the sidebar; changed searches are listed there by folder (`j` / `k` move through them). The overview opens on **patch notes**: highlights (edits made across several searches, code list changes, new and removed folders, folder moves), then every changed search with each change on one line as its exact delta (`<= 90` ⇒ `< 90`, labelled with its rule and criterion), edits repeated within a search grouped with a count, new and removed logic in full, and code list changes with the codes added and removed. New searches show their full logic; removed and moved searches are listed. Changed searches are ordered by reach: how many searches depend on them (transitively) and how many of those are outputs nothing else depends on, listed under each search. Edits that only move a year on (`01/04/2025` ⇒ `01/04/2026`, `2025-26` ⇒ `2026-27`, `APR25` ⇒ `APR26`) are folded as routine; searches with nothing else are listed under "Routine year rollover". Common edits carry a plain-English note: a boundary made strict or inclusive, a threshold or look-back window changed, latest ⇄ earliest record, a code list swapped, a rule's pass/fail outcome, AND ⇄ OR, NOT added or removed, a library item replaced by criteria, and two same-column filters reduced to one. A criterion whose code list changed and that keeps less than half its lines is shown as replaced, with old and new logic side by side, since EMIS keeps a criterion's ID when an author repurposes it. Changed code lists can be expanded on the terminology server (both versions, including children, refset members and EMIS code translation) to show the SNOMED concepts gained and lost; codes the server cannot expand are counted and make the result approximate. The "Summary tables" tab keeps the earlier tables. Each search shows:

- **Properties**: name, folder, description, parent and population criteria, with only the edited characters marked (`APR25` → `APR26`).
- **Rules & codes**: each rule as an Explore-style card holding an indented outline, one line per criterion, condition, restriction or group. Changes are marked by a coloured gutter (green new, red removed, amber edited) with edited characters highlighted, and pass/fail actions or operators shown old → new. "Changes only" folds unchanged rules and criteria to one line; "Full search" shows everything. A floating control (or `n` / `p`) steps through each change. Searches whose rules are identical but whose code list contents changed are tagged "logic unchanged". New and removed searches show their full logic without change marks.
- **Code lists**: each list added, removed or changed, with a plain-English summary (e.g. "Replaced 521 codes with refset 12463601000001108"). Changed lists open in place under the filter that uses them to show the codes added, removed or with include-children changed; the overview's code list table links straight to them.
- **Implementation guide**: the guide text diff, one block per rule and criterion. Edits repeated on several lines (e.g. `01/04/2025` → `01/04/2026`) are summarised, identical blocks in different rules are shown once, and long runs of new or removed lines start folded. New and removed searches show the full guide.

Rules and criteria are paired by their EMIS IDs, which survive re-export, then by content.

EMIS re-exports give every search, folder and parent a new GUID, so searches are matched on:

1. Folder path (without the root folder) and name. Duplicates pair by parent and content.
2. Identical content, when the folder (years normalised) or name is related.
3. Shared criteria group IDs, which survive re-export.
4. Unique name and search type.
5. Leftover duplicates: parent search via the matches so far, criteria group IDs, then code overlap of at least 0.5.
6. Versioned replacements in the same folder (years normalised): the same bracketed search ID ignoring version tokens (`[ICS_HTN_21 v3 FYYTD]` → `[ICS_HTN_21 v4_NICE FYYTD]`), or name-token overlap of at least 0.5 plus a shared criterion or code. Tied candidates stay unmatched.

Parent and population-criteria references are compared through these matches. References to searches outside both files produce a warning.

Code lists within a matched search are paired by identical content, then cluster ID, then code overlap of at least 0.5, so a list renumbered from `_vs1` to `_vs4` is not a change. Before diffing the guides, old search names and code list names are mapped to the new ones, the code list table is dropped (code list changes cover it), and criterion labels (`Criterion B`, `A.3.1`) are ignored when aligning lines, so inserting a criterion does not mark every later one as changed.

Most searches depend on a few shared registers, so the JSON lists the changed searches each changed or in-scope search depends on; for the rest it gives a count (`affected`).

An optional scope file limits the view to searches you depend on. It takes a JSON array of `{ "folder", "name" }` rows, or an object with a `searches` array whose rows may carry `models` or `tags`. Searches that in-scope ones depend on (parents and population criteria, transitively) are flagged, and unchanged in-scope searches that depend on a changed search are listed with those changes. Scope rows found in neither file, or only under their old name, are listed for follow-up.

Downloads:

- **JSON** (`schemaVersion` 2): every search with its status; changed, added and removed searches carry `rules` (the rules view as data), `codeLists` (one summary per list) and codes tagged with their `list`; modified searches carry guide patches whose hunk headers name the rule and criterion, and added/removed searches the full guide.
- **Patch notes** (Markdown): the patch notes above; code lists sit in collapsible `<details>` blocks. The command line writes them to `<outPrefix>.patch-notes.md`.
- **Full Markdown**: summary, scope rows to check, folder moves, changed folders, code list changes, impact by scope tag, added/removed lists, and per-search changes with code lists, repeated edits and `diff` blocks.

`/api/xml-diff` keeps responses under 4 MB (Vercel's limit is 4.5 MB) by leaving out guides, then code lists, for added/removed searches, then rules (added/removed first). The command line has no limit.

The same output is available from the command line:

```bash
npx tsx scripts/diff-xml.ts <base.xml> <target.xml> <outPrefix> [scope.json] [scopeLabel]
```

This writes `<outPrefix>.json`, `<outPrefix>.md` and, with a scope, `<outPrefix>.scope.md`.

## Architecture

### Criterion rendering

Value sets within one filter are joined with OR. Separate filters are joined
with AND, including filters on the same column. Status and prescription type
remain separate filters. When code lists share a column, one record must match
all those filters, so lists with no overlap select no records.

Filters select candidate records first. A restriction then keeps the latest or
earliest N records in its stated order and applies its test to the kept records.
For N greater than 1, at least one kept record must meet the test. Date wording
distinguishes strict bounds from inclusive bounds and retains the search-date
upper bound.

#### Known gaps

Library-item filters within list-report columns are not parsed, so their
same-column conjunctions are not shown or flagged. Guides omit excluded codes
inside filters. Some reused `_vsN` names refer to different code lists within
one report; use the source value-set IDs to distinguish them.

### Technology Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript (strict mode)
- **UI**: shadcn/ui + Tailwind CSS
- **XML Parsing**: fast-xml-parser (server-side)
- **API**: OAuth 2.0 + FHIR terminology server

### Key Components

- **src/lib/xml-parser.ts**: Parses EMIS XML and extracts Rules, Features, SNOMED codes
- **src/lib/oauth-client.ts**: Manages OAuth tokens with caching
- **src/lib/ecl-builder.ts**: Constructs ECL queries for terminology server
- **src/lib/terminology-client.ts**: Interfaces with FHIR terminology API
- **src/app/api/xml/parse/route.ts**: XML parsing API endpoint
- **src/app/api/terminology/expand/route.ts**: Code expansion API endpoint

### Data Flow

```
1. User uploads XML → Server parses → Returns structured data
2. Client displays Rules → Features (hierarchical view)
3. User selects features → Clicks expand
4. Client sends codes → Server builds ECL query → Terminology API
5. Server returns expanded codes → Client displays SQL-formatted output
```

## API Integration

### OAuth Flow

- Grant type: Client Credentials
- Token caching with 60s expiration buffer
- Singleton pattern prevents concurrent token requests

### Terminology Server

- **Endpoint**: `/ValueSet/$expand`
- **ECL Format**: `<<code1 OR <<code2` (descendants with OR operators)
- **Exclusions**: `(<<code1 OR <<code2) MINUS (<<excluded1)`
- **Response**: FHIR ValueSet expansion with `code`, `display`, `system`

## Development Notes

### Local extraction

With the terminology OAuth environment variables set, run:

```powershell
npx tsx scripts/extract-xml.ts "path/to/searches.xml" "path/to/output" strict
```

This writes six normalised CSVs, a manifest, the per-code translation metadata
and a local terminology-response cache. It does not upload or load data.
`original_codes.csv` appends `translation_equivalence` without changing the
existing columns. The primary CodeID map relationship survives rejection by
the expansion filter. A DrugCodeID relationship supplies the value only when
the primary map has no match. `unmapped` means neither map returned an equivalence part, including a match without that part.
The exported equivalence can describe the primary map while the selected target
comes from the DrugCodeID fallback. It does not describe a manual exception override.

Preparation systems (`SCT_CONST`, `SCT_PREP`, `DrugCodeID`) always use preparation
resolution, including device names such as Turbohaler, Easyhaler, Ellipta and
Respimat. Other systems use terminology-server ancestry. A substance, VTM or
medicinal-product target enters preparation resolution rather than descendant
subtraction. Targets with no current ancestry use exact-only fallback.
The guard does not infer hierarchy level from a display name.

One exact active dm+d VMP/AMP match removes its formulation family. Matching keeps
ingredient-dose pairs, form, device, qualifiers and supplier. Spacing, singular
forms and the position of the dosage form may differ. Ambiguous VMP/AMP matches
remain unresolved. If no single active match exists, one exact inactive dm+d
product supplies the exclusion without historical substitution. Descendants
require verified VMP/AMP ancestry. Otherwise the inactive target is exact-only.
A loaded VMP/AMP is retained exactly alongside an inactive match. Retaining a
loaded VMP never widens its exclusion to its AMPs. The VMP and AMP root concepts
are not preparations and cannot authorise descendant subtraction.

Unresolved preparations use `legacy_exact`, which subtracts the loaded target
without descendants. A loaded null stays null. This deliberately differs from
June's ordinary-ECL branch, which subtracted descendants. Reproducing that branch
for an unresolved preparation could subtract an ingredient family and would
conflict with the policy that ingredient families must never be subtracted.
June's SCT_CONST and RF2 fallback scope was already
exact-only. Structurally clinical exceptions retain descendant subtraction.

For a republish, supply loaded exception targets and the existing catalogue:

```powershell
npx tsx scripts/extract-xml.ts "searches.xml" "output" all "legacy_exception_targets.json" "loaded_catalogue.json"
```

The target file maps original XML exception codes to loaded SNOMED targets or
`null`. A missing fallback key quarantines that value set. Extraction continues;
the publication gate must reject any quarantine. Without this snapshot,
interactive expansion uses the current ConceptMap and historical maps for fallback.

The catalogue is an object with `reports`, `valuesets`, `originalCodes` and
`exceptions` arrays using the lower-case exported field names. A previous
`tables.json` is accepted. Use the loaded catalogue for a first republish, then
carry its identities into later catalogues. The extractor matches reports by
`report_xml_id` and sets by report, code hash, child/refset flags and exceptions.
A unique code-hash match also preserves a formerly collapsed instance. Ambiguous
matches fail before output. Existing report IDs, value-set IDs, indices and
friendly names survive, including CVD_65 `21e3808c-e538-c84d-ad57-ed87efd5ef46`
and AF_61 `98b8e1d3-7db0-0653-9412-2fdf795e6f61`. New instances receive indices
after the loaded maximum. `identity_mapping.json` records the result. Republish
requires this file alongside loaded targets; identity restoration no longer
depends on an external comparison script. The manifest hashes both inputs.

`src/lib/exception-overrides.ts` contains versioned XML exception corrections.
They run before matching and fallback, validate targets against the
terminology server and record their version and reason on every affected audit
row. Prednesol retains its inactive named brand exactly, rather than substituting
all generic soluble tablets. Loderm and topical erythromycin use the UK 2%
solution VMP. The erythromycin override also retains the original international
cutaneous-solution code exactly, so that code cannot re-enter ordinary ECL sets.
Caduet uses a specific international clinical drug exactly because
no UK dm+d preparation was found. These corrections do not change the inclusion
ConceptMap or its recorded equivalence. The list contains the clinical sources;
targets and membership differences still need publication review.
Five generic fluticasone and beclometasone nasal-spray exceptions use their active
nasal VMPs and AMP descendants. Non-nasal inhaled preparations remain included.
The beclometasone overrides also retain the loaded international nasal-spray
code `766418004` exactly, so the family correction cannot reintroduce it.

`exception_translation_mismatches.json` checks both current translations and
the targets actually applied, including loaded fallback and override targets.
It records `applied_target`, `applied_target_display`, scope and affected value-set
IDs beside the translation. A null applied target means no subtraction for that
exception. Targets without a display also need review. The queue includes names
with no shared ingredient or brand token, including overridden candidates.
This is a review queue, not an automatic mapping
rule. Supplier renames and legitimate synonyms can appear. Dose or route errors
that share an ingredient token still require manual review.
The [upstream reporting note](docs/exception-map-upstream-reporting.md) lists
reviewed incorrect targets and their published map versions.

`exception_resolution_audit.json` records every occurrence's targets, status,
`includeDescendants`, override version and reason. `additionalCodes` records another explicit override target with the same scope.
`additionalDescendantCodes` records extra descendant targets with independent
scope. Retained loaded products now use `additionalExactCodes`, which also records
exact exclusions alongside a primary family. Status is
`resolved_family` for active preparations, mapped clinical exceptions and reviewed
active overrides, `inactive_exact` for inactive matches, or `legacy_exact` for
fallback. Read scope from `includeDescendants`, not status. These audit fields do
not change the seven-column exception CSV. That CSV carries the primary target;
its downstream consumers must not infer scope from the target alone. Review every
`expansion_error`, override and membership diff before publication.

Product searches page to the reported total, retry transient failures and reject
repeated or missing pages. Exceptions resolve sequentially to avoid an unbounded
search burst. The full server ECL path also checks completeness at a server page
cap. The interactive resolver still accepts at most 200 exceptions per request,
inactive search still scans the general SNOMED index, and large SCT_CONST
exclusion lists still share one encoded URL. Those limits fail loudly; larger
exports need a separate request-batching change.

Expansion reuse includes each instance's code system, child/refset flags and
exception codes and names. The original code-only hash remains in the export.
Subtraction respects each exception's scope after combining RF2, ordinary ECL
and recursive SCT_CONST product results.

- Server Components used for API integration (OAuth, parsing)
- Client Components for interactive features (drag-drop, checkboxes)
- Custom events used for XML parsing → hierarchy display communication
- Toast notifications for success/error feedback

## Troubleshooting

### OAuth errors
- Verify CLIENT_ID and CLIENT_SECRET in `.env.local`
- Check ACCESS_TOKEN_URL is correct

### XML parsing errors
- Ensure XML file is valid EMIS export format
- Check browser console for detailed error messages

### Terminology API errors
- Verify TERMINOLOGY_SERVER URL
- Check network connectivity to OntoServer
- Review API rate limits

## License

ISC
