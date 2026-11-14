/**
 * Diffs two EMIS XML exports (e.g. LTC LCS R5 vs R6).
 *
 * Re-exports rotate report, folder and parent GUIDs, so searches are matched on
 * folder path + name, then by content, then by stable criteria-group IDs, then by
 * unique name. GUID references (parents, population criteria) are compared via
 * the match map, never by raw value.
 */
import { structuredPatch } from 'diff';
import type { EmisReport, EmisXmlDocument, SearchCriterion } from './types';
import { buildImplementationGuideMarkdown } from './agent-report-utils';

export const XML_DIFF_SCHEMA_VERSION = '1';

export type SearchDiffStatus = 'added' | 'removed' | 'modified' | 'moved' | 'renamed' | 'unchanged';
export type MatchMethod = 'path' | 'content' | 'stable-ids' | 'name' | 'similar-name';

/** Minimum name-token overlap (intersection / union) to pair a versioned replacement */
const SIMILAR_NAME_THRESHOLD = 0.5;
export type ScopeRelation = 'direct' | 'ancestor';

export interface SearchRef {
  folder: string;
  name: string;
  type: EmisReport['reportType'];
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

export interface FieldChange {
  field: 'name' | 'folder' | 'description' | 'parent' | 'reportType' | 'populationCriteria';
  from: string | null;
  to: string | null;
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
  /** References that could not be checked, e.g. a parent search outside both exports */
  warnings: string[];
  /** Searches in the newer side (older side for removed) that use this one as their parent */
  dependents: number;
  scope?: ScopeRelation;
  /** Labels from the scope list, e.g. dbt model names */
  scopeTags?: string[];
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

export interface XmlDiffResult {
  schemaVersion: string;
  generatedAt: string;
  base: DiffSideInfo;
  target: DiffSideInfo;
  summary: Record<SearchDiffStatus, number>;
  folders: FolderSummary[];
  folderMoves: FolderMove[];
  scope?: { label: string; searches: number; matched: number; ancestors: number };
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
const refOf = (r: EmisReport): SearchRef => ({ folder: folderOf(r), name: r.name, type: r.reportType });
/** Newer side's identity, or the older side for removed searches */
export const entryRef = (e: SearchDiffEntry): SearchRef => (e.target ?? e.base)!;

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
        out.set(key, {
          code: e.code,
          displayName: e.displayName || '',
          codeSystem,
          cluster,
          includeChildren: false,
          isRefset: false,
          excluded: true,
        });
      }
    }
  }
  return out;
}

const libraryItems = (r: EmisReport) => new Set((r.criteriaGroups ?? []).flatMap((g) => g.libraryItemRefs ?? []));

function guideText(r: EmisReport, all: EmisReport[]): string {
  // Folder/Source lines are reported as field changes; strip to avoid noise
  return buildImplementationGuideMarkdown(r, all)
    .split('\n')
    .filter((line) => !line.startsWith('Folder: ') && !line.startsWith('Source: '))
    .join('\n');
}

function unifiedPatch(a: string, b: string): string | undefined {
  if (a === b) return undefined;
  const patch = structuredPatch('base', 'target', a, b, '', '', { context: 2 });
  if (patch.hunks.length === 0) return undefined;
  return patch.hunks
    .map((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n'))
    .join('\n');
}

interface Side {
  reports: EmisReport[];
  byGuid: Map<string, EmisReport>;
  children: Map<string, number>;
}

function indexSide(doc: EmisXmlDocument): Side {
  const byGuid = new Map(doc.reports.map((r) => [r.xmlId, r]));
  const children = new Map<string, number>();
  for (const r of doc.reports) {
    if (r.parentReportId) children.set(r.parentReportId, (children.get(r.parentReportId) ?? 0) + 1);
  }
  return { reports: doc.reports, byGuid, children };
}

// === Matching ===

function matchReports(base: Side, target: Side) {
  const pairs = new Map<EmisReport, { other: EmisReport; by: MatchMethod }>();
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

  // 1. Path + name. Duplicates pair by parent + fingerprint, fingerprint, stable IDs, then parent;
  //    a position fallback applies only when exactly one search is left on each side
  const parentKey = (r: EmisReport, side: Side) => {
    const p = r.parentReportId ? side.byGuid.get(r.parentReportId) : undefined;
    return p ? keyOf(p) : (r.parentType ?? '');
  };
  const bParent = (r: EmisReport) => parentKey(r, base);
  const tParent = (r: EmisReport) => parentKey(r, target);
  const group = (rs: EmisReport[]) => {
    const m = new Map<string, EmisReport[]>();
    for (const r of rs) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]);
    return m;
  };
  const tg = group(target.reports);
  for (const [key, bs] of group(base.reports)) {
    const ts = [...(tg.get(key) ?? [])];
    if (ts.length === 0) continue;
    const remaining = [...bs];
    // Each pick returns [baseValue, targetValue]; parent keys differ per side
    const picks: Array<(b: EmisReport, t: EmisReport) => [string, string]> = [
      (b, t) => [`${bParent(b)}\u0000${getFp(b)}`, `${tParent(t)}\u0000${getFp(t)}`],
      (b, t) => [getFp(b), getFp(t)],
      (b, t) => [stableSig(b), stableSig(t)],
      (b, t) => [bParent(b), tParent(t)],
    ];
    for (const pick of picks) {
      for (const b of [...remaining]) {
        const i = ts.findIndex((t) => {
          const [x, y] = pick(b, t);
          return x !== '' && x === y;
        });
        if (i >= 0) {
          link(b, ts[i], 'path');
          ts.splice(i, 1);
          remaining.splice(remaining.indexOf(b), 1);
        }
      }
    }
    // Ambiguous leftovers fall through to the global passes below
    if (remaining.length === 1 && ts.length === 1) link(remaining[0], ts[0], 'path');
  }

  // 2-4. Unmatched: content, stable IDs, then name — each requires uniqueness on both sides
  const passes: Array<[MatchMethod, (r: EmisReport) => string]> = [
    ['content', getFp],
    ['stable-ids', stableSig],
    ['name', (r) => r.name],
  ];
  for (const [by, sig] of passes) {
    const unique = (rs: EmisReport[]) => {
      const m = new Map<string, EmisReport | null>();
      for (const r of rs) {
        const s = sig(r);
        if (!s) continue;
        m.set(s, m.has(s) ? null : r);
      }
      return m;
    };
    const ub = unique(base.reports.filter((r) => !pairs.has(r)));
    const ut = unique(target.reports.filter((r) => !reverse.has(r)));
    for (const [s, b] of ub) {
      const t = ut.get(s);
      if (b && t) link(b, t, by);
    }
  }

  // 5. Versioned replacements: same folder (years normalised), same type, and either
  //    either the same bracketed search ID ignoring version tokens, or name token Jaccard >= threshold
  //    plus shared criterion IDs or codes. Equal-score alternatives are left unmatched.
  const tokenList = (s: string) =>
    s
      .toLowerCase()
      .replace(/([a-z])(\d)|(\d)([a-z])/g, '$1$3 $2$4')
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  const tokens = (s: string) => new Set(tokenList(s));
  const tagOf = (s: string) => {
    const m = s.match(/^\s*\[([^\]]+)\]/);
    if (!m) return '';
    const stripped = m[1].toLowerCase().replace(/_/g, ' ').replace(/\bv\d+\b|\bnice\b/g, ' ');
    return tokenList(stripped).join(' ');
  };
  const jaccard = (a: Set<string>, b: Set<string>) => {
    let inter = 0;
    a.forEach((x) => b.has(x) && inter++);
    return inter / (a.size + b.size - inter || 1);
  };
  const normFolder = (r: EmisReport) => folderOf(r).replace(/\b20\d\d-\d\d\b/g, 'YYYY-YY');
  const candidates: Array<{ b: EmisReport; t: EmisReport; score: number }> = [];
  const ut = target.reports.filter((r) => !reverse.has(r));
  for (const b of base.reports.filter((r) => !pairs.has(r))) {
    const tb = tokens(b.name);
    const tagB = tagOf(b.name);
    for (const t of ut) {
      if (t.reportType !== b.reportType || normFolder(t) !== normFolder(b)) continue;
      if (tagB && tagB === tagOf(t.name)) {
        candidates.push({ b, t, score: 1 });
        continue;
      }
      const score = jaccard(tb, tokens(t.name));
      if (score < SIMILAR_NAME_THRESHOLD) continue;
      const eb = evidenceOf(b);
      if ([...evidenceOf(t)].some((x) => eb.has(x))) candidates.push({ b, t, score });
    }
  }
  const open = (c: (typeof candidates)[number]) => !pairs.has(c.b) && !reverse.has(c.t);
  candidates.sort((x, y) => y.score - x.score || keyOf(x.b).localeCompare(keyOf(y.b)) || keyOf(x.t).localeCompare(keyOf(y.t)));
  for (const c of candidates) {
    if (!open(c)) continue;
    const tied = candidates.some((o) => o !== c && o.score === c.score && (o.b === c.b || o.t === c.t) && open(o));
    if (!tied) link(c.b, c.t, 'similar-name');
  }

  return { pairs, reverse, getFp };
}

// === Diff ===

export function diffXmlDocuments(
  baseIn: DiffInputSide,
  targetIn: DiffInputSide,
  options: { scope?: DiffScopeInput; generatedAt?: string } = {}
): XmlDiffResult {
  const base = indexSide(baseIn.doc);
  const target = indexSide(targetIn.doc);
  const { pairs, reverse, getFp } = matchReports(base, target);

  const parentLabel = (r: EmisReport, side: Side) => {
    if (r.parentType === 'POP' && r.parentReportId) {
      const p = side.byGuid.get(r.parentReportId);
      return p ? `${folderOf(p)} :: ${p.name}` : `unknown search ${r.parentReportId}`;
    }
    return r.parentType ?? null;
  };
  const popGuids = (r: EmisReport) => (r.criteriaGroups ?? []).flatMap((g) => g.populationCriteria.map((p) => p.reportGuid));

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
        base: refOf(b),
        codesRemoved: [...collectCodes(b).values()],
        guide: guideText(b, base.reports),
        dependents: base.children.get(b.xmlId) ?? 0,
      };
      entries.push(e);
      entryReports.set(e, { b });
      continue;
    }
    const t = m.other;
    const e: SearchDiffEntry = { ...empty(), status: 'unchanged', matchedBy: m.by, base: refOf(b), target: refOf(t), dependents: target.children.get(t.xmlId) ?? 0 };
    e.moved = folderOf(b) !== folderOf(t);
    e.renamed = b.name !== t.name;
    if (e.renamed) e.fieldChanges.push({ field: 'name', from: b.name, to: t.name });
    if (e.moved) e.fieldChanges.push({ field: 'folder', from: folderOf(b), to: folderOf(t) });
    if ((b.description ?? '') !== (t.description ?? '')) {
      e.fieldChanges.push({ field: 'description', from: b.description ?? null, to: t.description ?? null });
    }
    if (b.reportType !== t.reportType) e.fieldChanges.push({ field: 'reportType', from: b.reportType, to: t.reportType });

    // Parent and population references: same when the base reference matched the target one.
    // GUIDs rotate between exports, so references outside both files cannot be compared.
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
    const popParent = (r: EmisReport) => (r.parentType === 'POP' ? r.parentReportId : undefined);
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

    const bodyChanged = getFp(b) !== getFp(t);
    e.contentChanged =
      bodyChanged || !parentSame || !popSame || e.fieldChanges.some((f) => f.field === 'description' || f.field === 'reportType');
    if (e.contentChanged) {
      e.guidePatch = unifiedPatch(guideText(b, base.reports), guideText(t, target.reports));
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
      target: refOf(t),
      codesAdded: [...collectCodes(t).values()],
      guide: guideText(t, target.reports),
      dependents: target.children.get(t.xmlId) ?? 0,
    };
    entries.push(e);
    entryReports.set(e, { t });
  }

  const scopeInfo = options.scope ? applyScope(entries, entryReports, options.scope, base, target) : undefined;

  const summary: Record<SearchDiffStatus, number> = { added: 0, removed: 0, modified: 0, moved: 0, renamed: 0, unchanged: 0 };
  const folders = new Map<string, FolderSummary>();
  const moves = new Map<string, FolderMove>();
  for (const e of entries) {
    summary[e.status]++;
    const folder = (e.target ?? e.base)!.folder;
    const f = folders.get(folder) ?? { folder, added: 0, removed: 0, modified: 0, moved: 0, renamed: 0, unchanged: 0 };
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
  const sortKey = (e: SearchDiffEntry) => `${(e.target ?? e.base)!.folder} :: ${(e.target ?? e.base)!.name}`;
  const kept = entries.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || order[a.status] - order[b.status]);

  return {
    schemaVersion: XML_DIFF_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    base: { label: baseIn.label ?? rootLabel(baseIn.doc), fileName: baseIn.fileName, searchCount: base.reports.length },
    target: { label: targetIn.label ?? rootLabel(targetIn.doc), fileName: targetIn.fileName, searchCount: target.reports.length },
    summary,
    folders: [...folders.values()].sort((a, b) => a.folder.localeCompare(b.folder)),
    folderMoves: [...moves.values()].sort((a, b) => b.searches - a.searches),
    scope: scopeInfo,
    entries: kept,
  };
}

/** Marks entries in scope (listed searches) and their ancestors (parent chain, either side) */
function applyScope(
  entries: SearchDiffEntry[],
  reports: Map<SearchDiffEntry, { b?: EmisReport; t?: EmisReport }>,
  scope: DiffScopeInput,
  base: Side,
  target: Side
) {
  const wanted = new Map<string, string[]>();
  for (const s of scope.searches) {
    const k = `${s.folder} :: ${s.name}`;
    wanted.set(k, [...(wanted.get(k) ?? []), ...(s.tags ?? [])]);
  }
  const byReport = new Map<EmisReport, SearchDiffEntry>();
  for (const [e, { b, t }] of reports) {
    if (b) byReport.set(b, e);
    if (t) byReport.set(t, e);
  }

  const hit = new Set<string>();
  const direct: SearchDiffEntry[] = [];
  for (const [e, { b, t }] of reports) {
    const tags = new Set<string>();
    let found = false;
    for (const r of [b, t]) {
      const k = r && keyOf(r);
      if (k && wanted.has(k)) {
        found = true;
        hit.add(k);
        wanted.get(k)!.forEach((x) => tags.add(x));
      }
    }
    if (found) {
      e.scope = 'direct';
      e.scopeTags = [...tags].sort();
      direct.push(e);
    }
  }

  let ancestors = 0;
  for (const e of direct) {
    const { b, t } = reports.get(e)!;
    for (const [r, side] of [[b, base], [t, target]] as const) {
      let cur = r;
      const seen = new Set<EmisReport>();
      while (cur?.parentReportId && !seen.has(cur)) {
        seen.add(cur);
        const p = side.byGuid.get(cur.parentReportId);
        const pe = p && byReport.get(p);
        if (pe && !pe.scope) {
          pe.scope = 'ancestor';
          ancestors++;
        }
        cur = p;
      }
    }
  }

  return { label: scope.label, searches: wanted.size, matched: hit.size, ancestors };
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

const esc = (s: string) => s.replace(/\|/g, '\\|');
const codeLine = (c: CodeRef) =>
  `\`${c.code}\`${c.displayName ? ` ${c.displayName}` : ''}${c.cluster ? ` (${c.cluster})` : ''}${c.excluded ? ' — exception' : ''}${
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
  out.push(`# Search diff: ${result.base.label} → ${result.target.label}`, '');
  out.push(`- Base: \`${result.base.fileName}\` (${result.base.searchCount} searches)`);
  out.push(`- Target: \`${result.target.fileName}\` (${result.target.searchCount} searches)`);
  if (result.scope) {
    out.push(
      `- Scope: ${result.scope.label} — ${result.scope.matched}/${result.scope.searches} listed searches found, plus ${result.scope.ancestors} parent searches`
    );
    if (opts.scopeOnly) out.push('- Showing in-scope searches only');
  }
  out.push(
    '- Matching: folder + name, then content, then stable criteria-group IDs, then unique name. Search GUIDs rotate between exports and are ignored.',
    ''
  );

  const counts: Record<SearchDiffStatus, number> = { added: 0, removed: 0, modified: 0, moved: 0, renamed: 0, unchanged: 0 };
  if (opts.scopeOnly) entries.forEach((e) => counts[e.status]++);
  const summary = opts.scopeOnly ? counts : result.summary;
  out.push('## Summary', '', '| Status | Searches |', '| --- | ---: |');
  for (const s of Object.keys(STATUS_LABEL) as SearchDiffStatus[]) out.push(`| ${STATUS_LABEL[s]} | ${summary[s]} |`);
  out.push('');

  if (result.folderMoves.length) {
    out.push('## Folder moves', '', '| From | To | Searches |', '| --- | --- | ---: |');
    for (const m of result.folderMoves) out.push(`| ${esc(m.from)} | ${esc(m.to)} | ${m.searches} |`);
    out.push('');
  }

  const changedFolders = new Map<string, Record<SearchDiffStatus, number>>();
  for (const e of entries) {
    if (e.status === 'unchanged') continue;
    const folder = entryRef(e).folder;
    const c = changedFolders.get(folder) ?? { added: 0, removed: 0, modified: 0, moved: 0, renamed: 0, unchanged: 0 };
    c[e.status]++;
    changedFolders.set(folder, c);
  }
  if (changedFolders.size) {
    out.push('## Changed folders', '', '| Folder | Modified | Added | Removed | Moved | Renamed |', '| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const [folder, c] of [...changedFolders].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`| ${esc(folder || '(root)')} | ${c.modified} | ${c.added} | ${c.removed} | ${c.moved} | ${c.renamed} |`);
    }
    out.push('');
  }

  // Scope tags (e.g. dbt models) → changed searches they depend on
  const byTag = new Map<string, SearchDiffEntry[]>();
  for (const e of entries) {
    if (e.status === 'unchanged') continue;
    for (const t of e.scopeTags ?? []) byTag.set(t, [...(byTag.get(t) ?? []), e]);
  }
  if (byTag.size) {
    out.push(`## Impact by ${result.scope?.label ?? 'scope'} tag`, '', '| Tag | Changed searches |', '| --- | --- |');
    for (const [tag, es] of [...byTag].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`| \`${esc(tag)}\` | ${es.map((e) => `${esc(entryRef(e).name)} (${e.status})`).join('<br>')} |`);
    }
    out.push('');
  }

  const byStatus = (s: SearchDiffStatus) => entries.filter((e) => e.status === s);
  const label = (e: SearchDiffEntry) => {
    const r = (e.target ?? e.base)!;
    const scope = e.scope ? ` _(in scope${e.scope === 'ancestor' ? ': parent' : ''}${e.scopeTags?.length ? `: ${e.scopeTags.join(', ')}` : ''})_` : '';
    return `**${r.name}**${scope}`;
  };
  const listByFolder = (items: SearchDiffEntry[]) => {
    let folder = '';
    for (const e of items) {
      const r = (e.target ?? e.base)!;
      if (r.folder !== folder) {
        folder = r.folder;
        out.push('', `#### ${folder}`, '');
      }
      out.push(`- ${label(e)}${e.dependents ? ` — ${e.dependents} dependent searches` : ''}`);
    }
    out.push('');
  };

  for (const s of ['added', 'removed'] as const) {
    const items = byStatus(s);
    if (!items.length) continue;
    out.push(`## ${STATUS_LABEL[s]} (${items.length})`);
    listByFolder(items);
  }

  const relocated = entries.filter((e) => e.status === 'moved' || e.status === 'renamed');
  if (relocated.length) {
    out.push(`## Moved or renamed, logic unchanged (${relocated.length})`, '');
    for (const e of relocated) {
      out.push(`- ${label(e)}: ${e.fieldChanges.map((f) => `${f.field} \`${f.from}\` → \`${f.to}\``).join('; ')}`);
    }
    out.push('');
  }

  const modified = byStatus('modified');
  if (modified.length) {
    out.push(`## Modified (${modified.length})`, '');
    for (const e of modified) {
      const r = e.target!;
      out.push(`### ${r.name}`, '', `Folder: ${r.folder}`);
      if (e.scope) out.push(`Scope: ${e.scope}${e.scopeTags?.length ? ` — ${e.scopeTags.join(', ')}` : ''}`);
      if (e.matchedBy && e.matchedBy !== 'path') out.push(`Matched by: ${e.matchedBy}`);
      if (e.dependents) out.push(`Dependent searches: ${e.dependents}`);
      out.push('');
      for (const f of e.fieldChanges) out.push(`- **${f.field}**: \`${f.from ?? '—'}\` → \`${f.to ?? '—'}\``);
      for (const w of e.warnings) out.push(`- **Warning**: ${w}`);
      for (const g of groupCodeChanges(e)) {
        out.push(`- **Codes — ${g.cluster}**: +${g.added.length} / −${g.removed.length}`);
        const show = (sign: string, list: CodeRef[]) => {
          list.slice(0, maxCodes).forEach((c) => out.push(`  - ${sign} ${codeLine(c)}`));
          if (list.length > maxCodes) out.push(`  - ${sign} … ${list.length - maxCodes} more (see JSON)`);
        };
        show('+', g.added);
        show('−', g.removed);
      }
      for (const c of e.codesChildrenChanged) out.push(`- **Include children** \`${c.code}\` ${c.displayName}: ${c.from} → ${c.to}`);
      if (e.libraryItemsAdded.length) out.push(`- **Library items added**: ${e.libraryItemsAdded.map((x) => `\`${x}\``).join(', ')}`);
      if (e.libraryItemsRemoved.length) out.push(`- **Library items removed**: ${e.libraryItemsRemoved.map((x) => `\`${x}\``).join(', ')}`);
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
