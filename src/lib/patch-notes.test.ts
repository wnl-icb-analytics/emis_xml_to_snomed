import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmisReport, EmisValueSet, EmisXmlDocument, SearchCriterion } from './types';
import { diffXmlDocuments } from './xml-diff';
import { buildPatchNotes, readableDelta, renderPatchNotesMarkdown } from './patch-notes';

const vs = (id: string, cluster: string, codes: string[]): EmisValueSet => ({
  id,
  codeSystem: 'SNOMED_CONCEPT',
  description: cluster,
  values: codes.map((code) => ({ code, displayName: `Concept ${code}`, includeChildren: false })),
  exceptions: [],
});

const criterion = (id: string, list: EmisValueSet, from: string, max: string): SearchCriterion => ({
  id,
  table: 'EVENTS',
  displayName: 'Clinical Codes',
  negation: false,
  valueSets: [list],
  columnFilters: [
    { columns: ['READCODE'], inNotIn: 'IN', valueSets: [list] },
    { columns: ['DATE'], range: { from: { operator: 'GTEQ', value: from } } },
    { columns: ['NUMERIC_VALUE'], range: { to: { operator: max.startsWith('<=') ? 'LTEQ' : 'LT', value: max.replace(/[<=]/g, '') } } },
  ],
  restrictions: [],
  linkedCriteria: [],
});

function doc(root: string, year: string, bpCodes: string[]): EmisXmlDocument {
  const bp = vs('bp', 'CLINBP_COD', bpCodes);
  const home = vs('home', 'HOMEAMBBP_COD', ['5']);
  const report: EmisReport = {
    id: `r-${root}`,
    xmlId: `g-${root}`,
    name: 'BP control',
    searchName: 'BP control',
    rule: `${root} > F`,
    reportType: 'population',
    parentType: 'ACTIVE',
    valueSets: [bp, home],
    criteriaGroups: [
      {
        id: 'g1',
        memberOperator: 'OR',
        criteria: [criterion('c1', bp, `01/04/${year}`, year === '2025' ? '<=140' : '<140'), criterion('c2', home, `01/04/${year}`, year === '2025' ? '<=135' : '<135')],
        populationCriteria: [],
        actionIfTrue: 'SELECT',
        actionIfFalse: 'REJECT',
      },
    ],
  };
  return { namespace: 'x', parsedAt: 'fixed', reports: [report] };
}

const result = diffXmlDocuments({ doc: doc('R5', '2025', ['1', '2']), fileName: 'r5.xml' }, { doc: doc('R6', '2026', ['1', '3']), fileName: 'r6.xml' });

test('readableDelta keeps a symbol-only edit with its value', () => {
  const parts = readableDelta('numeric value >= 1 AND <= 90', 'numeric value >= 1 AND < 90');
  assert.deepEqual(
    parts.filter((p) => p.op !== 'eq').map((p) => p.text),
    ['<= 90', '< 90']
  );
});

test('the same edit on several lines is one entry with its places', () => {
  const [note] = buildPatchNotes(result).changed;
  const dates = note.groups.find((g) => g.before === '01/04/2025');
  assert.ok(dates, JSON.stringify(note.groups));
  assert.equal(dates.after, '01/04/2026');
  assert.equal(dates.lines.length, 2);
  assert.ok(dates.lines.every((l) => /^Rule 1 · Clinical Codes \((CLINBP|HOMEAMBBP)_COD\)$/.test(l.where)));
});

test('code list changes carry their codes and where they are used', () => {
  const [note] = buildPatchNotes(result).changed;
  const [codes] = note.codes;
  assert.equal(codes.list.cluster, 'CLINBP_COD');
  assert.deepEqual(codes.list.codesAdded.map((c) => c.code), ['3']);
  assert.deepEqual(codes.list.codesRemoved.map((c) => c.code), ['2']);
  assert.deepEqual(codes.where, ['Rule 1 · Clinical Codes (CLINBP_COD)']);
});

test('year rollovers are routine; other edits carry a plain-English note', () => {
  const [note] = buildPatchNotes(result).changed;
  const dates = note.groups.find((g) => g.before === '01/04/2025')!;
  assert.equal(dates.routine, true);
  const bounds = note.groups.find((g) => g.before === '<=')!;
  assert.equal(bounds.routine, false);
  assert.equal(bounds.note, 'Boundary now exclusive: a value exactly on the threshold no longer counts');
});

test('markdown shows each delta as before ⇒ after with codes in a details block', () => {
  const md = renderPatchNotesMarkdown(buildPatchNotes(result));
  assert.match(md, /<details><summary>Routine year rollover \(1\)<\/summary>[\s\S]*^- ~~01\/04\/2025~~ ⇒ \*\*01\/04\/2026\*\* · \*\*2 places\*\* — _Moved on a year_$/m);
  assert.match(md, /<details><summary>\+1 \/ −1 codes<\/summary>/);
  assert.match(md, /\| \+ \| `3` \| Concept 3 \|/);
});

test('readableDelta keeps the shared value on both sides of a one-sided edit', () => {
  const parts = readableDelta('numeric value 90', 'numeric value < 90');
  assert.equal(parts.filter((p) => p.op !== 'add').map((p) => p.text).join(''), 'numeric value 90');
  assert.equal(parts.filter((p) => p.op !== 'del').map((p) => p.text).join(''), 'numeric value < 90');
});

test('rules left out for size are reported, not shown as an empty search', () => {
  const trimmed = { ...result, entries: result.entries.map((e) => ({ ...e, rules: undefined, rulesOmitted: true })) };
  const md = renderPatchNotesMarkdown(buildPatchNotes(trimmed));
  assert.match(md, /Rules left out to keep the response small/);
  assert.doesNotMatch(md, /No rules of its own/);
});
