/**
 * Turns a unified guide patch into rows for display: removed/added line pairs become one
 * edited line with word-level changes, and edits repeated across lines are summarised.
 */
import { diffArrays } from 'diff';

export type PatchPart = { text: string; op: 'eq' | 'add' | 'del' };
export type PatchRow =
  | { kind: 'context' | 'add' | 'del'; text: string }
  | { kind: 'change'; parts: PatchPart[]; from: string; to: string };
export interface PatchHunk {
  /** Guide section the hunk sits in, e.g. "Rule 2 of 4 — Exclusion · Criterion B" */
  section: string;
  rows: PatchRow[];
  /** Other sections with exactly the same change (filled by mergeRepeatedHunks) */
  alsoIn?: string[];
}

/** Minimum share of unchanged words (Dice) for a removed/added pair to show as one edited line */
const PAIR_SIMILARITY = 0.5;
/** Replacements longer than this (characters, either side) are left out of the summary */
const MAX_EDIT_LENGTH = 60;
/** Pure insertions or deletions longer than this are left out; they read as new text, not an edit */
const MAX_INSERT_LENGTH = 24;
const LIST_NAME = /^[a-z0-9_]+_vs\d+$/;

// Words, with punctuation split off so "c7." vs "c7;" marks the full stop, not the whole GUID.
// Used to pair lines and summarise edits.
const tokenize = (s: string) => s.split(/(\s+|[.,;:()`])/).filter(Boolean);
// Display tokens: letters, digits and punctuation apart, so "APR25" → "APR26" marks only the digits
const fineTokens = (s: string) => s.match(/[A-Za-z]+|\d+|\s+|[<>=!]+|[^A-Za-z\d\s]/g) ?? [];
const isWord = (s: string) => /[\p{L}\p{N}]/u.test(s);
/** Space or up to 3 punctuation characters between two edits, e.g. the "-" in "2025-26" */
const isJoiner = (s: string) => !isWord(s) && s.trim().length <= 3;

/**
 * Word-level diff; short separators between two edits are folded into them.
 * `fine` splits letters from digits for display, and falls back to a whole replacement when the
 * two texts share less than half their words.
 */
export function diffLineWords(a: string, b: string, fine = false): { parts: PatchPart[]; similarity: number } {
  const split = fine ? fineTokens : tokenize;
  const changes = diffArrays(split(a), split(b));
  let same = 0;
  let total = 0;
  const raw: PatchPart[] = [];
  for (const c of changes) {
    const op = c.added ? 'add' : c.removed ? 'del' : 'eq';
    const words = c.value.filter(isWord).length;
    total += op === 'eq' ? words * 2 : words;
    if (op === 'eq') same += words * 2;
    raw.push({ text: c.value.join(''), op });
  }

  const parts: PatchPart[] = [];
  let del = '';
  let add = '';
  const flush = () => {
    if (del) parts.push({ text: del, op: 'del' });
    if (add) parts.push({ text: add, op: 'add' });
    del = add = '';
  };
  raw.forEach((p, i) => {
    if (p.op === 'del') del += p.text;
    else if (p.op === 'add') add += p.text;
    else if ((del || add) && isJoiner(p.text) && raw[i + 1] && raw[i + 1].op !== 'eq') {
      del += p.text;
      add += p.text;
    } else {
      flush();
      parts.push(p);
    }
  });
  flush();
  const similarity = total ? same / total : 1;
  if (fine && similarity < PAIR_SIMILARITY && a !== b) {
    return { parts: [{ text: a, op: 'del' }, { text: b, op: 'add' }].filter((p) => p.text) as PatchPart[], similarity };
  }
  return { parts, similarity };
}

export function parseGuidePatch(patch: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  let cur: PatchHunk | null = null;
  let dels: string[] = [];
  let adds: string[] = [];

  const flushRun = () => {
    if (!cur) return;
    // Pair each removed line with the next similar added line, keeping order
    let j = 0;
    for (const d of dels) {
      let k = j;
      let diff: ReturnType<typeof diffLineWords> | null = null;
      for (; k < adds.length; k++) {
        const candidate = diffLineWords(d, adds[k]);
        if (candidate.similarity >= PAIR_SIMILARITY) {
          diff = candidate;
          break;
        }
      }
      if (!diff) {
        cur.rows.push({ kind: 'del', text: d });
        continue;
      }
      for (; j < k; j++) cur.rows.push({ kind: 'add', text: adds[j] });
      cur.rows.push({ kind: 'change', parts: diffLineWords(d, adds[k], true).parts, from: d, to: adds[k] });
      j = k + 1;
    }
    for (; j < adds.length; j++) cur.rows.push({ kind: 'add', text: adds[j] });
    dels = [];
    adds = [];
  };

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      flushRun();
      cur = { section: line.replace(/^@@[^@]*@@\s?/, ''), rows: [] };
      hunks.push(cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith('-')) {
      if (adds.length) flushRun();
      dels.push(line.slice(1));
    } else if (line.startsWith('+')) {
      adds.push(line.slice(1));
    } else {
      flushRun();
      cur.rows.push({ kind: 'context', text: line.slice(1) });
    }
  }
  flushRun();
  return hunks;
}

/** Folds hunks identical to an earlier one into it, e.g. the same threshold edit in Rules 1 and 3 */
export function mergeRepeatedHunks(hunks: PatchHunk[]): PatchHunk[] {
  const seen = new Map<string, PatchHunk>();
  const out: PatchHunk[] = [];
  for (const h of hunks) {
    const key = JSON.stringify(h.rows);
    const first = seen.get(key);
    if (first) {
      (first.alsoIn ??= []).push(h.section);
      continue;
    }
    const copy = { ...h };
    seen.set(key, copy);
    out.push(copy);
  }
  return out;
}

export interface RepeatedEdit {
  from: string;
  to: string;
  /** Lines the edit appears on */
  lines: number;
}

export interface PatchSummary {
  /** Short word edits, most frequent first */
  edits: RepeatedEdit[];
  /** Lines edited in place */
  changed: number;
  added: number;
  removed: number;
  /** Distinct sections touched, in order */
  sections: string[];
}

// Punctuation and Markdown around a word, e.g. the trailing comma or backtick in "01/04/2025`,"
const trimEdit = (s: string) => s.trim().replace(/^[`*'"(,;:]+|[`*'",;:.)]+$/g, '');

export function summarizeGuidePatch(patch: string): PatchSummary {
  const hunks = parseGuidePatch(patch);
  const edits = new Map<string, RepeatedEdit>();
  const out: PatchSummary = { edits: [], changed: 0, added: 0, removed: 0, sections: [] };
  for (const h of hunks) {
    if (h.section && !out.sections.includes(h.section)) out.sections.push(h.section);
    for (const row of h.rows) {
      if (row.kind === 'add') out.added++;
      else if (row.kind === 'del') out.removed++;
      if (row.kind !== 'change') continue;
      out.changed++;
      const seen = new Set<string>();
      // Whole words, so the summary reads "01/04/2025 → 01/04/2026" rather than "2025 → 2026"
      const parts = diffLineWords(row.from, row.to).parts;
      parts.forEach((p, i) => {
        if (p.op === 'eq' || (p.op === 'add' && parts[i - 1]?.op === 'del')) return;
        const from = p.op === 'del' ? trimEdit(p.text) : '';
        const to = p.op === 'del' ? (parts[i + 1]?.op === 'add' ? trimEdit(parts[i + 1].text) : '') : trimEdit(p.text);
        if ((!from && !to) || from === to || from.length > MAX_EDIT_LENGTH || to.length > MAX_EDIT_LENGTH) return;
        if ((!from || !to) && (from || to).length > MAX_INSERT_LENGTH) return;
        // Code list names (name_vsN) change with their list, which the cluster edit and code list changes already show
        if (LIST_NAME.test(from) && LIST_NAME.test(to)) return;
        const key = `${from}\u0000${to}`;
        if (seen.has(key)) return;
        seen.add(key);
        const e = edits.get(key) ?? { from, to, lines: 0 };
        e.lines++;
        edits.set(key, e);
      });
    }
  }
  out.edits = [...edits.values()].sort((a, b) => b.lines - a.lines || a.from.localeCompare(b.from));
  return out;
}
