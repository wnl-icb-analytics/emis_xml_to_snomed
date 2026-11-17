/**
 * Patch notes: a digest of a search-set diff in the style of game patch notes. Each change is one
 * line with its exact delta (before ⇒ after) and, for common patterns, a plain-English note. Edits
 * repeated across a search are grouped; routine year rollovers are set apart; searches are ordered
 * by how far their change reaches; new, removed and replaced logic carries its full outline; code
 * list changes carry the codes added and removed.
 */
import { diffLineWords, type PatchPart } from './patch-view';
import { listRefsIn, ruleChangeKind, type CriterionDiff, type LineDiff, type ListRef, type RuleDiff } from './rule-diff';
import { outlineCriterion, outlineRule, type OutlineRow } from './rule-outline';
import { explainAction, explainEdit, explainNegation, explainOperator, isRollover } from './change-notes';
import {
  codeListDetails,
  collectTerminologyChanges,
  entryRef,
  FIELD_LABEL,
  type CodeListDetail,
  type SearchDiffEntry,
  type SearchDiffStatus,
  type SearchRef,
  type TerminologyChange,
  type XmlDiffResult,
} from './xml-diff';

/** A line of new or removed logic, indented by depth */
export interface DetailLine {
  depth: number;
  text: string;
}

export interface NoteLine {
  /** Where the change sits, e.g. "Rule 1 · Clinical Codes (CLINBP_COD)" */
  where: string;
  kind: 'edit' | 'added' | 'removed' | 'replaced';
  /** The changed sentence: unchanged text plus del/add pairs */
  parts: PatchPart[];
  /** New or removed logic, in full; for replaced, the new logic */
  detail?: DetailLine[];
  /** Replaced: the old logic */
  detailBefore?: DetailLine[];
  /** What the change means, for common patterns */
  note?: string;
  /** Only a year moving on, as in every annual release */
  routine?: boolean;
}

/** One edit (before ⇒ after) found on several lines of a search */
export interface NoteGroup {
  before: string;
  after: string;
  lines: NoteLine[];
  note?: string;
  routine?: boolean;
}

export interface PropertyNote {
  label: string;
  parts: PatchPart[];
  routine?: boolean;
}

export interface CodeNote {
  list: CodeListDetail;
  /** Rules and criteria that use the list */
  where: string[];
  childrenChanged: SearchDiffEntry['codesChildrenChanged'];
}

export interface RuleDigest {
  title: string;
  actions: string;
  lines: DetailLine[];
}

export interface SearchNote {
  entry: SearchDiffEntry;
  ref: SearchRef;
  tags: string[];
  /** Searches that depend on this one, and the outputs among them */
  reach?: SearchDiffEntry['downstream'];
  properties: PropertyNote[];
  groups: NoteGroup[];
  lines: NoteLine[];
  codes: CodeNote[];
  /** New and removed searches: their rules in full */
  rules?: RuleDigest[];
  /** Every before/after edit in the search's rules, for cross-search highlights */
  edits: Array<[string, string]>;
  /** A general note per edit (keyed "before\u0000after"), for the same highlights */
  editNotes: Record<string, string>;
  /** Every change is a year rollover */
  routineOnly: boolean;
  /** Rules were dropped from the result to fit a size limit, so none are listed */
  rulesOmitted?: boolean;
}

export const RULES_OMITTED = 'Rules left out to keep the response small; see the implementation guide';

export interface Highlight {
  kind: 'reach' | 'edit' | 'codes' | 'folder' | 'routine';
  parts: PatchPart[];
  detail: string;
  note?: string;
}

export interface PatchNotes {
  title: string;
  subtitle: string;
  counts: Record<SearchDiffStatus, number>;
  highlights: Highlight[];
  /** Changed searches with at least one substantive change, furthest-reaching first */
  changed: SearchNote[];
  added: SearchNote[];
  removed: Array<{ folder: string; searches: SearchNote[] }>;
  relocated: SearchNote[];
  /** Searches whose only change is a year rollover */
  routine: SearchNote[];
}

/** Searches named in the "furthest reach" highlight */
const REACH_HIGHLIGHTS = 5;

const ACTION: Record<string, string> = { SELECT: 'Include', REJECT: 'Exclude', NEXT: 'Next rule' };
const action = (a?: string) => (a ? ACTION[a] ?? a : '');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const hasWord = (s: string) => /[\p{L}\p{N}]/u.test(s);
const eq = (text: string): PatchPart => ({ op: 'eq', text });
const swap = (before: string, after: string): PatchPart[] => [
  ...(before ? [{ op: 'del' as const, text: before }] : []),
  ...(after ? [{ op: 'add' as const, text: after }] : []),
];
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const beforeText = (parts: PatchPart[]) => parts.filter((p) => p.op !== 'add').map((p) => p.text).join('');
const afterText = (parts: PatchPart[]) => parts.filter((p) => p.op !== 'del').map((p) => p.text).join('');

/** Word-level delta; an edit made only of symbols takes the next word with it, so "<=" ⇒ "<" reads "<= 90" ⇒ "< 90" */
export function readableDelta(from: string, to: string): PatchPart[] {
  const parts = diffLineWords(from, to).parts.map((p) => ({ ...p }));
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].op === 'eq') continue;
    const del = parts[i].op === 'del' ? parts[i] : undefined;
    const add = parts[i].op === 'add' ? parts[i] : parts[i + 1]?.op === 'add' ? parts[i + 1] : undefined;
    const end = add && add !== parts[i] ? i + 1 : i;
    const next = parts[end + 1];
    // Widening a one-sided edit would drop the word from the side that has no part
    if (del && add && !hasWord(del.text) && !hasWord(add.text) && next?.op === 'eq') {
      const word = next.text.match(/^\s*[^\s,;]+/)?.[0];
      if (word) {
        del.text += word;
        add.text += word;
        next.text = next.text.slice(word.length);
      }
    }
    i = end;
  }
  return parts.filter((p) => p.text);
}

/** The edits on a line as before/after pairs, ignoring where they sit; lines with the same pairs group together */
function editPairs(from: string, to: string): Array<[string, string]> {
  const parts = diffLineWords(from, to).parts;
  const out = new Map<string, [string, string]>();
  parts.forEach((p, i) => {
    let pair: [string, string] | undefined;
    if (p.op === 'del') pair = [p.text.trim(), parts[i + 1]?.op === 'add' ? parts[i + 1].text.trim() : ''];
    else if (p.op === 'add' && parts[i - 1]?.op !== 'del') pair = ['', p.text.trim()];
    if (pair) out.set(pair.join('\u0000'), pair);
  });
  return [...out.values()];
}

/** " (12 codes)" after a condition that uses code lists */
const codeCount = (lists?: ListRef[]) => (lists?.length ? ` (${lists.map((l) => (l.count === 1 ? '1 code' : `${l.count} codes`)).join(' or ')})` : '');

const listSummary = (lists?: ListRef[]) =>
  lists?.length ? ` [${lists.map((l) => `${l.cluster ?? clip(l.preview, 40)}: ${l.count === 1 ? '1 code' : `${l.count} codes`}`).join('; ')}]` : '';

function rowText(row: OutlineRow): string {
  switch (row.kind) {
    case 'criterion':
      return `${row.joiner ? `${row.joiner} ` : ''}${row.linked ? 'Linked: ' : ''}${row.text}${row.negation ? ' (NOT)' : ''}`;
    case 'relationship':
      return `Joined: ${row.text}`;
    case 'test':
      return `Test the kept record:${listSummary(row.lists)}`;
    case 'condition':
      return `${row.text}${codeCount(row.lists)}`;
    default:
      return row.text;
  }
}

const detailOf = (rows: OutlineRow[]): DetailLine[] => rows.map((r) => ({ depth: r.depth, text: rowText(r) }));
/** A criterion's logic without its own header line */
const criterionDetail = (c: CriterionDiff) => detailOf(outlineCriterion(c).slice(1).map((r) => ({ ...r, depth: r.depth - 1 })));
const listsOf = (c: CriterionDiff) => listRefsIn([{ criteria: [c], population: [], libraryItems: [] } as unknown as RuleDiff]);

/** "Clinical Codes (CLINBP_COD)": the criterion plus the first code list or condition that identifies it */
function identity(c: CriterionDiff): string {
  const list = [...c.filters, ...c.tests].flatMap((l) => l.lists ?? [])[0] ?? listsOf(c)[0];
  const what = list ? list.cluster ?? clip(list.preview, 40) : c.filters[0] ? clip(c.filters[0].text, 50) : '';
  return `${what ? `${c.name} (${what})` : c.name}${c.negation ? ' (NOT)' : ''}`;
}

const ruleLabel = (r: RuleDiff) => (r.kind === 'column' ? r.label : `Rule ${r.number}`);
const ruleActions = (r: RuleDiff) => (r.columns ? `Shows: ${r.columns.text}` : `Pass: ${action(r.pass)} · Fail: ${action(r.fail)}`);
/** "Drug code" from "Drug code in Oral Anticoagulants" */
const filterLabel = (text: string) => (text.includes(' in ') ? text.split(' in ')[0] : '');

/** Changes in a modified search's rules, plus where each code list is used */
function walkRules(rules: RuleDiff[]) {
  const lines: NoteLine[] = [];
  const listWhere = new Map<string, Set<string>>();
  const used = (lists: ListRef[] | undefined, where: string) =>
    lists?.forEach((l) => {
      const k = `${l.name}\u0000${l.cluster ?? ''}`;
      listWhere.set(k, (listWhere.get(k) ?? new Set()).add(where));
    });
  const line = (l: LineDiff | undefined, where: string, note?: string) => {
    if (!l) return;
    used(l.lists, where);
    if (l.status === 'changed' && l.from !== undefined) {
      lines.push({ where, kind: 'edit', parts: readableDelta(l.from, l.text), note: explainEdit(l.from, l.text), routine: isRollover(l.from, l.text) });
    } else if (l.status === 'added' || l.status === 'removed') {
      lines.push({ where, kind: l.status, parts: [eq(`${l.text}${codeCount(l.lists)}`)], ...(note ? { note } : {}) });
    }
  };
  const criteria = (list: CriterionDiff[], rule: string) => {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const next = list[i + 1];
      if (c.status === 'removed' && next?.replaces) {
        const where = `${rule} · ${identity(next)}`;
        listsOf(c).forEach((l) => used([l], where));
        listsOf(next).forEach((l) => used([l], where));
        lines.push({
          where: rule,
          kind: 'replaced',
          parts: [eq(`${rule} · `), ...swap(identity(c), identity(next))],
          detailBefore: criterionDetail(c),
          detail: criterionDetail(next),
          note: 'Criterion rewritten: compare the old and new logic below',
        });
        i++;
        continue;
      }
      criterion(c, rule);
    }
  };
  const criterion = (c: CriterionDiff, rule: string) => {
    const where = `${rule} · ${identity(c)}`;
    if (c.status === 'added' || c.status === 'removed') {
      listsOf(c).forEach((l) => used([l], where));
      lines.push({ where: rule, kind: c.status, parts: [eq(`${rule} · ${identity(c)}`)], detail: criterionDetail(c) });
      return;
    }
    if (c.status === 'unchanged') {
      listsOf(c).forEach((l) => used([l], where));
      return;
    }
    if (c.negationFrom !== undefined) {
      lines.push({ where, kind: 'edit', parts: [eq('Negation: '), ...swap(c.negationFrom ? 'NOT' : 'none', c.negation ? 'NOT' : 'none')], note: explainNegation(c.negation) });
    }
    if (c.tableFrom !== undefined) {
      lines.push({ where, kind: 'edit', parts: [eq('Data source: '), ...swap(c.tableFrom, c.table)], note: 'Now searches a different table of records' });
    }
    if (c.nameFrom !== undefined) lines.push({ where, kind: 'edit', parts: [eq('Criterion: '), ...readableDelta(c.nameFrom, c.name)] });
    // Two filters on the same column must both match one record; dropping one fixes a criterion that likely matched nobody
    const count = (texts: string[], label: string) => texts.filter((t) => filterLabel(t) === label).length;
    const before = c.filters.filter((l) => l.status !== 'added').map((l) => l.from ?? l.text);
    const after = c.filters.filter((l) => l.status !== 'removed').map((l) => l.text);
    const resolved = new Set(before.map(filterLabel).filter((label) => label && count(before, label) > 1 && count(after, label) < 2));
    line(c.relationship, where);
    c.filters.forEach((l) =>
      line(
        l,
        where,
        l.status === 'removed' && resolved.has(filterLabel(l.text))
          ? `No longer needs two ${filterLabel(l.text).toLowerCase()} lists to match the same record; the old version likely selected nobody`
          : undefined
      )
    );
    [...c.restrictions, ...c.tests].forEach((l) => line(l, where));
    c.groups.forEach((g) => {
      if (g.status === 'added' || g.status === 'removed') {
        lines.push({
          where,
          kind: g.status,
          parts: [eq(g.operator === 'OR' ? 'Nested group: any of (OR)' : 'Nested group: all of (AND)')],
          detail: g.criteria.flatMap((x) => detailOf(outlineCriterion(x))),
        });
        return;
      }
      if (g.operatorFrom) lines.push({ where, kind: 'edit', parts: [eq('Nested group: '), ...swap(g.operatorFrom, g.operator)], note: explainOperator(g.operatorFrom, g.operator) });
      criteria(g.criteria, rule);
    });
    criteria(c.linked, rule);
  };
  for (const r of rules) {
    const rl = ruleLabel(r);
    if (r.status === 'added' || r.status === 'removed') {
      listRefsIn([r]).forEach((l) => used([l], rl));
      lines.push({ where: rl, kind: r.status, parts: [eq(`${rl} · ${ruleActions(r)}`)], detail: detailOf(outlineRule(r, 'full')) });
      continue;
    }
    if (r.reordered) {
      lines.push({
        where: rl,
        kind: 'edit',
        parts: r.previousNumber ? [eq('Order: '), ...swap(`Rule ${r.previousNumber}`, `Rule ${r.number}`)] : [eq('Order: moved relative to the other rules')],
        note: 'Rules run in order, so moving one can change who is kept',
      });
    }
    if (r.passFrom) lines.push({ where: rl, kind: 'edit', parts: [eq('Pass: '), ...swap(action(r.passFrom), action(r.pass))], note: explainAction('pass', r.passFrom, r.pass!) });
    if (r.failFrom) lines.push({ where: rl, kind: 'edit', parts: [eq('Fail: '), ...swap(action(r.failFrom), action(r.fail))], note: explainAction('fail', r.failFrom, r.fail!) });
    if (r.operatorFrom) {
      lines.push({
        where: rl,
        kind: 'edit',
        parts: [eq('Matches: '), ...swap(r.operatorFrom === 'OR' ? 'ANY (OR)' : 'ALL (AND)', r.operator === 'OR' ? 'ANY (OR)' : 'ALL (AND)')],
        note: explainOperator(r.operatorFrom, r.operator),
      });
    }
    line(r.columns, rl);
    r.population.forEach((l) => line(l, rl));
    // A library item dropped from a rule that gained criteria was spelled out in full
    const gained = r.criteria.some((c) => c.status === 'added');
    r.libraryItems.forEach((l) => line(l, rl, l.status === 'removed' && gained ? 'Replaced by explicit criteria in this rule' : undefined));
    criteria(r.criteria, rl);
  }
  return { lines, listWhere };
}

/** The first word after a line's first edit */
function nextWord(l: NoteLine): string {
  const i = l.parts.findIndex((p) => p.op !== 'eq');
  let j = i;
  while (l.parts[j + 1] && l.parts[j + 1].op !== 'eq') j++;
  return l.parts[j + 1]?.text.match(/^\s*([^\s,;]+)/)?.[1] ?? '';
}

/** Lines sharing the same edits (e.g. a date moved on a year) become one group */
function groupEdits(lines: NoteLine[], pairsOf: Map<NoteLine, Array<[string, string]>>) {
  const byKey = new Map<string, NoteLine[]>();
  for (const l of lines) {
    const pairs = pairsOf.get(l);
    if (!pairs?.length) continue;
    const k = pairs.map((p) => p.join('\u0000')).sort().join('\u0001');
    byKey.set(k, [...(byKey.get(k) ?? []), l]);
  }
  const groups: NoteGroup[] = [];
  const grouped = new Set<NoteLine>();
  for (const ls of byKey.values()) {
    if (ls.length < 2) continue;
    let [before, after] = pairsOf.get(ls[0])![0];
    // A word swap reads better with the word after it when every line shares it: "strictly after ⇒ on or after"
    if (/^[\p{L} ]*$/u.test(before) && /^[\p{L} ]*$/u.test(after)) {
      const next = new Set(ls.map(nextWord));
      const [word] = [...next];
      if (next.size === 1 && word) {
        before = `${before} ${word}`.trim();
        after = `${after} ${word}`.trim();
      }
    }
    const first = ls[0];
    groups.push({
      before,
      after,
      lines: ls,
      note: explainEdit(beforeText(first.parts), afterText(first.parts), true),
      routine: ls.every((l) => l.routine),
    });
    ls.forEach((l) => grouped.add(l));
  }
  return { groups: groups.sort((a, b) => b.lines.length - a.lines.length), rest: lines.filter((l) => !grouped.has(l)) };
}

function properties(e: SearchDiffEntry): PropertyNote[] {
  return e.fieldChanges.map((f) => ({
    label: FIELD_LABEL[f.field],
    parts: f.from && f.to && f.field !== 'reportType' ? diffLineWords(f.from, f.to, true).parts : swap(f.from ?? 'none', f.to ?? 'none'),
    routine: (f.field === 'name' || f.field === 'folder') && !!f.from && !!f.to && isRollover(f.from, f.to, true),
  }));
}

function codeNotes(e: SearchDiffEntry, listWhere: Map<string, Set<string>>): CodeNote[] {
  return codeListDetails(e).map((list) => ({
    list,
    where: [...(listWhere.get(`${list.name}\u0000${list.cluster ?? ''}`) ?? [])],
    childrenChanged: list.childrenChanged,
  }));
}

const reachTag = (e: SearchDiffEntry) => (e.downstream ? `Reaches ${plural(e.downstream.searches, 'search', 'searches')}` : '');

function changedNote(e: SearchDiffEntry): SearchNote {
  const { lines, listWhere } = walkRules(e.rules ?? []);
  const pairsOf = new Map<NoteLine, Array<[string, string]>>();
  // Pairs for grouping come from the plain word diff, before readableDelta widened them
  for (const l of lines) {
    if (l.kind === 'edit') pairsOf.set(l, editPairs(beforeText(l.parts), afterText(l.parts)));
  }
  const { groups, rest } = groupEdits(lines, pairsOf);
  const kind = e.rules ? ruleChangeKind(e.rules) : 'logic';
  const omitted = !!e.rulesOmitted;
  const codes = codeNotes(e, listWhere);
  const props = properties(e);
  const tags = [
    kind === 'codes' && !omitted && 'Logic unchanged, codes only',
    e.renamed && 'Renamed',
    e.moved && 'Moved',
    reachTag(e),
    e.upstreamChanges?.length && `Depends on ${plural(e.upstreamChanges.length, 'changed search', 'changed searches')}`,
  ].filter(Boolean) as string[];
  const edits = new Map<string, [string, string]>();
  const editNotes: Record<string, string> = {};
  for (const [l, pairs] of pairsOf) {
    if (l.routine) continue;
    const note = explainEdit(beforeText(l.parts), afterText(l.parts), true);
    for (const p of pairs) {
      const k = p.join('\u0000');
      edits.set(k, p);
      if (note && !editNotes[k]) editNotes[k] = note;
    }
  }
  const items = [...props, ...groups, ...rest];
  return {
    entry: e,
    ref: entryRef(e),
    tags,
    reach: e.downstream,
    properties: props,
    groups,
    lines: rest,
    codes,
    edits: [...edits.values()],
    editNotes,
    routineOnly: !omitted && !codes.length && items.length > 0 && items.every((x) => x.routine),
    ...(omitted ? { rulesOmitted: true } : {}),
  };
}

function wholeNote(e: SearchDiffEntry): SearchNote {
  const listWhere = new Map<string, Set<string>>();
  for (const r of e.rules ?? []) {
    for (const l of listRefsIn([r])) {
      const k = `${l.name}\u0000${l.cluster ?? ''}`;
      listWhere.set(k, (listWhere.get(k) ?? new Set()).add(ruleLabel(r)));
    }
  }
  return {
    entry: e,
    ref: entryRef(e),
    tags: [reachTag(e)].filter(Boolean),
    reach: e.downstream,
    properties: [],
    groups: [],
    lines: [],
    codes: codeNotes(e, listWhere),
    rules: (e.rules ?? []).map((r) => ({ title: ruleLabel(r), actions: ruleActions(r), lines: detailOf(outlineRule(r, 'full')) })),
    edits: [],
    editNotes: {},
    routineOnly: false,
    ...(e.rulesOmitted ? { rulesOmitted: true } : {}),
  };
}

function relocatedNote(e: SearchDiffEntry): SearchNote {
  const props = properties(e);
  return {
    entry: e,
    ref: entryRef(e),
    tags: [],
    properties: props,
    groups: [],
    lines: [],
    codes: [],
    edits: [],
    editNotes: {},
    routineOnly: props.length > 0 && props.every((p) => p.routine),
  };
}

function highlights(
  changed: SearchNote[],
  routine: SearchNote[],
  terminology: TerminologyChange[],
  entries: SearchDiffEntry[]
): Highlight[] {
  const out: Highlight[] = [];
  for (const n of changed.filter((x) => x.reach?.searches).slice(0, REACH_HIGHLIGHTS)) {
    out.push({
      kind: 'reach',
      parts: [eq(n.ref.name)],
      detail: `reaches ${plural(n.reach!.searches, 'search', 'searches')}${n.reach!.outputCount ? `, ${plural(n.reach!.outputCount, 'output')}` : ''}`,
    });
  }
  // Edits made in several searches, e.g. thresholds made strict across a family of indicators
  const across = new Map<string, { before: string; after: string; searches: Set<string>; note?: string }>();
  for (const n of changed) {
    for (const [before, after] of n.edits) {
      if (isRollover(before, after)) continue;
      const k = `${before}\u0000${after}`;
      const a = across.get(k) ?? { before, after, searches: new Set() };
      a.searches.add(n.ref.name);
      a.note ??= n.editNotes[k];
      across.set(k, a);
    }
  }
  for (const a of [...across.values()].filter((x) => x.searches.size > 1).sort((x, y) => y.searches.size - x.searches.size)) {
    out.push({ kind: 'edit', parts: swap(a.before, a.after), detail: `in ${a.searches.size} searches`, ...(a.note ? { note: a.note } : {}) });
  }
  for (const t of terminology) {
    const label = t.cluster ?? 'Code list without a cluster ID';
    out.push({
      kind: 'codes',
      parts: [eq(`${label}: ${t.status === 'added' ? 'new, ' : t.status === 'removed' ? 'removed, ' : ''}${t.summary}`)],
      detail: t.searches.length === 1 ? t.searches[0].name : `${t.searches.length} searches`,
    });
  }
  const byFolder = (status: 'added' | 'removed') => {
    const m = new Map<string, number>();
    entries.filter((e) => e.status === status).forEach((e) => m.set(entryRef(e).folder, (m.get(entryRef(e).folder) ?? 0) + 1));
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  for (const [folder, n] of byFolder('added')) out.push({ kind: 'folder', parts: [eq(`${plural(n, 'new search', 'new searches')}`)], detail: `in ${folder || '(root)'}` });
  for (const [folder, n] of byFolder('removed')) out.push({ kind: 'folder', parts: [eq(`${plural(n, 'search', 'searches')} removed`)], detail: `from ${folder || '(root)'}` });
  // From the entries in view, so a scoped report lists only its own moves
  const byMove = new Map<string, { from: string; to: string; searches: number }>();
  for (const e of entries) {
    if (!e.moved || !e.base || !e.target || isRollover(e.base.folder, e.target.folder, true)) continue;
    const k = `${e.base.folder}\u0000${e.target.folder}`;
    const m = byMove.get(k) ?? { from: e.base.folder, to: e.target.folder, searches: 0 };
    m.searches++;
    byMove.set(k, m);
  }
  const moves = [...byMove.values()].sort((a, b) => b.searches - a.searches);
  for (const m of moves) out.push({ kind: 'folder', parts: [eq('Folder: '), ...diffLineWords(m.from, m.to, true).parts], detail: plural(m.searches, 'search', 'searches') });
  // Rollovers within otherwise changed searches count too
  const rolled = new Set([...routine, ...changed.filter((n) => [...n.properties, ...n.groups, ...n.lines].some((x) => x.routine))].map((n) => n.ref.name));
  if (rolled.size) {
    out.push({ kind: 'routine', parts: [eq('Routine year rollover')], detail: `dates, names and folders moved on a year in ${plural(rolled.size, 'search', 'searches')}` });
  }
  return out;
}

export function buildPatchNotes(result: XmlDiffResult, opts: { scopeOnly?: boolean } = {}): PatchNotes {
  const entries = opts.scopeOnly ? result.entries.filter((e) => e.scope) : result.entries;
  const counts: Record<SearchDiffStatus, number> = { modified: 0, added: 0, removed: 0, moved: 0, renamed: 0, unchanged: 0 };
  entries.forEach((e) => counts[e.status]++);
  const byReach = (a: SearchNote, b: SearchNote) =>
    (b.reach?.searches ?? 0) - (a.reach?.searches ?? 0) || `${a.ref.folder}${a.ref.name}`.localeCompare(`${b.ref.folder}${b.ref.name}`);
  const modified = entries.filter((e) => e.status === 'modified').map(changedNote);
  const relocated = entries.filter((e) => e.status === 'moved' || e.status === 'renamed').map(relocatedNote);
  const changed = modified.filter((n) => !n.routineOnly).sort(byReach);
  const routine = [...modified, ...relocated].filter((n) => n.routineOnly).sort(byReach);
  const removed = new Map<string, SearchNote[]>();
  for (const e of entries.filter((x) => x.status === 'removed')) {
    const f = entryRef(e).folder;
    const n = wholeNote(e);
    if (n.rulesOmitted) n.tags.push('rules left out for size');
    removed.set(f, [...(removed.get(f) ?? []), n]);
  }
  return {
    title: `${result.base.label} → ${result.target.label}`,
    subtitle: `${result.base.fileName} → ${result.target.fileName}`,
    counts,
    highlights: highlights(changed, routine, collectTerminologyChanges(entries), entries),
    changed,
    added: entries.filter((e) => e.status === 'added').map(wholeNote).sort(byReach),
    removed: [...removed].map(([folder, searches]) => ({ folder, searches })),
    relocated: relocated.filter((n) => !n.routineOnly),
    routine,
  };
}

// === Markdown ===

const esc = (s: string) => s.replace(/[\\`*_[\]<>|~]/g, (c) => `\\${c}`).replace(/\n/g, ' ');

/** del/add pairs as "~~before~~ ⇒ **after**" */
function mdParts(parts: PatchPart[]): string {
  let out = '';
  parts.forEach((p, i) => {
    const t = p.text.trim() ? esc(p.text.trim()) : '';
    const lead = p.text.match(/^\s*/)?.[0] ?? '';
    const tail = p.text.match(/\s*$/)?.[0] ?? '';
    if (p.op === 'eq') out += esc(p.text);
    else if (p.op === 'del') out += `${lead}~~${t}~~${parts[i + 1]?.op === 'add' ? ' ⇒ ' : tail}`;
    else out += `${parts[i - 1]?.op === 'del' ? '' : lead}**${t}**${tail}`;
  });
  return out;
}

/** "12 codes, 2 exceptions" */
export const codeTally = (codes: Array<{ excluded: boolean }>) => {
  const x = codes.filter((c) => c.excluded).length;
  const n = codes.length - x;
  return `${n} ${n === 1 ? 'code' : 'codes'}${x ? `, ${x} ${x === 1 ? 'exception' : 'exceptions'}` : ''}`;
};

const mdDetail = (lines: DetailLine[], indent = '') => lines.map((l) => `${indent}${'  '.repeat(l.depth)}- ${esc(l.text)}`);
const mdNote = (note?: string) => (note ? ` — _${esc(note)}_` : '');

function mdCodes(n: CodeNote, plain: boolean): string[] {
  const l = n.list;
  const head = `- **${esc(l.cluster ?? 'No cluster ID')}** \`${l.name}\`${n.where.length ? ` (${n.where.map(esc).join('; ')})` : ''}: ${esc(l.summary)}`;
  const rows = [
    ...l.codesAdded.map((c) => [plain ? '' : '+', c] as const),
    ...l.codesRemoved.map((c) => [plain ? '' : '−', c] as const),
  ];
  const flips = n.childrenChanged.map((c) => `| ~ | \`${c.code}\` | ${esc(c.displayName)} (${c.from ? 'with children' : 'code only'} ⇒ ${c.to ? 'with children' : 'code only'}) |`);
  // A lone refset is fully described by the summary
  if (!flips.length && (rows.length === 0 || (rows.length === 1 && rows[0][1].isRefset))) return [head];
  const label = plain
    ? codeTally([...l.codesAdded, ...l.codesRemoved])
    : [l.codesAdded.length && `+${l.codesAdded.length}`, l.codesRemoved.length && `−${l.codesRemoved.length}`, flips.length && `~${flips.length}`].filter(Boolean).join(' / ') + ' codes';
  return [
    head,
    '',
    `  <details><summary>${label}</summary>`,
    '',
    '  | | Code | Name |',
    '  | --- | --- | --- |',
    ...rows.map(([s, c]) => `  | ${s} | \`${c.code}\` | ${esc(c.displayName || (c.isRefset ? 'refset' : ''))}${c.excluded ? ' (exception)' : ''} |`),
    ...flips.map((f) => `  ${f}`),
    '',
    '  </details>',
    '',
  ];
}

function mdLine(l: NoteLine): string[] {
  const tag = { added: '**NEW** ', removed: '**REMOVED** ', replaced: '**REPLACED** ', edit: '' }[l.kind];
  const text = mdParts(l.parts);
  const where = l.kind === 'edit' ? `${esc(l.where)}: ` : '';
  const suffix = l.kind !== 'edit' && !text.startsWith(esc(l.where)) ? ` _(${esc(l.where)})_` : '';
  const out = [`- ${tag}${where}${text}${suffix}${mdNote(l.note)}`];
  if (l.detailBefore) out.push('  - Before:', ...mdDetail(l.detailBefore, '    '), '  - After:', ...mdDetail(l.detail ?? [], '    '));
  else if (l.detail) out.push(...mdDetail(l.detail, '  '));
  return out;
}

function mdGroup(g: NoteGroup): string[] {
  return [`- ${mdParts(swap(g.before, g.after))} · **${g.lines.length} places**${mdNote(g.note)}`, ...g.lines.map((l) => `  - ${esc(l.where)}: ${mdParts(l.parts)}`)];
}

export function renderPatchNotesMarkdown(notes: PatchNotes): string {
  const out: string[] = [];
  const c = notes.counts;
  out.push(`# Patch notes: ${esc(notes.title)}`, '', `_${esc(notes.subtitle)}_`, '');
  out.push(`**${c.modified} changed · ${c.added} new · ${c.removed} removed · ${c.moved} moved · ${c.renamed} renamed**`, '');

  if (notes.highlights.length) {
    out.push('## Highlights', '');
    for (const h of notes.highlights) out.push(`- ${mdParts(h.parts)} _${esc(h.detail)}_${mdNote(h.note)}`);
    out.push('');
  }

  if (notes.changed.length) {
    out.push('## Changed searches', '', '_Furthest-reaching first._', '');
    for (const n of notes.changed) {
      out.push(`### ${esc(n.ref.name)}`, '', `${esc(n.ref.folder || '(root)')}${n.tags.length ? ` · ${n.tags.map(esc).join(' · ')}` : ''}`, '');
      const props = n.properties.filter((p) => !p.routine);
      const groups = n.groups.filter((g) => !g.routine);
      const lines = n.lines.filter((l) => !l.routine);
      for (const p of props) out.push(`- **${p.label}**: ${mdParts(p.parts)}`);
      groups.forEach((g) => out.push(...mdGroup(g)));
      lines.forEach((l) => out.push(...mdLine(l)));
      const routine = [...n.properties.filter((p) => p.routine), ...n.groups.filter((g) => g.routine), ...n.lines.filter((l) => l.routine)];
      if (routine.length) {
        out.push('', `  <details><summary>Routine year rollover (${routine.length})</summary>`, '');
        n.properties.filter((p) => p.routine).forEach((p) => out.push(`- **${p.label}**: ${mdParts(p.parts)}`));
        n.groups.filter((g) => g.routine).forEach((g) => out.push(...mdGroup(g)));
        n.lines.filter((l) => l.routine).forEach((l) => out.push(...mdLine(l)));
        out.push('', '  </details>', '');
      }
      if (n.rulesOmitted) out.push(`- _${RULES_OMITTED}._`);
      if (n.codes.length) {
        out.push('', '**Code lists**', '');
        n.codes.forEach((x) => out.push(...mdCodes(x, false)));
      }
      out.push('');
    }
  }

  if (notes.added.length) {
    out.push('## New searches', '');
    for (const n of notes.added) {
      out.push(`### ${esc(n.ref.name)}`, '', `${esc(n.ref.folder || '(root)')}${n.tags.length ? ` · ${n.tags.map(esc).join(' · ')}` : ''}`, '');
      for (const r of n.rules ?? []) {
        out.push(`- **${esc(r.title)}** · ${esc(r.actions)}`);
        out.push(...mdDetail(r.lines, '  '));
      }
      if (n.rulesOmitted) out.push(`- _${RULES_OMITTED}._`);
      else if (!n.rules?.length) out.push('- No rules of its own; it reports on its parent population.');
      if (n.codes.length) {
        out.push('', '**Code lists**', '');
        n.codes.forEach((x) => out.push(...mdCodes(x, true)));
      }
      out.push('');
    }
  }

  if (notes.removed.length) {
    out.push('## Removed searches', '');
    for (const g of notes.removed) {
      out.push(`**${esc(g.folder || '(root)')}**`, '');
      for (const n of g.searches) out.push(`- ${esc(n.ref.name)}${n.tags.length ? ` _(${n.tags.map(esc).join(', ')})_` : ''}`);
      out.push('');
    }
  }

  if (notes.relocated.length) {
    out.push('## Moved and renamed (logic unchanged)', '');
    for (const n of notes.relocated) out.push(`- **${esc(n.ref.name)}**: ${n.properties.map((p) => `${p.label} ${mdParts(p.parts)}`).join('; ')}`);
    out.push('');
  }

  if (notes.routine.length) {
    out.push('## Routine year rollover', '', '_Searches whose only change is the year moving on._', '');
    for (const n of notes.routine) {
      const what = [
        ...n.properties.map((p) => p.label.toLowerCase()),
        ...n.groups.map((g) => `${g.lines.length} dates`),
        ...(n.lines.length ? [plural(n.lines.length, 'date')] : []),
      ];
      out.push(`- ${esc(n.ref.name)} _(${what.join(', ')})_`);
    }
    out.push('');
  }
  return out.join('\n');
}
