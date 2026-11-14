/**
 * Diffs two EMIS XML exports (e.g. LTC LCS R5 vs R6).
 *
 * Re-exports rotate report, folder and parent GUIDs, so searches are matched on
 * folder path + name first and then by content and stable IDs (see matchReports).
 * GUID references (parents, population criteria) are compared through the match
 * map, never by raw value.
 */
import { structuredPatch } from 'diff';
import type { EmisReport, EmisXmlDocument, SearchCriterion } from './types';
import { buildImplementationGuideMarkdown } from './agent-report-utils';
import { generateValueSetFriendlyName } from './valueset-utils';

export const XML_DIFF_SCHEMA_VERSION = '1';

export type SearchDiffStatus = 'added' | 'removed' | 'modified' | 'moved' | 'renamed' | 'unchanged';
export type MatchMethod = 'path' | 'content' | 'stable-ids' | 'name' | 'similar-name' | 'codes';
/** direct: listed in the scope; ancestor: a search a listed one depends on (parent or population criteria) */
export type ScopeRelation = 'direct' | 'ancestor';

/** Minimum name-token overlap (intersection / union) to treat two names as related */
const SIMILAR_NAME_THRESHOLD = 0.5;
/** Minimum code overlap (intersection / union) to pair ambiguous duplicate searches */
const DUPLICATE_CODE_THRESHOLD = 0.5;

export const MATCHING_DESCRIPTION =
  'Folder + name (duplicates by parent and content); then identical content with a related folder or name; ' +
  'shared criteria-group IDs; unique name; code overlap for leftover duplicates; versioned names with shared criteria or codes. ' +
  'Search GUIDs rotate between exports and are ignored.';

export interface SearchRef {
  folder: string;
  name: string;
  type: EmisReport['reportType'];
  /** Parent search name, when the search is based on another search */
  parent?: string;
}

export interface CodeRef {
  code: string;
  displayName: string;
  codeSystem: string;
  cluster: string | null;
  includeChildren: boolean;
  isRefset: boolean;
  /** True for an exception (excluded code) */
  excluded: boolean;
}

export type FieldName = 'name' | 'folder' | 'description' | 'parent' | 'reportType' | 'populationCriteria';

export const FIELD_LABEL: Record<FieldName, string> = {
  name: 'Name',
  folder: 'Folder',
  description: 'Description',
  parent: 'Parent search',
  reportType: 'Search type',
  populationCriteria: 'Population criteria',
};

export interface FieldChange {
  field: FieldName;
  from: string | null;
  to: string | null;
}

export interface UpstreamChange {
  folder: string;
  name: string;
  status: SearchDiffStatus;
}

export interface SearchDiffEntry {
  status: SearchDiffStatus;
  matchedBy?: MatchMethod;
  base?: SearchRef;
  target?: SearchRef;
  moved: boolean;
  renamed: boolean;
  contentChanged: boolean;
  fieldChanges: FieldChange[];
  codesAdded: CodeRef[];
  codesRemoved: CodeRef[];
  /** Same code in both, but includeChildren differs */
  codesChildrenChanged: Array<{ code: string; displayName: string; from: boolean; to: boolean }>;
  libraryItemsAdded: string[];
  libraryItemsRemoved: string[];
  /** Unified diff of the implementation guide text (rule logic in plain English) */
  guidePatch?: string;
  /** Full guide for added/removed searches */
  guide?: string;
  /** Set when the guide was dropped to keep an API response small */
  guideOmitted?: boolean;
  /** Number of codes dropped to keep an API response small */
  codesOmitted?: number;
  /** References that could not be checked, e.g. a parent search outside both exports */
  warnings: string[];
  /** Searches that use this one as parent or population criteria (newer side; older side for removed) */
  dependents: number;
  scope?: ScopeRelation;
  /** Labels from the scope list, e.g. dbt model names */
  scopeTags?: string[];
  /** In-scope searches only: changed searches they depend on through parents or population criteria */
  upstreamChanges?: UpstreamChange[];
}

export interface FolderSummary {
  folder: string;
  added: number;
  removed: number;
  modified: number;
  moved: number;
  renamed: number;
  unchanged: number;
}

export interface FolderMove {
  from: string;
  to: string;
  searches: number;
}

export interface DiffSideInfo {
  label: string;
  fileName: string;
  searchCount: number;
}

export interface DiffScopeInput {
  label: string;
  searches: Array<{ folder: string; name: string; tags?: string[] }>;
}

export interface DiffScopeSummary {
  label: string;
  /** Distinct folder + name rows in the scope list */
  searches: number;
  matched: number;
  /** Searches that in-scope searches depend on */
  ancestors: number;
  /** In-scope searches unchanged themselves but depending on a changed search */
  affectedUpstream: number;
  /** Scope rows found in neither file */
  unmatched: Array<{ folder: string; name: string }>;
  /** Scope rows found only under their older (base) folder or name */
  baseOnly: Array<{ folder: string; name: string }>;
}

export interface XmlDiffResult {
  schemaVersion: string;
  generatedAt: string;
  base: DiffSideInfo;
  target: DiffSideInfo;
  summary: Record<SearchDiffStatus, number>;
  folders: FolderSummary[];
  folderMoves: FolderMove[];
  scope?: DiffScopeSummary;
  /** Present when guides or code lists were dropped to fit a size limit */
  trimmed?: { guides: number; codeLists: number };
  /** Every search; unchanged entries carry identity only */
  entries: SearchDiffEntry[];
}

export interface DiffInputSide {
  doc: EmisXmlDocument;
  fileName: string;
  label?: string;
}

// === Helpers ===

const folderOf = (r: EmisReport) => r.rule.split(' > ').slice(1).join(' > ');
const keyOf = (r: EmisReport) => `${folderOf(r)} :: ${r.name}`;
const rootLabel = (doc: EmisXmlDocument) => doc.reports[0]?.rule.split(' > ')[0] ?? '';
/** Newer side's identity, or the older side for removed searches */
export const entryRef = (e: SearchDiffEntry): SearchRef => (e.target ?? e.base)!;
const emptyCounts = (): Record<SearchDiffStatus, number> => ({ added: 0, removed: 0, modified: 0, moved: 0, renamed: 0, unchanged: 0 });

/** Keys holding GUIDs that rotate on re-export, or identity fields compared separately */
const VOLATILE_KEYS = new Set(['id', 'xmlId', 'rule', 'name', 'searchName', 'parentReportId', 'reportGuid']);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      if (VOLATILE_KEYS.has(k)) continue;
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      out[k] = canonical(v);
    }
    return out;
  }
  return value;
}

const fingerprint = (r: EmisReport) => JSON.stringify(canonical(r));

/** Criteria-group IDs survive re-export; copied searches share them, so only a tiebreaker */
const stableSig = (r: EmisReport) => (r.criteriaGroups ?? []).map((g) => g.id).sort().join(',');

/** Criterion IDs (incl. nested/linked) and codes; evidence that two differently named searches are related */
function evidenceOf(r: EmisReport): Set<string> {
  const out = new Set<string>();
  const walk = (c: SearchCriterion) => {
    out.add(`c|${c.id}`);
    c.linkedCriteria.forEach(walk);
    c.baseCriteriaGroups?.forEach((g) => g.criteria.forEach(walk));
  };
  (r.criteriaGroups ?? []).forEach((g) => g.criteria.forEach(walk));
  (r.columnGroups ?? []).forEach((g) => g.criteria.forEach(walk));
  r.valueSets.forEach((vs) => vs.values.forEach((v) => out.add(`v|${v.code}`)));
  return out;
}

const codeSet = (r: EmisReport) => new Set(r.valueSets.flatMap((vs) => vs.values.map((v) => v.code)));

function collectCodes(r: EmisReport): Map<string, CodeRef> {
  const out = new Map<string, CodeRef>();
  for (const vs of r.valueSets) {
    const cluster = vs.description || null;
    const codeSystem = vs.codeSystem || 'UNKNOWN';
    for (const v of vs.values) {
      const key = `i|${cluster ?? ''}|${codeSystem}|${v.code}`;
      if (!out.has(key)) {
        out.set(key, {
          code: v.code,
          displayName: v.displayName && v.displayName !== v.code ? v.displayName : '',
          codeSystem,
          cluster,
          includeChildren: v.includeChildren,
          isRefset: !!v.isRefset,
          excluded: false,
        });
      }
    }
    for (const e of vs.exceptions) {
      const key = `x|${cluster ?? ''}|${codeSystem}|${e.code}`;
      if (!out.has(key)) {
        out.set(key, { code: e.code, displayName: e.displayName || '', codeSystem, cluster, includeChildren: false, isRefset: false, excluded: true });
      }
    }
  }
  return out;
}

const libraryItems = (r: EmisReport) => new Set((r.criteriaGroups ?? []).flatMap((g) => g.libraryItemRefs ?? []));

const jaccard = <T,>(a: Set<T>, b: Set<T>) => {
  let inter = 0;
  a.forEach((x) => b.has(x) && inter++);
  return inter / (a.size + b.size - inter || 1);
};

const tokenList = (s: string) =>
  s
    .toLowerCase()
    .replace(/([a-z])(\d)|(\d)([a-z])/g, '$1$3 $2$4')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const tokens = (s: string) => new Set(tokenList(s));
/** Leading bracketed search ID without version tokens: "[ICS_HTN_21 v4_NICE FYYTD]" → "ics htn 21 fyytd" */
const tagOf = (s: string) => {
  const m = s.match(/^\s*\[([^\]]+)\]/);
  if (!m) return '';
  return tokenList(m[1].toLowerCase().replace(/_/g, ' ').replace(/\bv\d+\b|\bnice\b/g, ' ')).join(' ');
};
const namesRelated = (a: EmisReport, b: EmisReport) => {
  const ta = tagOf(a.name);
  return (!!ta && ta === tagOf(b.name)) || jaccard(tokens(a.name), tokens(b.name)) >= SIMILAR_NAME_THRESHOLD;
};
/** Folder with financial years normalised, so "2025-26 Outcome" and "2026-27 Outcome" compare equal */
const normFolder = (r: EmisReport) => folderOf(r).replace(/\b20\d\d-\d\d\b/g, 'YYYY-YY');

const vsPrefix = (name: string) => generateValueSetFriendlyName(name, 0).replace(/_vs\d+$/, '');

function guideText(r: EmisReport, all: EmisReport[]): string {
  // Folder/Source lines are reported as field changes; strip to avoid noise
  return buildImplementationGuideMarkdown(r, all)
    .split('\n')
    .filter((line) => !line.startsWith('Folder: ') && !line.startsWith('Source: '))
    .join('\n');
}

function unifiedPatch(a: string, b: string): string | undefined {
  if (a === b) return undefined;
  const patch = structuredPatch('base', 'target', `${a}\n`, `${b}\n`, '', '', { context: 2 });
  if (patch.hunks.length === 0) return undefined;
  return patch.hunks
    .map((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n'))
    .join('\n');
}

interface Side {
  reports: EmisReport[];
  byGuid: Map<string, EmisReport>;
  /** GUID → number of searches referencing it as parent or population criteria */
  referencedBy: Map<string, number>;
}

const popGuids = (r: EmisReport) => (r.criteriaGroups ?? []).flatMap((g) => g.populationCriteria.map((p) => p.reportGuid));
const popParent = (r: EmisReport) => (r.parentType === 'POP' ? r.parentReportId : undefined);
/** GUIDs this search depends on: its parent and population-criteria searches */
const dependencyGuids = (r: EmisReport) => [...new Set([popParent(r), ...popGuids(r)].filter((g): g is string => !!g))];

function indexSide(doc: EmisXmlDocument): Side {
  const byGuid = new Map(doc.reports.map((r) => [r.xmlId, r]));
  const referencedBy = new Map<string, number>();
  for (const r of doc.reports) {
    for (const g of dependencyGuids(r)) referencedBy.set(g, (referencedBy.get(g) ?? 0) + 1);
  }
  return { reports: doc.reports, byGuid, referencedBy };
}

function refOf(r: EmisReport, side: Side): SearchRef {
  const p = popParent(r);
  const parent = p ? side.byGuid.get(p)?.name : undefined;
  return { folder: folderOf(r), name: r.name, type: r.reportType, ...(parent ? { parent } : {}) };
}

// === Matching ===

type Pairs = Map<EmisReport, { other: EmisReport; by: MatchMethod }>;

function matchReports(base: Side, target: Side) {
  const pairs: Pairs = new Map();
  const reverse = new Map<EmisReport, EmisReport>();
  const fp = new Map<EmisReport, string>();
  const getFp = (r: EmisReport) => {
    let v = fp.get(r);
    if (v === undefined) fp.set(r, (v = fingerprint(r)));
    return v;
  };
  const link = (a: EmisReport, b: EmisReport, by: MatchMethod) => {
    pairs.set(a, { other: b, by });
    reverse.set(b, a);
  };
  const openB = (r: EmisReport) => !pairs.has(r);
  const openT = (r: EmisReport) => !reverse.has(r);

  /** Pairs within two lists when a key is non-empty and unique on both sides */
  const pairUnique = (bs: EmisReport[], ts: EmisReport[], keyB: (r: EmisReport) => string, keyT: (r: EmisReport) => string, by: MatchMethod) => {
    const index = (rs: EmisReport[], key: (r: EmisReport) => string) => {
      const m = new Map<string, EmisReport | null>();
      for (const r of rs) {
        const k = key(r);
        if (k) m.set(k, m.has(k) ? null : r);
      }
      return m;
    };
    const ib = index(bs.filter(openB), keyB);
    const it = index(ts.filter(openT), keyT);
    for (const [k, b] of ib) {
      const t = it.get(k);
      if (b && t) link(b, t, by);
    }
  };

  // Parent identity by name, usable before parents are matched; '' when not based on another search
  const parentName = (r: EmisReport, side: Side) => {
    const g = popParent(r);
    if (!g) return r.parentType ?? '';
    const p = side.byGuid.get(g);
    return p ? keyOf(p) : 'unresolved';
  };

  // 1. Folder + name. Within a duplicate group, pair by parent + content, then content.
  //    Groups still ambiguous are resolved after the global passes, when parents are matched.
  const group = (rs: EmisReport[]) => {
    const m = new Map<string, EmisReport[]>();
    for (const r of rs) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]);
    return m;
  };
  const tg = group(target.reports);
  const deferred: Array<{ bs: EmisReport[]; ts: EmisReport[] }> = [];
  for (const [key, bs] of group(base.reports)) {
    const ts = tg.get(key) ?? [];
    if (ts.length === 0) continue;
    if (bs.length === 1 && ts.length === 1) {
      link(bs[0], ts[0], 'path');
      continue;
    }
    // Searches identical in parent and content are interchangeable, so pair them in order
    const pairEqual = (kb: (r: EmisReport) => string, kt: (r: EmisReport) => string) => {
      for (const b of bs.filter(openB)) {
        const t = ts.find((x) => openT(x) && kt(x) === kb(b));
        if (t) link(b, t, 'path');
      }
    };
    pairEqual((r) => `${parentName(r, base)}\u0000${getFp(r)}`, (r) => `${parentName(r, target)}\u0000${getFp(r)}`);
    pairUnique(bs, ts, getFp, getFp, 'path');
    const lb = bs.filter(openB);
    const lt = ts.filter(openT);
    if (lb.length === 1 && lt.length === 1) link(lb[0], lt[0], 'path');
    else if (lb.length && lt.length) deferred.push({ bs, ts });
  }

  const unmatchedB = () => base.reports.filter(openB);
  const unmatchedT = () => target.reports.filter(openT);

  // 2. Identical content, unique on both sides, with a related folder or name (guards against
  //    unrelated searches that happen to share logic)
  {
    const ub = new Map<string, EmisReport | null>();
    for (const r of unmatchedB()) ub.set(getFp(r), ub.has(getFp(r)) ? null : r);
    const ut = new Map<string, EmisReport | null>();
    for (const r of unmatchedT()) ut.set(getFp(r), ut.has(getFp(r)) ? null : r);
    for (const [k, b] of ub) {
      const t = ut.get(k);
      if (b && t && (normFolder(b) === normFolder(t) || namesRelated(b, t))) link(b, t, 'content');
    }
  }

  // 3. Shared criteria-group IDs, unique on both sides
  pairUnique(unmatchedB(), unmatchedT(), stableSig, stableSig, 'stable-ids');

  // 4. Unique name and same search type
  pairUnique(unmatchedB(), unmatchedT(), (r) => `${r.reportType}\u0000${r.name}`, (r) => `${r.reportType}\u0000${r.name}`, 'name');

  // 5. Leftover duplicate groups: parent through the match map, stable IDs, then best code overlap
  for (const { bs, ts } of deferred) {
    const parentVia = (r: EmisReport, side: Side, viaPairs: boolean) => {
      const g = popParent(r);
      const p = g && side.byGuid.get(g);
      if (!p) return '';
      const id = viaPairs ? pairs.get(p)?.other : p;
      return id ? id.xmlId : '';
    };
    pairUnique(bs, ts, (r) => parentVia(r, base, true), (r) => parentVia(r, target, false), 'path');
    pairUnique(bs, ts, stableSig, stableSig, 'path');
    const scored: Array<{ b: EmisReport; t: EmisReport; score: number }> = [];
    for (const b of bs.filter(openB)) {
      for (const t of ts.filter(openT)) {
        const score = jaccard(codeSet(b), codeSet(t));
        if (score >= DUPLICATE_CODE_THRESHOLD) scored.push({ b, t, score });
      }
    }
    linkBest(scored, 'codes');
    const lb = bs.filter(openB);
    const lt = ts.filter(openT);
    if (lb.length === 1 && lt.length === 1) link(lb[0], lt[0], 'path');
  }

  // 6. Versioned replacements: same folder (years normalised) and type, plus the same bracketed
  //    search ID, or related names with shared criterion IDs or codes
  {
    const scored: Array<{ b: EmisReport; t: EmisReport; score: number }> = [];
    const ut = unmatchedT();
    for (const b of unmatchedB()) {
      const tagB = tagOf(b.name);
      for (const t of ut) {
        if (t.reportType !== b.reportType || normFolder(t) !== normFolder(b)) continue;
        if (tagB && tagB === tagOf(t.name)) {
          scored.push({ b, t, score: 1 });
          continue;
        }
        const score = jaccard(tokens(b.name), tokens(t.name));
        if (score < SIMILAR_NAME_THRESHOLD) continue;
        const eb = evidenceOf(b);
        if ([...evidenceOf(t)].some((x) => eb.has(x))) scored.push({ b, t, score });
      }
    }
    linkBest(scored, 'similar-name');
  }

  /** Greedy best-score pairing; candidates tied with another open option are left unmatched */
  function linkBest(scored: Array<{ b: EmisReport; t: EmisReport; score: number }>, by: MatchMethod) {
    const open = (c: (typeof scored)[number]) => openB(c.b) && openT(c.t);
    scored.sort((x, y) => y.score - x.score || keyOf(x.b).localeCompare(keyOf(y.b)) || keyOf(x.t).localeCompare(keyOf(y.t)));
    for (const c of scored) {
      if (!open(c)) continue;
      const tied = scored.some((o) => o !== c && o.score === c.score && (o.b === c.b || o.t === c.t) && open(o));
      if (!tied) link(c.b, c.t, by);
    }
  }

  return { pairs, reverse, getFp };
}

/** Maps renamed searches' base names and ValueSet name prefixes to their target equivalents */
function renameMap(pairs: Pairs): Array<[string, string]> {
  const out = new Map<string, string>();
  for (const [b, { other: t }] of pairs) {
    if (b.name === t.name) continue;
    // Short names would replace unrelated text
    if (b.name.length >= 6) out.set(b.name, t.name);
    if (b.searchName && b.searchName.length >= 6 && b.searchName !== t.searchName) out.set(b.searchName, t.searchName);
    const bp = vsPrefix(b.name);
    const tp = vsPrefix(t.name);
    if (bp && bp !== tp) out.set(`${bp}_vs`, `${tp}_vs`);
  }
  return [...out].sort((a, b) => b[0].length - a[0].length);
}

const applyRenames = (text: string, renames: Array<[string, string]>) => renames.reduce((s, [from, to]) => s.split(from).join(to), text);

// === Diff ===

export function diffXmlDocuments(
  baseIn: DiffInputSide,
  targetIn: DiffInputSide,
  options: { scope?: DiffScopeInput; generatedAt?: string } = {}
): XmlDiffResult {
  const base = indexSide(baseIn.doc);
  const target = indexSide(targetIn.doc);
  const { pairs, reverse, getFp } = matchReports(base, target);
  const renames = renameMap(pairs);
  // Library-item names are inferred from wrapper searches; use both exports so labels agree
  const allReports = [...base.reports, ...target.reports];

  const parentLabel = (r: EmisReport, side: Side) => {
    const g = popParent(r);
    if (!g) return r.parentType ?? null;
    const p = side.byGuid.get(g);
    return p ? keyOf(p) : `unknown search ${g}`;
  };

  const entries: SearchDiffEntry[] = [];
  const empty = () => ({
    moved: false,
    renamed: false,
    contentChanged: false,
    fieldChanges: [] as FieldChange[],
    codesAdded: [] as CodeRef[],
    codesRemoved: [] as CodeRef[],
    codesChildrenChanged: [] as SearchDiffEntry['codesChildrenChanged'],
    libraryItemsAdded: [] as string[],
    libraryItemsRemoved: [] as string[],
    warnings: [] as string[],
  });
  const entryReports = new Map<SearchDiffEntry, { b?: EmisReport; t?: EmisReport }>();

  for (const b of base.reports) {
    const m = pairs.get(b);
    if (!m) {
      const e: SearchDiffEntry = {
        ...empty(),
        status: 'removed',
        base: refOf(b, base),
        codesRemoved: [...collectCodes(b).values()],
        guide: guideText(b, base.reports),
        dependents: base.referencedBy.get(b.xmlId) ?? 0,
      };
      entries.push(e);
      entryReports.set(e, { b });
      continue;
    }
    const t = m.other;
    const e: SearchDiffEntry = {
      ...empty(),
      status: 'unchanged',
      matchedBy: m.by,
      base: refOf(b, base),
      target: refOf(t, target),
      dependents: target.referencedBy.get(t.xmlId) ?? 0,
    };
    e.moved = folderOf(b) !== folderOf(t);
    e.renamed = b.name !== t.name;
    if (e.renamed) e.fieldChanges.push({ field: 'name', from: b.name, to: t.name });
    if (e.moved) e.fieldChanges.push({ field: 'folder', from: folderOf(b), to: folderOf(t) });
    if ((b.description ?? '') !== (t.description ?? '')) {
      e.fieldChanges.push({ field: 'description', from: b.description ?? null, to: t.description ?? null });
    }
    if (b.reportType !== t.reportType) e.fieldChanges.push({ field: 'reportType', from: b.reportType, to: t.reportType });

    // GUIDs rotate between exports, so references outside both files cannot be compared
    const sameRef = (bGuid: string | undefined, tGuid: string | undefined, what: string) => {
      if (!bGuid || !tGuid) return !bGuid && !tGuid;
      const bp = base.byGuid.get(bGuid);
      const tp = target.byGuid.get(tGuid);
      if (!bp && !tp) {
        e.warnings.push(`${what} is outside both exports; cannot confirm it is unchanged`);
        return true;
      }
      return !!bp && !!tp && pairs.get(bp)?.other === tp;
    };
    const parentSame = b.parentType === t.parentType && sameRef(popParent(b), popParent(t), 'Parent search');
    if (!parentSame) e.fieldChanges.push({ field: 'parent', from: parentLabel(b, base), to: parentLabel(t, target) });

    const bGuids = popGuids(b);
    const tGuids = popGuids(t);
    const popSame = bGuids.length === tGuids.length && bGuids.every((g, i) => sameRef(g, tGuids[i], 'A referenced population search'));
    if (!popSame) {
      const fmt = (gs: string[], side: Side) =>
        gs.map((g) => (side.byGuid.get(g) ? keyOf(side.byGuid.get(g)!) : `unknown search ${g}`)).join('; ') || null;
      e.fieldChanges.push({ field: 'populationCriteria', from: fmt(bGuids, base), to: fmt(tGuids, target) });
    }

    const bc = collectCodes(b);
    const tc = collectCodes(t);
    for (const [k, c] of tc) if (!bc.has(k)) e.codesAdded.push(c);
    for (const [k, c] of bc) {
      const o = tc.get(k);
      if (!o) e.codesRemoved.push(c);
      else if (o.includeChildren !== c.includeChildren && !c.excluded) {
        e.codesChildrenChanged.push({ code: c.code, displayName: c.displayName, from: c.includeChildren, to: o.includeChildren });
      }
    }
    const bl = libraryItems(b);
    const tl = libraryItems(t);
    e.libraryItemsAdded = [...tl].filter((x) => !bl.has(x));
    e.libraryItemsRemoved = [...bl].filter((x) => !tl.has(x));

    e.contentChanged =
      getFp(b) !== getFp(t) || !parentSame || !popSame || e.fieldChanges.some((f) => f.field === 'description' || f.field === 'reportType');
    if (e.contentChanged) {
      // Renames are reported as field changes; map base names to target names so the patch shows logic only
      e.guidePatch = unifiedPatch(applyRenames(guideText(b, allReports), renames), guideText(t, allReports));
    }
    e.status = e.contentChanged ? 'modified' : e.moved ? 'moved' : e.renamed ? 'renamed' : 'unchanged';
    entries.push(e);
    entryReports.set(e, { b, t });
  }

  for (const t of target.reports) {
    if (reverse.has(t)) continue;
    const e: SearchDiffEntry = {
      ...empty(),
      status: 'added',
      target: refOf(t, target),
      codesAdded: [...collectCodes(t).values()],
      guide: guideText(t, target.reports),
      dependents: target.referencedBy.get(t.xmlId) ?? 0,
    };
    entries.push(e);
    entryReports.set(e, { t });
  }

  const scopeInfo = options.scope ? applyScope(entryReports, options.scope, base, target) : undefined;

  const summary = emptyCounts();
  const folders = new Map<string, FolderSummary>();
  const moves = new Map<string, FolderMove>();
  for (const e of entries) {
    summary[e.status]++;
    const folder = entryRef(e).folder;
    const f = folders.get(folder) ?? { folder, ...emptyCounts() };
    f[e.status]++;
    folders.set(folder, f);
    if (e.moved && e.base && e.target) {
      const k = `${e.base.folder}\u0000${e.target.folder}`;
      const m = moves.get(k) ?? { from: e.base.folder, to: e.target.folder, searches: 0 };
      m.searches++;
      moves.set(k, m);
    }
  }

  const order: Record<SearchDiffStatus, number> = { modified: 0, added: 1, removed: 2, moved: 3, renamed: 4, unchanged: 5 };
  const sortKey = (e: SearchDiffEntry) => `${entryRef(e).folder} :: ${entryRef(e).name}`;
  entries.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || order[a.status] - order[b.status]);

  return {
    schemaVersion: XML_DIFF_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    base: { label: baseIn.label ?? rootLabel(baseIn.doc), fileName: baseIn.fileName, searchCount: base.reports.length },
    target: { label: targetIn.label ?? rootLabel(targetIn.doc), fileName: targetIn.fileName, searchCount: target.reports.length },
    summary,
    folders: [...folders.values()].sort((a, b) => a.folder.localeCompare(b.folder)),
    folderMoves: [...moves.values()].sort((a, b) => b.searches - a.searches),
    scope: scopeInfo,
    entries,
  };
}

/**
 * Marks listed searches as direct, the searches they depend on (parents and population
 * criteria, transitively, in either export) as ancestors, and records changed dependencies.
 */
function applyScope(
  reports: Map<SearchDiffEntry, { b?: EmisReport; t?: EmisReport }>,
  scope: DiffScopeInput,
  base: Side,
  target: Side
): DiffScopeSummary {
  const wanted = new Map<string, { folder: string; name: string; tags: Set<string> }>();
  for (const s of scope.searches) {
    const k = `${s.folder} :: ${s.name}`;
    const w = wanted.get(k) ?? { folder: s.folder, name: s.name, tags: new Set<string>() };
    s.tags?.forEach((x) => w.tags.add(x));
    wanted.set(k, w);
  }
  const byReport = new Map<EmisReport, SearchDiffEntry>();
  for (const [e, { b, t }] of reports) {
    if (b) byReport.set(b, e);
    if (t) byReport.set(t, e);
  }

  const hitTarget = new Set<string>();
  const hitBase = new Set<string>();
  const direct: SearchDiffEntry[] = [];
  for (const [e, { b, t }] of reports) {
    const tags = new Set<string>();
    let found = false;
    for (const [r, hits] of [[b, hitBase], [t, hitTarget]] as const) {
      const k = r && keyOf(r);
      const w = k ? wanted.get(k) : undefined;
      if (k && w) {
        found = true;
        hits.add(k);
        w.tags.forEach((x) => tags.add(x));
      }
    }
    if (found) {
      e.scope = 'direct';
      e.scopeTags = [...tags].sort();
      direct.push(e);
    }
  }

  let ancestors = 0;
  let affectedUpstream = 0;
  for (const e of direct) {
    const { b, t } = reports.get(e)!;
    const changed = new Map<SearchDiffEntry, UpstreamChange>();
    for (const [start, side] of [[b, base], [t, target]] as const) {
      if (!start) continue;
      const seen = new Set<EmisReport>([start]);
      const queue = [start];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const g of dependencyGuids(cur)) {
          const dep = side.byGuid.get(g);
          if (!dep || seen.has(dep)) continue;
          seen.add(dep);
          queue.push(dep);
          const de = byReport.get(dep);
          if (!de) continue;
          if (!de.scope) {
            de.scope = 'ancestor';
            ancestors++;
          }
          if (de.status !== 'unchanged' && de !== e) changed.set(de, { folder: entryRef(de).folder, name: entryRef(de).name, status: de.status });
        }
      }
    }
    if (changed.size) {
      e.upstreamChanges = [...changed.values()].sort((x, y) => `${x.folder}${x.name}`.localeCompare(`${y.folder}${y.name}`));
      if (e.status === 'unchanged') affectedUpstream++;
    }
  }

  const rows = (keys: string[]) => keys.map((k) => ({ folder: wanted.get(k)!.folder, name: wanted.get(k)!.name }));
  return {
    label: scope.label,
    searches: wanted.size,
    matched: [...wanted.keys()].filter((k) => hitBase.has(k) || hitTarget.has(k)).length,
    ancestors,
    affectedUpstream,
    unmatched: rows([...wanted.keys()].filter((k) => !hitBase.has(k) && !hitTarget.has(k))),
    baseOnly: rows([...wanted.keys()].filter((k) => hitBase.has(k) && !hitTarget.has(k))),
  };
}

/**
 * Drops guides, then full code lists, from added/removed searches until the serialised result
 * fits `maxBytes` (serverless responses are capped at 4.5 MB). Throws if it still does not fit.
 */
export function trimForTransport(result: XmlDiffResult, maxBytes: number): XmlDiffResult {
  const size = (r: XmlDiffResult) => new TextEncoder().encode(JSON.stringify(r)).length;
  if (size(result) <= maxBytes) return result;

  let guides = 0;
  let codeLists = 0;
  let out: XmlDiffResult = {
    ...result,
    entries: result.entries.map((e) => {
      if (!e.guide) return e;
      guides++;
      return { ...e, guide: undefined, guideOmitted: true };
    }),
  };
  if (size(out) > maxBytes) {
    out = {
      ...out,
      entries: out.entries.map((e) => {
        const n = e.codesAdded.length + e.codesRemoved.length;
        if ((e.status !== 'added' && e.status !== 'removed') || n === 0) return e;
        codeLists++;
        return { ...e, codesAdded: [], codesRemoved: [], codesOmitted: n };
      }),
    };
  }
  out.trimmed = { guides, codeLists };
  if (size(out) > maxBytes) {
    throw new Error('Diff is too large to return. The files may be unrelated; use scripts/diff-xml.ts for the full output.');
  }
  return out;
}

// === Markdown ===

const STATUS_LABEL: Record<SearchDiffStatus, string> = {
  added: 'Added',
  removed: 'Removed',
  modified: 'Modified',
  moved: 'Moved',
  renamed: 'Renamed',
  unchanged: 'Unchanged',
};

/** Escapes Markdown syntax in plain text (search names often contain * and []) */
const md = (s: string) => s.replace(/[\\`*_[\]<>|]/g, (c) => `\\${c}`).replace(/\n/g, ' ');
/** Inline code span; backticks inside are replaced */
const code = (s: string) => `\`${s.replace(/`/g, "'").replace(/\n/g, ' ')}\``;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const codeLine = (c: CodeRef) =>
  `${code(c.code)}${c.displayName ? ` ${md(c.displayName)}` : ''}${c.cluster ? ` (${md(c.cluster)})` : ''}${c.excluded ? ' — exception' : ''}${
    c.isRefset ? ' — refset' : ''
  }`;

/** Code changes grouped by cluster (ValueSet description); lists without one grouped as "no cluster ID" */
export function groupCodeChanges(e: SearchDiffEntry) {
  const groups = new Map<string, { cluster: string; added: CodeRef[]; removed: CodeRef[] }>();
  const get = (c: CodeRef) => {
    const cluster = c.cluster ?? 'no cluster ID';
    let g = groups.get(cluster);
    if (!g) groups.set(cluster, (g = { cluster, added: [], removed: [] }));
    return g;
  };
  e.codesAdded.forEach((c) => get(c).added.push(c));
  e.codesRemoved.forEach((c) => get(c).removed.push(c));
  return [...groups.values()].sort((a, b) => a.cluster.localeCompare(b.cluster));
}

export function renderXmlDiffMarkdown(result: XmlDiffResult, opts: { scopeOnly?: boolean; maxCodes?: number } = {}): string {
  // Per cluster and direction; full lists are in the JSON
  const maxCodes = opts.maxCodes ?? 10;
  const entries = opts.scopeOnly ? result.entries.filter((e) => e.scope) : result.entries;
  const out: string[] = [];
  out.push(`# Search diff: ${md(result.base.label)} → ${md(result.target.label)}`, '');
  out.push(`- Base: ${code(result.base.fileName)} (${plural(result.base.searchCount, 'search', 'searches')})`);
  out.push(`- Target: ${code(result.target.fileName)} (${plural(result.target.searchCount, 'search', 'searches')})`);
  const s = result.scope;
  if (s) {
    out.push(
      `- Scope: ${md(s.label)}: ${s.matched}/${s.searches} listed searches found, plus ${plural(s.ancestors, 'search', 'searches')} they depend on. ` +
        `${plural(s.affectedUpstream, 'unchanged in-scope search depends', 'unchanged in-scope searches depend')} on a changed search.`
    );
    if (opts.scopeOnly) out.push('- Showing in-scope searches and the searches they depend on');
  }
  out.push(`- Matching: ${MATCHING_DESCRIPTION}`, '');

  const counts = emptyCounts();
  entries.forEach((e) => counts[e.status]++);
  out.push('## Summary', '', '| Status | Searches |', '| --- | ---: |');
  for (const st of Object.keys(STATUS_LABEL) as SearchDiffStatus[]) out.push(`| ${STATUS_LABEL[st]} | ${counts[st]} |`);
  out.push('');

  if (s && (s.unmatched.length || s.baseOnly.length)) {
    out.push('## Scope rows to check', '');
    for (const r of s.unmatched) out.push(`- Not found in either file: ${md(r.folder)} :: **${md(r.name)}**`);
    for (const r of s.baseOnly) out.push(`- Found only under the base name or folder: ${md(r.folder)} :: **${md(r.name)}**`);
    out.push('');
  }

  if (result.folderMoves.length) {
    out.push('## Folder moves', '', '| From | To | Searches |', '| --- | --- | ---: |');
    for (const m of result.folderMoves) out.push(`| ${md(m.from)} | ${md(m.to)} | ${m.searches} |`);
    out.push('');
  }

  const changedFolders = new Map<string, Record<SearchDiffStatus, number>>();
  for (const e of entries) {
    if (e.status === 'unchanged') continue;
    const folder = entryRef(e).folder;
    const c = changedFolders.get(folder) ?? emptyCounts();
    c[e.status]++;
    changedFolders.set(folder, c);
  }
  if (changedFolders.size) {
    out.push('## Changed folders', '', '| Folder | Modified | Added | Removed | Moved | Renamed |', '| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const [folder, c] of [...changedFolders].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`| ${md(folder || '(root)')} | ${c.modified} | ${c.added} | ${c.removed} | ${c.moved} | ${c.renamed} |`);
    }
    out.push('');
  }

  // Scope tags (e.g. dbt models) → changed searches they use, directly or through dependencies
  const byTag = new Map<string, { direct: Set<string>; upstream: Set<string> }>();
  for (const e of entries) {
    for (const tag of e.scopeTags ?? []) {
      const t = byTag.get(tag) ?? { direct: new Set<string>(), upstream: new Set<string>() };
      if (e.status !== 'unchanged') t.direct.add(`${md(entryRef(e).name)} (${e.status})`);
      for (const u of e.upstreamChanges ?? []) t.upstream.add(`${md(u.name)} (${u.status})`);
      byTag.set(tag, t);
    }
  }
  const impacted = [...byTag].filter(([, t]) => t.direct.size || t.upstream.size).sort((a, b) => a[0].localeCompare(b[0]));
  if (impacted.length) {
    out.push(`## Impact by ${md(s?.label ?? 'scope')} tag`, '', '| Tag | Changed searches it uses | Changed searches they depend on |', '| --- | --- | --- |');
    for (const [tag, t] of impacted) {
      out.push(`| ${code(tag)} | ${[...t.direct].join('<br>') || '—'} | ${[...t.upstream].join('<br>') || '—'} |`);
    }
    out.push('');
  }

  const byStatus = (st: SearchDiffStatus) => entries.filter((e) => e.status === st);
  const scopeNote = (e: SearchDiffEntry) =>
    e.scope ? ` _(in scope${e.scope === 'ancestor' ? ': dependency' : ''}${e.scopeTags?.length ? `: ${e.scopeTags.map(md).join(', ')}` : ''})_` : '';
  const listByFolder = (items: SearchDiffEntry[]) => {
    const dupNames = new Set(items.map((e) => entryRef(e)).filter((r, i, all) => all.findIndex((o) => o.folder === r.folder && o.name === r.name) !== i).map((r) => `${r.folder} :: ${r.name}`));
    let folder: string | undefined;
    for (const e of items) {
      const r = entryRef(e);
      if (r.folder !== folder) {
        folder = r.folder;
        out.push('', `#### ${md(folder || '(root)')}`, '');
      }
      const parent = dupNames.has(`${r.folder} :: ${r.name}`) && r.parent ? ` (parent: ${md(r.parent)})` : '';
      out.push(`- **${md(r.name)}**${parent}${scopeNote(e)}${e.dependents ? `, ${plural(e.dependents, 'dependent search', 'dependent searches')}` : ''}`);
    }
    out.push('');
  };

  for (const st of ['added', 'removed'] as const) {
    const items = byStatus(st);
    if (!items.length) continue;
    out.push(`## ${STATUS_LABEL[st]} (${items.length})`);
    listByFolder(items);
  }

  const fieldLine = (f: FieldChange) => `${FIELD_LABEL[f.field]} ${code(f.from ?? '—')} → ${code(f.to ?? '—')}`;
  const relocated = entries.filter((e) => e.status === 'moved' || e.status === 'renamed');
  if (relocated.length) {
    out.push(`## Moved or renamed, logic unchanged (${relocated.length})`, '');
    for (const e of relocated) {
      const how = e.matchedBy && e.matchedBy !== 'path' ? ` [matched by ${e.matchedBy}]` : '';
      out.push(`- **${md(entryRef(e).name)}**${scopeNote(e)}${how}: ${e.fieldChanges.map(fieldLine).join('; ')}`);
    }
    out.push('');
  }

  const affected = entries.filter((e) => e.status === 'unchanged' && e.upstreamChanges?.length);
  if (affected.length) {
    out.push(`## Unchanged, but depend on a changed search (${affected.length})`, '');
    for (const e of affected) {
      out.push(`- **${md(entryRef(e).name)}**${scopeNote(e)}: ${e.upstreamChanges!.map((u) => `${md(u.name)} (${u.status})`).join('; ')}`);
    }
    out.push('');
  }

  const modified = byStatus('modified');
  if (modified.length) {
    out.push(`## Modified (${modified.length})`, '');
    for (const e of modified) {
      const r = e.target!;
      out.push(`### ${md(r.name)}`, '', `Folder: ${md(r.folder || '(root)')}`);
      if (e.scope) out.push(`Scope: ${e.scope === 'direct' ? 'listed' : 'dependency'}${e.scopeTags?.length ? `, ${e.scopeTags.map(md).join(', ')}` : ''}`);
      if (e.matchedBy && e.matchedBy !== 'path') out.push(`Matched by: ${e.matchedBy}`);
      if (e.dependents) out.push(`Dependent searches: ${e.dependents}`);
      out.push('');
      for (const f of e.fieldChanges) out.push(`- **${FIELD_LABEL[f.field]}**: ${code(f.from ?? '—')} → ${code(f.to ?? '—')}`);
      for (const w of e.warnings) out.push(`- **Warning**: ${md(w)}`);
      for (const g of groupCodeChanges(e)) {
        out.push(`- **Codes, ${md(g.cluster)}**: +${g.added.length} / −${g.removed.length}`);
        const show = (sign: string, list: CodeRef[]) => {
          list.slice(0, maxCodes).forEach((c) => out.push(`  - ${sign} ${codeLine(c)}`));
          if (list.length > maxCodes) out.push(`  - ${sign} … ${list.length - maxCodes} more (see JSON)`);
        };
        show('+', g.added);
        show('−', g.removed);
      }
      for (const c of e.codesChildrenChanged) out.push(`- **Include children** ${code(c.code)} ${md(c.displayName)}: ${c.from} → ${c.to}`);
      if (e.libraryItemsAdded.length) out.push(`- **Library items added**: ${e.libraryItemsAdded.map(code).join(', ')}`);
      if (e.libraryItemsRemoved.length) out.push(`- **Library items removed**: ${e.libraryItemsRemoved.map(code).join(', ')}`);
      if (e.upstreamChanges?.length) out.push(`- **Depends on changed searches**: ${e.upstreamChanges.map((u) => `${md(u.name)} (${u.status})`).join('; ')}`);
      if (e.guidePatch) out.push('', '```diff', e.guidePatch, '```');
      out.push('');
    }
  }

  return out.join('\n');
}

/** Accepts a scope list or the dbt mapping JSON ({ searches: [{folder, name, models}] }) */
export function parseDiffScope(json: unknown, label = 'Scope'): DiffScopeInput {
  const list = Array.isArray(json) ? json : (json as { searches?: unknown[] })?.searches;
  if (!Array.isArray(list)) throw new Error('Scope must be an array of {folder, name} or an object with a searches array');
  return {
    label,
    searches: list
      .filter(
        (s): s is { folder: string; name: string; models?: unknown; tags?: unknown } =>
          !!s && typeof s === 'object' && typeof (s as { name?: unknown }).name === 'string' && typeof (s as { folder?: unknown }).folder === 'string'
      )
      .map((s) => {
        const tags = Array.isArray(s.tags) ? s.tags : Array.isArray(s.models) ? s.models : [];
        return { folder: s.folder, name: s.name, tags: tags.filter((t): t is string => typeof t === 'string') };
      }),
  };
}
