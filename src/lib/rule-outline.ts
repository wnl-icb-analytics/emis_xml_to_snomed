/**
 * Flattens a rule diff into one row per criterion, condition, restriction or group, so a search's
 * logic reads as an indented outline with changes marked in a gutter rather than as nested boxes.
 */
import type { CriterionDiff, LineDiff, ListRef, NodeStatus, RuleDiff } from './rule-diff';

/** changes: unchanged criteria collapse to one line; full: everything */
export type OutlineMode = 'changes' | 'full';

export interface OutlineRow {
  key: string;
  depth: number;
  kind: 'operator' | 'population' | 'library' | 'criterion' | 'relationship' | 'condition' | 'restriction' | 'test' | 'group' | 'folded';
  /** Effective status; rows inside a new or removed criterion take its status */
  status: NodeStatus;
  /** First row of a new or removed block; carries the block's label */
  mark?: 'added' | 'removed';
  text: string;
  /** Older text, for edited rows */
  from?: string;
  table?: string;
  /** Older table, when the data source changed */
  tableFrom?: string;
  negation?: boolean;
  negationFrom?: boolean;
  /** Operator joining this criterion to the one before it */
  joiner?: string;
  linked?: boolean;
  lists?: ListRef[];
  /** Folded rows: how many unchanged criteria they stand for */
  count?: number;
}

const whole = (s: NodeStatus): 'added' | 'removed' | undefined => (s === 'added' || s === 'removed' ? s : undefined);

const groupText = (op: string) => (op === 'OR' ? 'Any of the following (OR)' : 'All of the following (AND)');
const ruleText = (op: string) => (op === 'OR' ? 'Matches ANY of the following (OR)' : 'Matches ALL of the following (AND)');

function lineRow(key: string, depth: number, kind: OutlineRow['kind'], l: LineDiff, inherited?: 'added' | 'removed'): OutlineRow {
  return {
    key,
    depth,
    kind,
    status: inherited ?? l.status,
    text: l.text,
    ...(l.from && !inherited ? { from: l.from } : {}),
    ...(l.lists ? { lists: l.lists } : {}),
  };
}

function criterionRows(
  c: CriterionDiff,
  depth: number,
  key: string,
  mode: OutlineMode,
  out: OutlineRow[],
  opts: { inherited?: 'added' | 'removed'; joiner?: string; linked?: boolean }
) {
  const own = opts.inherited ?? whole(c.status);
  const base = { joiner: opts.joiner, ...(opts.linked ? { linked: true } : {}) };
  if (mode === 'changes' && !own && c.status === 'unchanged') {
    out.push({ key, depth, kind: 'folded', status: 'unchanged', text: c.name, table: c.table, count: 1, ...base });
    return;
  }
  const negationChanged = !own && c.negationFrom !== undefined;
  const headChanged = !own && (negationChanged || c.nameFrom !== undefined || c.tableFrom !== undefined);
  out.push({
    key,
    depth,
    kind: 'criterion',
    status: own ?? (headChanged ? 'changed' : 'unchanged'),
    ...(own && !opts.inherited ? { mark: own } : {}),
    text: c.name,
    ...(!own && c.nameFrom !== undefined ? { from: c.nameFrom } : {}),
    table: c.table,
    ...(!own && c.tableFrom !== undefined ? { tableFrom: c.tableFrom } : {}),
    negation: c.negation,
    ...(negationChanged ? { negationFrom: c.negationFrom } : {}),
    ...base,
  });
  if (c.relationship) out.push(lineRow(`${key}r`, depth + 1, 'relationship', c.relationship, own));
  c.filters.forEach((l, i) => out.push(lineRow(`${key}f${i}`, depth + 1, 'condition', l, own)));
  c.restrictions.forEach((l, i) => out.push(lineRow(`${key}s${i}`, depth + 1, 'restriction', l, own)));
  c.tests.forEach((l, i) => out.push(lineRow(`${key}t${i}`, depth + 1, 'test', l, own)));
  c.groups.forEach((g, i) => {
    const gOwn = own ?? whole(g.status);
    const from = !gOwn && g.operatorFrom ? groupText(g.operatorFrom) : undefined;
    out.push({
      key: `${key}g${i}`,
      depth: depth + 1,
      kind: 'group',
      status: gOwn ?? (from ? 'changed' : 'unchanged'),
      ...(gOwn && !own ? { mark: gOwn } : {}),
      text: groupText(g.operator),
      ...(from ? { from } : {}),
    });
    siblingRows(g.criteria, depth + 2, `${key}g${i}c`, g.operator, mode, out, gOwn);
  });
  c.linked.forEach((l, i) => criterionRows(l, depth + 1, `${key}l${i}`, mode, out, { inherited: own, linked: true }));
}

/** Criteria at one level; in changes mode, runs of unchanged ones fold into a single row */
function siblingRows(criteria: CriterionDiff[], depth: number, key: string, operator: string, mode: OutlineMode, out: OutlineRow[], inherited?: 'added' | 'removed') {
  criteria.forEach((c, i) => {
    const before = out.length;
    criterionRows(c, depth, `${key}${i}`, mode, out, { inherited, joiner: i > 0 ? operator : undefined });
    const row = out[before];
    const prev = out[before - 1];
    if (out.length === before + 1 && row.kind === 'folded' && prev?.kind === 'folded' && prev.depth === depth && i > 0) {
      out.pop();
      prev.count = (prev.count ?? 1) + 1;
      prev.text = `${prev.text}, ${row.text}`;
    }
  });
}

export function outlineRule(r: RuleDiff, mode: OutlineMode): OutlineRow[] {
  const own = whole(r.status);
  const out: OutlineRow[] = [];
  if (r.population.length + r.libraryItems.length + r.criteria.length > 1) {
    const from = !own && r.operatorFrom ? ruleText(r.operatorFrom) : undefined;
    out.push({ key: 'op', depth: 0, kind: 'operator', status: own ?? (from ? 'changed' : 'unchanged'), text: ruleText(r.operator), ...(from ? { from } : {}) });
  }
  r.population.forEach((l, i) => out.push(lineRow(`p${i}`, 0, 'population', l, own)));
  r.libraryItems.forEach((l, i) => out.push(lineRow(`l${i}`, 0, 'library', l, own)));
  siblingRows(r.criteria, 0, 'c', r.operator, mode, out, own);
  return out;
}

/** Rows that start a run of changes; "next change" stops at each */
export function changeStarts(rows: OutlineRow[]): Set<string> {
  const out = new Set<string>();
  rows.forEach((row, i) => {
    if (row.status === 'unchanged' && !row.lists?.some((l) => l.change)) return;
    const prev = rows[i - 1];
    if (!prev || prev.status === 'unchanged' || prev.status !== row.status || row.mark) out.add(row.key);
  });
  return out;
}

/** One criterion and everything nested in it, in full */
export function outlineCriterion(c: CriterionDiff, depth = 0): OutlineRow[] {
  const out: OutlineRow[] = [];
  criterionRows(c, depth, 'x', 'full', out, {});
  return out;
}
