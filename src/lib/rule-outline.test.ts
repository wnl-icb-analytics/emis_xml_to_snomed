import assert from 'node:assert/strict';
import test from 'node:test';
import type { CriterionDiff, LineDiff, NodeStatus, RuleDiff } from './rule-diff';
import { changeStarts, outlineRule } from './rule-outline';

const line = (text: string, status: NodeStatus = 'unchanged', from?: string): LineDiff => ({ status, text, ...(from ? { from } : {}) });

const crit = (name: string, status: NodeStatus, filters: LineDiff[], more: Partial<CriterionDiff> = {}): CriterionDiff => ({
  status,
  name,
  table: 'EVENTS',
  negation: false,
  filters,
  restrictions: [],
  tests: [],
  linked: [],
  groups: [],
  ...more,
});

const rule = (criteria: CriterionDiff[], status: NodeStatus = 'changed'): RuleDiff => ({
  status,
  kind: 'rule',
  number: 1,
  label: '',
  operator: 'OR',
  pass: 'SELECT',
  fail: 'REJECT',
  population: [],
  libraryItems: [],
  criteria,
});

const r = rule([
  crit('Patient Details', 'unchanged', [line('Age at least 18')]),
  crit('Clinical Codes', 'unchanged', [line('Code in AST_COD')]),
  crit('Clinical Codes', 'changed', [line('Code in BP_COD'), line('Date on or after 01/04/2026', 'changed', 'Date on or after 01/04/2025')]),
  crit('Clinical Codes', 'added', [line('Code in COPD_COD')], {
    groups: [{ status: 'unchanged', operator: 'AND', criteria: [crit('Clinical Codes', 'unchanged', [line('Code in COPDPROC_COD')])] }],
  }),
]);

test('changes mode folds runs of unchanged criteria into one row', () => {
  const rows = outlineRule(r, 'changes');
  const folded = rows.filter((x) => x.kind === 'folded');
  assert.equal(folded.length, 1);
  assert.equal(folded[0].count, 2);
  assert.equal(outlineRule(r, 'full').filter((x) => x.kind === 'folded').length, 0);
});

test('a new criterion is shown in full, labelled once, with its nested logic marked as new', () => {
  const rows = outlineRule(r, 'changes');
  const start = rows.findIndex((x) => x.mark === 'added');
  const block = rows.slice(start);
  assert.deepEqual(
    block.map((x) => [x.kind, x.status, x.text]),
    [
      ['criterion', 'added', 'Clinical Codes'],
      ['condition', 'added', 'Code in COPD_COD'],
      ['group', 'added', 'All of the following (AND)'],
      ['criterion', 'added', 'Clinical Codes'],
      ['condition', 'added', 'Code in COPDPROC_COD'],
    ]
  );
  assert.equal(block.filter((x) => x.mark).length, 1);
});

test('next-change stops at the edited line and at the start of the new block', () => {
  const rows = outlineRule(r, 'changes');
  const starts = [...changeStarts(rows)].map((k) => rows.find((x) => x.key === k)!);
  assert.deepEqual(
    starts.map((x) => [x.kind, x.status]),
    [
      ['condition', 'changed'],
      ['criterion', 'added'],
    ]
  );
  assert.equal(starts[0].from, 'Date on or after 01/04/2025');
});
