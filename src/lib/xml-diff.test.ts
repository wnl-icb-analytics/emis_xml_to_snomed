import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmisReport, EmisXmlDocument } from './types';
import { diffXmlDocuments, parseDiffScope, renderXmlDiffMarkdown, type DiffScopeInput } from './xml-diff';

// Synthetic searches. GUIDs are passed per side to mimic EMIS re-exports rotating them.
interface Spec {
  guid: string;
  folder: string;
  name: string;
  codes?: string[];
  parent?: string;
  groupId?: string;
}

function report(s: Spec, root: string): EmisReport {
  const vs = {
    id: `vs-${s.name}`,
    codeSystem: 'SNOMED_CONCEPT',
    description: 'TEST_COD',
    values: (s.codes ?? ['1001']).map((code) => ({ code, displayName: `Concept ${code}`, includeChildren: false })),
    exceptions: [],
  };
  return {
    id: `id-${s.guid}`,
    xmlId: s.guid,
    name: s.name,
    searchName: s.name,
    rule: `${root} > ${s.folder}`,
    reportType: 'population',
    parentType: s.parent ? 'POP' : 'ACTIVE',
    parentReportId: s.parent,
    valueSets: [vs],
    criteriaGroups: [
      {
        id: s.groupId ?? `grp-${s.name}`,
        memberOperator: 'AND',
        criteria: [
          { id: `crit-${s.name}`, table: 'EVENTS', displayName: 'Clinical Codes', negation: false, valueSets: [vs], columnFilters: [], restrictions: [], linkedCriteria: [] },
        ],
        populationCriteria: [],
        actionIfTrue: 'SELECT',
        actionIfFalse: 'REJECT',
      },
    ],
  };
}

const doc = (root: string, specs: Spec[]): EmisXmlDocument => ({
  namespace: 'http://www.e-mis.com/emisopen',
  parsedAt: '2026-01-01T00:00:00.000Z',
  reports: specs.map((s) => report(s, root)),
});

const run = (a: Spec[], b: Spec[], scope?: DiffScopeInput) =>
  diffXmlDocuments({ doc: doc('SET R5', a), fileName: 'r5.xml' }, { doc: doc('SET R6', b), fileName: 'r6.xml' }, { scope, generatedAt: 'fixed' });

test('rotated GUIDs and root folder rename are not reported as changes', () => {
  const r = run(
    [{ guid: 'a1', folder: 'Registers', name: 'Asthma Register' }],
    [{ guid: 'b1', folder: 'Registers', name: 'Asthma Register' }]
  );
  assert.equal(r.summary.unchanged, 1);
  assert.equal(r.entries.length, 0);
  assert.equal(r.base.label, 'SET R5');
  assert.equal(r.target.label, 'SET R6');
});

test('code list changes are reported with a guide patch', () => {
  const r = run(
    [{ guid: 'a1', folder: 'Registers', name: 'Asthma Register', codes: ['1001', '1002'] }],
    [{ guid: 'b1', folder: 'Registers', name: 'Asthma Register', codes: ['1001', '1003'] }]
  );
  const [e] = r.entries;
  assert.equal(e.status, 'modified');
  assert.deepEqual(e.codesAdded.map((c) => c.code), ['1003']);
  assert.deepEqual(e.codesRemoved.map((c) => c.code), ['1002']);
  assert.ok(e.guidePatch?.includes('@@'));
});

test('identical search in a new folder is matched by content as moved', () => {
  const r = run(
    [{ guid: 'a1', folder: 'Old', name: 'HF Register' }],
    [{ guid: 'b1', folder: 'New', name: 'HF Register', groupId: 'other' }]
  );
  const [e] = r.entries;
  assert.equal(e.status, 'moved');
  assert.equal(e.matchedBy, 'content');
  assert.deepEqual(r.folderMoves, [{ from: 'Old', to: 'New', searches: 1 }]);
});

test('versioned replacement is paired by bracketed search ID across a year-renamed folder', () => {
  const r = run(
    [{ guid: 'a1', folder: '4) 2025-26 Outcome', name: '[ICS_HTN_21 v3 FYYTD] Since Apr 25 good control', codes: ['1'], groupId: 'g1' }],
    [{ guid: 'b1', folder: '4) 2026-27 Outcome', name: '[ICS_HTN_21 v4_NICE FYYTD] % of people with good control', codes: ['2'], groupId: 'g2' }]
  );
  const [e] = r.entries;
  assert.equal(e.status, 'modified');
  assert.equal(e.matchedBy, 'similar-name');
  assert.ok(e.moved && e.renamed);
});

test('duplicate folder + name searches pair by parent, not position', () => {
  const r = run(
    [
      { guid: 'pa', folder: 'MoC', name: 'Group 1' },
      { guid: 'pb', folder: 'MoC', name: 'Group 2' },
      { guid: 'c1', folder: 'MoC', name: 'Follow up', parent: 'pa' },
      { guid: 'c2', folder: 'MoC', name: 'Follow up', parent: 'pb' },
    ],
    [
      { guid: 'qb', folder: 'MoC', name: 'Group 2' },
      { guid: 'qa', folder: 'MoC', name: 'Group 1' },
      { guid: 'd2', folder: 'MoC', name: 'Follow up', parent: 'qb' },
      { guid: 'd1', folder: 'MoC', name: 'Follow up', parent: 'qa' },
    ]
  );
  assert.equal(r.summary.unchanged, 4);
  assert.equal(r.entries.length, 0);
});

test('parent change is detected through the match map', () => {
  const r = run(
    [
      { guid: 'pa', folder: 'F', name: 'Parent A' },
      { guid: 'pb', folder: 'F', name: 'Parent B' },
      { guid: 'c', folder: 'F', name: 'Child', parent: 'pa' },
    ],
    [
      { guid: 'qa', folder: 'F', name: 'Parent A' },
      { guid: 'qb', folder: 'F', name: 'Parent B' },
      { guid: 'd', folder: 'F', name: 'Child', parent: 'qb' },
    ]
  );
  const [e] = r.entries;
  assert.equal(e.status, 'modified');
  assert.deepEqual(e.fieldChanges.find((f) => f.field === 'parent'), { field: 'parent', from: 'F :: Parent A', to: 'F :: Parent B' });
});

test('unmatched searches are added or removed with their guides', () => {
  const r = run(
    [{ guid: 'a', folder: 'F', name: 'Old audit', codes: ['9'] }],
    [{ guid: 'b', folder: 'G', name: 'MASLD audit', codes: ['8'] }]
  );
  assert.equal(r.summary.added, 1);
  assert.equal(r.summary.removed, 1);
  assert.ok(r.entries.every((e) => e.guide && e.guide.length > 0));
});

test('scope marks direct searches with tags and their parents as ancestors', () => {
  const scope = parseDiffScope({ searches: [{ folder: 'F', name: 'Child', models: ['int_model_a'] }] }, 'dbt');
  const r = run(
    [
      { guid: 'p', folder: 'F', name: 'Register' },
      { guid: 'c', folder: 'F', name: 'Child', parent: 'p', codes: ['1'] },
      { guid: 'x', folder: 'F', name: 'Unrelated' },
    ],
    [
      { guid: 'q', folder: 'F', name: 'Register' },
      { guid: 'd', folder: 'F', name: 'Child', parent: 'q', codes: ['2'] },
      { guid: 'y', folder: 'F', name: 'Unrelated' },
    ],
    scope
  );
  const child = r.entries.find((e) => e.target?.name === 'Child')!;
  const parent = r.entries.find((e) => e.target?.name === 'Register')!;
  assert.equal(child.scope, 'direct');
  assert.deepEqual(child.scopeTags, ['int_model_a']);
  assert.equal(parent.scope, 'ancestor');
  assert.equal(parent.status, 'unchanged'); // unchanged in-scope entries are kept
  assert.ok(!r.entries.some((e) => e.target?.name === 'Unrelated'));
  assert.deepEqual(r.scope, { label: 'dbt', searches: 1, matched: 1, ancestors: 1 });

  const md = renderXmlDiffMarkdown(r, { scopeOnly: true });
  assert.match(md, /## Impact by dbt tag/);
  assert.match(md, /`int_model_a` \| Child \(modified\)/);
  assert.match(md, /```diff/);
});

test('parseDiffScope accepts a plain array and rejects other shapes', () => {
  assert.equal(parseDiffScope([{ folder: 'F', name: 'A' }]).searches.length, 1);
  assert.throws(() => parseDiffScope({ rows: [] }));
});
