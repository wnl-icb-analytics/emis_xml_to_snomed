import assert from 'node:assert/strict';
import test from 'node:test';
import { diffLineWords, mergeRepeatedHunks, parseGuidePatch, summarizeGuidePatch } from './patch-view';

const patch = [
  '@@ -1,4 +1,4 @@ Rule 1 of 2 — Exclusion · Criterion B',
  ' - **Criterion B — Clinical Codes**',
  '-  - AND date on or after 01/04/2025, `date >= 01/04/2025`',
  '+  - AND date on or after 01/04/2026, `date >= 01/04/2026`',
  '-  - Keep the latest 1 by date, then test the kept record: numeric value >= 1 AND <= 90',
  '+  - Keep the latest 1 by date, then test the kept record: numeric value >= 1 AND < 90',
  '@@ -9,2 +9,3 @@ Rule 2 of 2 — Exclusion',
  '-  - Where date strictly after 01/04/2025',
  '+  - Where date strictly after 01/04/2026',
  '+- **Criterion C — Medication Issues**',
].join('\n');

test('similar removed/added lines become one edited line with word-level parts', () => {
  const [first, second] = parseGuidePatch(patch);
  assert.equal(first.section, 'Rule 1 of 2 — Exclusion · Criterion B');
  assert.deepEqual(first.rows.map((r) => r.kind), ['context', 'change', 'change']);
  const change = first.rows[1];
  assert.ok(change.kind === 'change');
  assert.deepEqual(
    change.parts.filter((p) => p.op !== 'eq').map((p) => [p.op, p.text]),
    [['del', '2025'], ['add', '2026'], ['del', '2025'], ['add', '2026']]
  );
  assert.deepEqual(second.rows.map((r) => r.kind), ['change', 'add']);
});

test('unrelated lines stay as separate removals and additions', () => {
  const { similarity } = diffLineWords('- **Criterion A — Clinical Codes**', '  - Keep the earliest 1 by date');
  assert.ok(similarity < 0.5);
  const [h] = parseGuidePatch('@@ -1,1 +1,1 @@\n-- **Criterion A — Clinical Codes**\n+  - Keep the earliest 1 by date');
  assert.deepEqual(h.rows.map((r) => r.kind), ['del', 'add']);
});

test('punctuation is split from words so a changed full stop does not mark the whole word', () => {
  const { parts } = diffLineWords('library item ea06414e-6bec. Include', 'library item ea06414e-6bec; Include');
  assert.deepEqual(parts.filter((p) => p.op !== 'eq').map((p) => p.text), ['.', ';']);
});

test('identical hunks in different sections are merged', () => {
  const hunk = (section: string, n = 90) => [`@@ -1,1 +1,1 @@ ${section}`, `-  - AND <= ${n}`, `+  - AND < ${n}`].join('\n');
  const merged = mergeRepeatedHunks(parseGuidePatch([hunk('Rule 1 · Criterion C'), hunk('Rule 3 · Criterion C'), hunk('Rule 2 · Criterion C', 85)].join('\n')));
  assert.deepEqual(merged.map((h) => [h.section, h.alsoIn]), [
    ['Rule 1 · Criterion C', ['Rule 3 · Criterion C']],
    ['Rule 2 · Criterion C', undefined],
  ]);
});

test('summary counts each edit once per line and orders by frequency', () => {
  const s = summarizeGuidePatch(patch);
  assert.deepEqual(s.edits, [
    { from: '01/04/2025', to: '01/04/2026', lines: 2 },
    { from: '<=', to: '<', lines: 1 },
  ]);
  assert.equal(s.changed, 3);
  assert.equal(s.added, 1);
  assert.deepEqual(s.sections, ['Rule 1 of 2 — Exclusion · Criterion B', 'Rule 2 of 2 — Exclusion']);
});

test('display diffs mark only the edited digits or letters', () => {
  const edits = (a: string, b: string) =>
    diffLineWords(a, b, true)
      .parts.filter((p) => p.op !== 'eq')
      .map((p) => `${p.op}:${p.text}`);
  assert.deepEqual(edits('[rICS_HTN_21NOBPAPR25] NO record of BP Since Apr2025', '[rICS_HTN_21NOBPAPR26] NO record of BP Since Apr2026'), [
    'del:25',
    'add:26',
    'del:2025',
    'add:2026',
  ]);
  // The "-" between two edits joins them into one
  assert.deepEqual(edits('Call & Recall > [CR1] 2025-26 PCN Outcome', 'Call & Recall > [CR1] 2026-27 PCN Outcome'), ['del:2025-26', 'add:2026-27']);
  assert.deepEqual(edits('numeric value >= 1 AND <= 90', 'numeric value >= 1 AND < 90'), ['del:<=', 'add:<']);
  // Unrelated values are replaced whole rather than split into fragments
  assert.deepEqual(edits('Asthma register', 'Frailty audit'), ['del:Asthma register', 'add:Frailty audit']);
});
