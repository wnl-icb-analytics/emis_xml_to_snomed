import assert from 'node:assert/strict';
import test from 'node:test';
import type { CriteriaGroup, EmisReport, EmisValueSet, SearchCriterion } from './types';
import { align, diffRules, ruleChangeKind, type RuleDiffContext } from './rule-diff';
import { getCriterionDisplayData } from './agent-report-utils';

const vs = (id: string, cluster: string, codes: string[]): EmisValueSet => ({
  id,
  codeSystem: 'SNOMED_CONCEPT',
  description: cluster,
  values: codes.map((code) => ({ code, displayName: `Concept ${code}`, includeChildren: false })),
  exceptions: [],
});

function criterion(id: string, list: EmisValueSet, from?: string, extra: Partial<SearchCriterion> = {}): SearchCriterion {
  return {
    id,
    table: 'EVENTS',
    displayName: 'Clinical Codes',
    negation: false,
    valueSets: [list],
    columnFilters: [
      { columns: ['READCODE'], inNotIn: 'IN', valueSets: [list] },
      ...(from ? [{ columns: ['DATE'], range: { from: { operator: 'GTEQ', value: from } } }] : []),
    ],
    restrictions: [],
    linkedCriteria: [],
    ...extra,
  };
}

const group = (id: string, criteria: SearchCriterion[], over: Partial<CriteriaGroup> = {}): CriteriaGroup => ({
  id,
  memberOperator: 'AND',
  criteria,
  populationCriteria: [],
  actionIfTrue: 'SELECT',
  actionIfFalse: 'REJECT',
  ...over,
});

const report = (groups: CriteriaGroup[]): EmisReport => ({
  id: 'r',
  xmlId: 'r',
  name: 'BP register',
  searchName: 'BP register',
  rule: 'SET > F',
  reportType: 'population',
  parentType: 'ACTIVE',
  valueSets: groups.flatMap((g) => g.criteria.flatMap((c) => c.valueSets)),
  criteriaGroups: groups,
});

const ctx: RuleDiffContext = {
  listRenames: new Map(),
  listChange: () => undefined,
  populationName: (_side, guid) => guid,
  libraryItemName: (ref) => ref,
};

const bp = vs('bp', 'CLINBP_COD', ['1']);
const frail = vs('frail', 'FRAIL_COD', ['2']);

test('a changed date shows as an edited line; untouched criteria are kept in full', () => {
  const [rule] = diffRules(
    report([group('g1', [criterion('c1', bp, '01/04/2025'), criterion('c2', frail)])]),
    report([group('g1', [criterion('c1', bp, '01/04/2026'), criterion('c2', frail)])]),
    ctx
  );
  assert.equal(rule.status, 'changed');
  const [dated, same] = rule.criteria;
  assert.equal(dated.status, 'changed');
  const edited = dated.filters.filter((f) => f.status === 'changed');
  assert.equal(edited.length, 1);
  assert.match(edited[0].from!, /01\/04\/2025/);
  assert.match(edited[0].text, /01\/04\/2026/);
  assert.equal(dated.filters.find((f) => f.status === 'unchanged')?.lists?.[0].cluster, 'CLINBP_COD');
  assert.equal(same.status, 'unchanged');
  assert.ok(same.filters.length > 0 && same.filters.every((f) => f.status === 'unchanged'));
});

test('new criteria, removed library items and changed actions are marked', () => {
  const rules = diffRules(
    report([group('g1', [], { libraryItemRefs: ['lib-1'] }), group('g2', [criterion('c2', frail)])]),
    report([group('g1', [criterion('c9', bp)]), group('g2', [criterion('c2', frail)], { actionIfFalse: 'NEXT' }), group('g3', [criterion('c3', frail)])]),
    ctx
  );
  assert.deepEqual(rules.map((r) => [r.number, r.status]), [[1, 'changed'], [2, 'changed'], [3, 'added']]);
  assert.deepEqual(rules[0].libraryItems.map((l) => [l.status, l.text]), [['removed', 'EMIS library item: lib-1']]);
  assert.equal(rules[0].criteria[0].status, 'added');
  assert.deepEqual([rules[1].fail, rules[1].failFrom], ['NEXT', 'REJECT']);
});

test('changed code lists mark the filter that uses them', () => {
  const [rule] = diffRules(report([group('g1', [criterion('c1', bp)])]), report([group('g1', [criterion('c1', vs('bp2', 'CLINBP_COD', ['9']))])]), {
    ...ctx,
    listChange: (side, _name, cluster) => (side === 'target' && cluster === 'CLINBP_COD' ? 'changed' : undefined),
  });
  const [c] = rule.criteria;
  assert.equal(c.status, 'changed');
  assert.deepEqual(c.filters.map((f) => [f.status, f.lists?.[0].change]), [['changed', 'changed']]);
});

test('align keeps newer order and places removed items before the next pair that follows them', () => {
  const pairs = align(['a', 'gone', 'b'], ['a', 'new', 'b'], { sig: (x) => x });
  assert.deepEqual(pairs, [{ b: 'a', t: 'a' }, { t: 'new' }, { b: 'gone' }, { b: 'b', t: 'b' }]);
});

test('excluded enum values are named, not shown as "No display names"', () => {
  const episodes: EmisValueSet = {
    id: 'ep',
    codeSystem: 'EMISINTERNAL',
    values: ['REVIEW', 'ENDED'].map((code) => ({ code, displayName: '', includeChildren: false })),
    exceptions: [],
    isAllValuesExcept: true,
  };
  const c = criterion('c1', bp, undefined, { columnFilters: [{ columns: ['EPISODE'], inNotIn: 'IN', valueSets: [episodes] }] });
  const [filter] = getCriterionDisplayData(c).filters;
  assert.doesNotMatch(filter.value, /No display names/);
  assert.match(filter.value, /^not in Review, Ended$/i);
});

test('ruleChangeKind separates code-list-only changes from logic changes', () => {
  const lists = (side: 'base' | 'target', _name: string, cluster: string | null) => (side === 'target' && cluster === 'CLINBP_COD' ? ('changed' as const) : undefined);
  const codesOnly = diffRules(report([group('g1', [criterion('c1', bp)])]), report([group('g1', [criterion('c1', vs('bp2', 'CLINBP_COD', ['9']))])]), {
    ...ctx,
    listChange: lists,
  });
  assert.equal(ruleChangeKind(codesOnly), 'codes');
  const logic = diffRules(report([group('g1', [criterion('c1', bp, '01/04/2025')])]), report([group('g1', [criterion('c1', bp, '01/04/2026')])]), ctx);
  assert.equal(ruleChangeKind(logic), 'logic');
  const same = diffRules(report([group('g1', [criterion('c1', bp)])]), report([group('g1', [criterion('c1', bp)])]), ctx);
  assert.equal(ruleChangeKind(same), 'none');
});
