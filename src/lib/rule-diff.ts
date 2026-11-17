/**
 * Structural diff of a search's rules, shaped like the Explore rules view: rules, criteria,
 * filter lines, restrictions and linked criteria, each marked added, removed, changed or
 * unchanged. Unchanged parts are kept in full so the whole search can be shown.
 */
import type { CriteriaGroup, ColumnGroup, EmisReport, EmisValueSet, SearchCriterion } from './types';
import { buildFriendlyNameMap, formatValueSetPreview, getCriterionDisplayData } from './agent-report-utils';
import { formatRelationship } from './rule-format-utils';

export type NodeStatus = 'added' | 'removed' | 'changed' | 'unchanged';

/** A code list used by a filter or restriction test */
export interface ListRef {
  /** valueset_friendly_name, newer name when the list was renumbered */
  name: string;
  cluster: string | null;
  /** Raw EMIS code system, e.g. SNOMED_CONCEPT */
  codeSystem: string;
  count: number;
  preview: string;
  /** Set when the list itself was added, removed or edited (see codeLists) */
  change?: 'added' | 'removed' | 'changed';
}

export interface LineDiff {
  status: NodeStatus;
  /** Newer text, or the older text for removed lines */
  text: string;
  /** Older text, when the text changed */
  from?: string;
  lists?: ListRef[];
}

export interface CriterionDiff {
  status: NodeStatus;
  name: string;
  /** Older name, when it changed */
  nameFrom?: string;
  table: string;
  /** Older table (data source), when it changed */
  tableFrom?: string;
  negation: boolean;
  /** Older negation, when it changed */
  negationFrom?: boolean;
  /** How a linked criterion joins its parent record */
  relationship?: LineDiff;
  filters: LineDiff[];
  restrictions: LineDiff[];
  /** Restriction test sets, which test the kept record */
  tests: LineDiff[];
  linked: CriterionDiff[];
  groups: Array<{ status: NodeStatus; operator: string; operatorFrom?: string; criteria: CriterionDiff[] }>;
  /** Added in place of the removed criterion just before it (see REPLACE_KEPT_SHARE) */
  replaces?: boolean;
}

export interface RuleDiff {
  status: NodeStatus;
  kind: 'rule' | 'column';
  /** Position in the newer search, or the older one for removed rules */
  number: number;
  previousNumber?: number;
  /** Moved relative to the other matched rules; rules run in order, so this can change the result */
  reordered?: boolean;
  /** Column group name; empty for rules */
  label: string;
  operator: string;
  operatorFrom?: string;
  pass?: string;
  passFrom?: string;
  fail?: string;
  failFrom?: string;
  /** Column groups: the columns they show */
  columns?: LineDiff;
  population: LineDiff[];
  libraryItems: LineDiff[];
  criteria: CriterionDiff[];
}

export interface RuleDiffContext {
  /** Older code list name → newer name, for renumbered lists */
  listRenames: Map<string, string>;
  /** Change marker for a code list on one side */
  listChange: (side: 'base' | 'target', name: string, cluster: string | null) => ListRef['change'];
  /** Search name for a population-criteria GUID; base names are mapped to their newer names */
  populationName: (side: 'base' | 'target', guid: string) => string;
  libraryItemName: (ref: string) => string;
}

/**
 * A paired criterion whose code list changed and that keeps less than this share of its lines is
 * reported as replaced (old block, new block) rather than edited. EMIS keeps a criterion's ID when an
 * author repurposes it, so field edits would read as a code swap for the same concept.
 */
const REPLACE_KEPT_SHARE = 0.5;

/** Minimum word overlap (Dice) to pair unmatched criteria, filter lines or rules */
const PAIR_SIMILARITY = 0.5;

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function similarity(a: string, b: string): number {
  const wa = words(a);
  const counts = new Map<string, number>();
  wa.forEach((w) => counts.set(w, (counts.get(w) ?? 0) + 1));
  let same = 0;
  const wb = words(b);
  for (const w of wb) {
    const n = counts.get(w) ?? 0;
    if (n > 0) {
      same++;
      counts.set(w, n - 1);
    }
  }
  return wa.length + wb.length ? (2 * same) / (wa.length + wb.length) : 1;
}

/**
 * Pairs two sibling lists: unique IDs, then identical signatures, then best similarity.
 * Returns pairs in newer order, with unpaired older items placed before the next pair that follows them.
 */
export function align<B, T>(
  bs: B[],
  ts: T[],
  key: { id?: (x: B | T) => string; sig: (x: B | T) => string; threshold?: number }
): Array<{ b?: B; t?: T }> {
  const pairOf = new Map<number, number>(); // target index → base index
  const usedB = new Set<number>();
  const pass = (k: (x: B | T) => string) => {
    const index = <X extends B | T>(xs: X[], used: (i: number) => boolean) => {
      const m = new Map<string, number | null>();
      xs.forEach((x, i) => {
        if (used(i)) return;
        const v = k(x);
        if (v) m.set(v, m.has(v) ? null : i);
      });
      return m;
    };
    const ib = index(bs, (i) => usedB.has(i));
    for (const [v, ti] of index(ts, (i) => pairOf.has(i))) {
      const bi = ib.get(v);
      if (ti !== null && bi !== null && bi !== undefined) {
        pairOf.set(ti, bi);
        usedB.add(bi);
      }
    }
  };
  if (key.id) pass(key.id);
  pass(key.sig);
  const scored: Array<{ bi: number; ti: number; s: number }> = [];
  bs.forEach((b, bi) => {
    if (usedB.has(bi)) return;
    ts.forEach((t, ti) => {
      if (pairOf.has(ti)) return;
      const s = similarity(key.sig(b), key.sig(t));
      if (s >= (key.threshold ?? PAIR_SIMILARITY)) scored.push({ bi, ti, s });
    });
  });
  scored.sort((x, y) => y.s - x.s || Math.abs(x.bi - x.ti) - Math.abs(y.bi - y.ti));
  for (const { bi, ti } of scored) {
    if (usedB.has(bi) || pairOf.has(ti)) continue;
    pairOf.set(ti, bi);
    usedB.add(bi);
  }

  const out: Array<{ b?: B; t?: T }> = [];
  const emitted = new Set<number>();
  const flushRemoved = (upTo: number) => {
    for (let i = 0; i < upTo; i++) {
      if (!usedB.has(i) && !emitted.has(i)) {
        emitted.add(i);
        out.push({ b: bs[i] });
      }
    }
  };
  ts.forEach((t, ti) => {
    const bi = pairOf.get(ti);
    if (bi === undefined) {
      out.push({ t });
      return;
    }
    flushRemoved(bi);
    out.push({ b: bs[bi], t });
  });
  flushRemoved(bs.length);
  return out;
}

const worst = (statuses: NodeStatus[]): NodeStatus => (statuses.some((s) => s !== 'unchanged') ? 'changed' : 'unchanged');

function lineDiff(b: LineDiff | undefined, t: LineDiff | undefined): LineDiff {
  if (!b) return { ...t!, status: 'added' };
  if (!t) return { ...b, status: 'removed' };
  const listChanged = (t.lists ?? []).some((l) => l.change) || (b.lists ?? []).some((l) => l.change === 'removed');
  // Keep removed lists visible next to the newer ones
  const gone = (b.lists ?? []).filter((l) => l.change === 'removed');
  const lists = t.lists || gone.length ? [...(t.lists ?? []), ...gone] : undefined;
  if (b.text === t.text) return { status: listChanged ? 'changed' : 'unchanged', text: t.text, ...(lists ? { lists } : {}) };
  return { status: 'changed', text: t.text, from: b.text, ...(lists ? { lists } : {}) };
}

function diffLines(bs: LineDiff[], ts: LineDiff[], id?: (l: LineDiff) => string): LineDiff[] {
  return align(bs, ts, { id: id as ((x: LineDiff) => string) | undefined, sig: (l) => l.text }).map(({ b, t }) => lineDiff(b, t));
}

/** Display form of one side's criterion, before diffing */
interface CriterionView {
  source: SearchCriterion;
  name: string;
  table: string;
  negation: boolean;
  relationship?: LineDiff;
  filters: Array<LineDiff & { column: string }>;
  restrictions: LineDiff[];
  tests: LineDiff[];
}

function makeViews(side: 'base' | 'target', report: EmisReport, ctx: RuleDiffContext) {
  const names = buildFriendlyNameMap(report);
  const listRef = (vs: EmisValueSet): ListRef => {
    const raw = names.get(vs.id) ?? vs.id;
    const cluster = vs.description || null;
    const name = side === 'base' ? ctx.listRenames.get(raw) ?? raw : raw;
    const change = ctx.listChange(side, raw, cluster);
    return {
      name,
      cluster,
      codeSystem: vs.codeSystem ?? '',
      count: vs.values.length,
      preview: formatValueSetPreview(vs),
      ...(change ? { change } : {}),
    };
  };
  const view = (c: SearchCriterion): CriterionView => {
    const d = getCriterionDisplayData(c);
    return {
      source: c,
      name: c.displayName || c.table,
      table: c.table,
      negation: c.negation,
      ...(c.relationship ? { relationship: { status: 'unchanged' as const, text: formatRelationship(c.relationship) } } : {}),
      filters: d.filters.map((f, i) => ({
        status: 'unchanged' as const,
        column: f.label || String(i),
        text: `${f.label} ${f.value}`.trim(),
        ...(f.valueSets?.length ? { lists: f.valueSets.map(listRef) } : {}),
      })),
      restrictions: d.restrictions.map((r) => ({ status: 'unchanged' as const, text: r.label ? `${r.label} ${r.value}` : r.value })),
      tests: d.testValueSets.map((vs) => ({ status: 'unchanged' as const, text: vs.description || formatValueSetPreview(vs), lists: [listRef(vs)] })),
    };
  };
  return { view, side };
}

const signature = (v: CriterionView) => [v.table, v.name, ...v.filters.map((f) => f.text), ...v.restrictions.map((r) => r.text)].join(' ');

type Viewer = ReturnType<typeof makeViews>;

/** A criterion from one side only; its lines carry no change marks so it reads as written */
function wholeCriterion(c: SearchCriterion, status: 'added' | 'removed', viewer: Viewer): CriterionDiff {
  const v = viewer.view(c);
  return {
    status,
    name: v.name,
    table: v.table,
    negation: v.negation,
    ...(v.relationship ? { relationship: v.relationship } : {}),
    filters: v.filters.map(({ column: _column, ...l }) => l),
    restrictions: v.restrictions,
    tests: v.tests,
    linked: c.linkedCriteria.map((x) => wholeCriterion(x, status, viewer)),
    groups: (c.baseCriteriaGroups ?? []).map((g) => ({
      status: 'unchanged' as const,
      operator: g.memberOperator,
      criteria: g.criteria.map((x) => wholeCriterion(x, status, viewer)),
    })),
  };
}

function diffCriteria(bs: SearchCriterion[], ts: SearchCriterion[], bv: Viewer, tv: Viewer): CriterionDiff[] {
  const bViews = bs.map(bv.view);
  const tViews = ts.map(tv.view);
  const firstList = (v: CriterionView) => {
    const l = [...v.filters, ...v.tests].flatMap((x) => x.lists ?? [])[0];
    return l ? l.cluster ?? l.preview : '';
  };
  return align(bViews, tViews, { id: (v) => v.source.id, sig: signature }).flatMap(({ b, t }): CriterionDiff[] => {
    if (!b) return [wholeCriterion(t!.source, 'added', tv)];
    if (!t) return [wholeCriterion(b.source, 'removed', bv)];
    const relationship = b.relationship || t.relationship ? lineDiff(b.relationship, t.relationship) : undefined;
    const filters = diffLines(b.filters, t.filters, (l) => (l as CriterionView['filters'][number]).column).map((l) => {
      const { column: _column, ...rest } = l as LineDiff & { column?: string };
      return rest;
    });
    const restrictions = diffLines(b.restrictions, t.restrictions);
    const tests = diffLines(b.tests, t.tests);
    const linked = diffCriteria(b.source.linkedCriteria, t.source.linkedCriteria, bv, tv);
    const groups = align(b.source.baseCriteriaGroups ?? [], t.source.baseCriteriaGroups ?? [], {
      sig: (g) => g.criteria.map((c) => `${c.table} ${c.displayName}`).join(' '),
      threshold: 0,
    }).map(({ b: bg, t: tg }) => {
      if (!bg) return { status: 'added' as const, operator: tg!.memberOperator, criteria: tg!.criteria.map((x) => wholeCriterion(x, 'added', tv)) };
      if (!tg) return { status: 'removed' as const, operator: bg.memberOperator, criteria: bg.criteria.map((x) => wholeCriterion(x, 'removed', bv)) };
      const criteria = diffCriteria(bg.criteria, tg.criteria, bv, tv);
      const operatorChanged = bg.memberOperator !== tg.memberOperator;
      return {
        status: operatorChanged ? ('changed' as const) : worst(criteria.map((c) => c.status)),
        operator: tg.memberOperator,
        ...(operatorChanged ? { operatorFrom: bg.memberOperator } : {}),
        criteria,
      };
    });
    const own = [...filters, ...restrictions, ...tests];
    const kept = own.filter((l) => l.status === 'unchanged' || (l.status === 'changed' && !l.from)).length;
    if (firstList(b) && firstList(t) && firstList(b) !== firstList(t) && kept < own.length * REPLACE_KEPT_SHARE) {
      return [wholeCriterion(b.source, 'removed', bv), { ...wholeCriterion(t.source, 'added', tv), replaces: true }];
    }
    const negationChanged = b.negation !== t.negation;
    const status =
      negationChanged || b.name !== t.name || b.table !== t.table
        ? 'changed'
        : worst([relationship?.status ?? 'unchanged', ...[...filters, ...restrictions, ...tests, ...linked, ...groups].map((x) => x.status)]);
    return [
      {
        status,
        name: t.name,
        ...(b.name !== t.name ? { nameFrom: b.name } : {}),
        table: t.table,
        ...(b.table !== t.table ? { tableFrom: b.table } : {}),
        negation: t.negation,
        ...(negationChanged ? { negationFrom: b.negation } : {}),
        ...(relationship ? { relationship } : {}),
        filters,
        restrictions,
        tests,
        linked,
        groups,
      },
    ];
  });
}

type Group = { kind: 'rule'; g: CriteriaGroup; n: number } | { kind: 'column'; g: ColumnGroup; n: number };

const groupsOf = (r: EmisReport): Group[] => [
  ...(r.criteriaGroups ?? []).map((g, i) => ({ kind: 'rule' as const, g, n: i + 1 })),
  ...(r.columnGroups ?? []).map((g, i) => ({ kind: 'column' as const, g, n: i + 1 })),
];

/**
 * Matched rules that changed order relative to each other: those outside the longest run kept in
 * older order. A rule added or removed only renumbers the others, so it moves none.
 */
function movedRules(pairs: Array<{ b?: Group; t?: Group }>): Set<Group> {
  const kept = pairs.filter((p): p is { b: Group; t: Group } => !!p.b && !!p.t && p.b.kind === 'rule');
  const n = kept.map((p) => p.b.n);
  // O(n²) longest increasing subsequence; searches have a handful of rules
  const len = n.map(() => 1);
  const prev = n.map(() => -1);
  n.forEach((x, i) => {
    for (let j = 0; j < i; j++) {
      if (n[j] < x && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
  });
  const inOrder = new Set<number>();
  for (let i = len.indexOf(Math.max(0, ...len)); i >= 0; i = prev[i]) inOrder.add(i);
  return new Set(kept.filter((_, i) => !inOrder.has(i)).map((p) => p.b));
}

export function diffRules(base: EmisReport, target: EmisReport, ctx: RuleDiffContext): RuleDiff[] {
  const bv = makeViews('base', base, ctx);
  const tv = makeViews('target', target, ctx);
  const popLines = (grp: Group, side: 'base' | 'target'): LineDiff[] =>
    grp.kind === 'rule' ? grp.g.populationCriteria.map((p) => ({ status: 'unchanged', text: `Patients included in search: ${ctx.populationName(side, p.reportGuid)}` })) : [];
  const libLines = (grp: Group): LineDiff[] =>
    grp.kind === 'rule' ? (grp.g.libraryItemRefs ?? []).map((ref) => ({ status: 'unchanged', text: `EMIS library item: ${ctx.libraryItemName(ref)}` })) : [];
  const groupSig = (grp: Group) =>
    [grp.kind, grp.kind === 'column' ? grp.g.displayName : '', ...grp.g.criteria.map((c) => `${c.table} ${c.displayName}`), ...popLines(grp, 'target').map((l) => l.text)].join(' ');

  const pairs = align(groupsOf(base), groupsOf(target), { id: (x) => `${x.kind}:${x.g.id}`, sig: groupSig, threshold: 0.3 });
  const moved = movedRules(pairs);
  return pairs.map(({ b, t }) => {
    const one = (b ?? t)!;
    const head = (grp: Group) => ({
      kind: grp.kind,
      label: grp.kind === 'column' ? grp.g.displayName : '',
      operator: grp.kind === 'rule' ? grp.g.memberOperator : 'AND',
      ...(grp.kind === 'rule' ? { pass: grp.g.actionIfTrue, fail: grp.g.actionIfFalse } : {}),
      ...(grp.kind === 'column' ? { columns: { status: 'unchanged' as const, text: grp.g.listColumns.map((c) => c.displayName).join(', ') } } : {}),
    });
    if (!b || !t) {
      const status = b ? ('removed' as const) : ('added' as const);
      const viewer = b ? bv : tv;
      return {
        status,
        number: one.n,
        ...head(one),
        population: popLines(one, b ? 'base' : 'target'),
        libraryItems: libLines(one),
        criteria: one.g.criteria.map((c) => wholeCriterion(c, status, viewer)),
      };
    }
    const criteria = diffCriteria(b.g.criteria, t.g.criteria, bv, tv);
    const population = diffLines(popLines(b, 'base'), popLines(t, 'target'));
    const libraryItems = diffLines(libLines(b), libLines(t));
    const hb = head(b);
    const ht = head(t);
    const columns = hb.columns && ht.columns ? lineDiff(hb.columns, ht.columns) : undefined;
    const changes = {
      ...(hb.operator !== ht.operator ? { operatorFrom: hb.operator } : {}),
      ...(hb.pass !== ht.pass ? { passFrom: hb.pass } : {}),
      ...(hb.fail !== ht.fail ? { failFrom: hb.fail } : {}),
    };
    const reordered = moved.has(b);
    const status =
      Object.keys(changes).length || hb.label !== ht.label || reordered
        ? 'changed'
        : worst([columns?.status ?? 'unchanged', ...[...criteria, ...population, ...libraryItems].map((x) => x.status)]);
    return {
      status,
      number: t.n,
      ...(b.n !== t.n ? { previousNumber: b.n } : {}),
      ...(reordered ? { reordered: true } : {}),
      ...ht,
      ...(columns ? { columns } : {}),
      ...changes,
      population,
      libraryItems,
      criteria,
    };
  });
}

/**
 * What a rule diff changes: 'logic' (text, structure, actions or operators), 'codes' (only the
 * contents of code lists inside otherwise identical rules) or 'none'.
 */
export function ruleChangeKind(rules: RuleDiff[]): 'logic' | 'codes' | 'none' {
  let codes = false;
  const line = (l?: LineDiff) => {
    if (!l || l.status === 'unchanged') return false;
    if (l.status === 'changed' && !l.from) {
      codes = true;
      return false;
    }
    return true;
  };
  const criterion = (c: CriterionDiff): boolean =>
    c.status === 'added' ||
    c.status === 'removed' ||
    c.negationFrom !== undefined ||
    c.tableFrom !== undefined ||
    c.nameFrom !== undefined ||
    line(c.relationship) ||
    [...c.filters, ...c.restrictions, ...c.tests].some(line) ||
    c.linked.some(criterion) ||
    c.groups.some((g) => g.status === 'added' || g.status === 'removed' || !!g.operatorFrom || g.criteria.some(criterion));
  const logic = rules.some(
    (r) =>
      r.status === 'added' ||
      r.status === 'removed' ||
      !!(r.passFrom || r.failFrom || r.operatorFrom || r.reordered) ||
      line(r.columns) ||
      [...r.population, ...r.libraryItems].some(line) ||
      r.criteria.some(criterion)
  );
  return logic ? 'logic' : codes ? 'codes' : 'none';
}

/** Every code list referenced by filter lines and restriction tests in a rule diff */
export function listRefsIn(rules: RuleDiff[]): ListRef[] {
  const out: ListRef[] = [];
  const lines = (ls: LineDiff[]) => ls.forEach((l) => out.push(...(l.lists ?? [])));
  const criterion = (c: CriterionDiff) => {
    lines(c.filters);
    lines(c.tests);
    c.linked.forEach(criterion);
    c.groups.forEach((g) => g.criteria.forEach(criterion));
  };
  rules.forEach((r) => r.criteria.forEach(criterion));
  return out;
}
