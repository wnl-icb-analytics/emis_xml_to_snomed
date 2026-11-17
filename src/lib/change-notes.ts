/**
 * Plain-English notes for common rule edits (a boundary made strict, a window widened, a rule's
 * action changed) and detection of routine year rollovers, from the before and after text of a change.
 */

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const pad2 = (n: number) => String(n % 100).padStart(2, '0');
const YEAR = '(?:19|20)\\d\\d';
// Years only where text marks them as years, so a threshold such as ">= 2000" is not one
const YEARS = [
  `(?<!\\d)(?<fy>${YEAR})(?<sep>[-/])(?<fyy>\\d\\d)(?![\\d/-])`, // 2025-26, 2025/26
  `(?<=\\d{1,2}/\\d{1,2}/)(?<dy>${YEAR})(?!\\d)`, // 01/04/2025
  `(?<label>(?:${MONTHS}|FY)[\\s-]?)(?<ly>(?:19|20)?\\d\\d)(?!\\d)`, // APR25, April 2025, FY25
];
const DATED = new RegExp(YEARS.join('|'), 'gi');
// Names and folders label releases with a bare year: "QOF 2025"
const LABELLED = new RegExp([...YEARS, `(?<![\\d.])(?<y>${YEAR})(?![\\d.])`].join('|'), 'gi');

type YearGroups = Partial<Record<'fy' | 'sep' | 'fyy' | 'dy' | 'label' | 'ly' | 'y', string>>;

/** The text with every year moved on by one: 01/04/2025 → 01/04/2026, 2025-26 → 2026-27, Apr25 → Apr26; `bare` also moves lone years */
export function rollYear(s: string, bare = false): string {
  return s.replace(bare ? LABELLED : DATED, (...args) => {
    const g = args[args.length - 1] as YearGroups;
    if (g.fy) return `${+g.fy + 1}${g.sep}${pad2(+g.fyy! + 1)}`;
    if (g.dy) return `${+g.dy + 1}`;
    if (g.label) return `${g.label}${g.ly!.length === 4 ? +g.ly! + 1 : pad2(+g.ly! + 1)}`;
    return `${+g.y! + 1}`;
  });
}

/** True when the only difference is every year moving on by one, as in an annual release; `bare` for names and folders */
export const isRollover = (before: string, after: string, bare = false) => before !== after && rollYear(before, bare) === after;

const COMPARISON = /(<=|>=|<|>|=)\s*(-?\d+(?:\.\d+)?)/g;
const comparisons = (s: string) => [...s.matchAll(COMPARISON)].map((m) => ({ op: m[1], n: m[2] }));

const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
const WINDOW = /(strictly after|on or after|after|strictly before|on or before|before)\s+(\d+)\s+(day|week|month|year)s?\s+before the search date/i;
const DATE = /(\d{2})\/(\d{2})\/(\d{4})/;

function boundaryNote(before: string, after: string, general: boolean): string | undefined {
  const b = comparisons(before);
  const a = comparisons(after);
  if (!b.length || b.length !== a.length) return undefined;
  for (let i = 0; i < b.length; i++) {
    const [x, y] = [b[i], a[i]];
    if (x.op === y.op && x.n === y.n) continue;
    const at = general ? 'a value exactly on the threshold' : `exactly ${y.n}`;
    if (x.n === y.n) {
      const strict = (op: string) => op === '<' || op === '>';
      if (strict(y.op) && !strict(x.op) && y.op[0] === x.op[0]) return `Boundary now exclusive: ${at} no longer counts`;
      if (!strict(y.op) && strict(x.op) && y.op[0] === x.op[0]) return `Boundary now inclusive: ${at} now counts`;
      return `Comparison changed from ${x.op} to ${y.op}`;
    }
    if (x.op === y.op) return general ? 'Thresholds changed' : `Threshold ${+y.n > +x.n ? 'raised' : 'lowered'} from ${x.n} to ${y.n}`;
  }
  return undefined;
}

function windowNote(before: string, after: string): string | undefined {
  const b = before.match(WINDOW);
  const a = after.match(WINDOW);
  // Flipping after ⇄ before is a different window, not a wider or narrower one
  if (!b || !a || /after/i.test(a[1]) !== /after/i.test(b[1])) return undefined;
  const days = (m: RegExpMatchArray) => +m[2] * UNIT_DAYS[m[3].toLowerCase()];
  if (days(b) !== days(a)) {
    // "after N months before" spans the last N months, so a larger N widens it; "before N months before" spans everything older, so it narrows
    const since = /after/i.test(a[1]);
    return `Look-back ${days(a) > days(b) === since ? 'widened' : 'narrowed'} from ${b[2]} ${b[3]}${+b[2] === 1 ? '' : 's'} to ${a[2]} ${a[3]}${+a[2] === 1 ? '' : 's'}`;
  }
  const inclusive = (r: string) => /on or/i.test(r);
  if (inclusive(a[1]) && !inclusive(b[1])) return 'Window now includes its boundary day';
  if (!inclusive(a[1]) && inclusive(b[1])) return 'Window now excludes its boundary day';
  return undefined;
}

function dateNote(before: string, after: string): string | undefined {
  const b = before.match(DATE);
  const a = after.match(DATE);
  if (!b || !a || b[0] === a[0]) return undefined;
  if (isRollover(b[0], a[0])) return 'Moved on a year';
  const t = (m: RegExpMatchArray) => Date.UTC(+m[3], +m[2] - 1, +m[1]);
  const days = Math.round((t(a) - t(b)) / 86_400_000);
  return `Date moved ${days > 0 ? 'later' : 'earlier'} by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
}

function recordNote(before: string, after: string): string | undefined {
  const pick = (s: string) => s.match(/Keep the (latest|earliest|highest|lowest) (\d+)/i);
  const b = pick(before);
  const a = pick(after);
  if (!b || !a) return undefined;
  if (b[1].toLowerCase() !== a[1].toLowerCase()) return `Now uses the ${a[1].toLowerCase()} record instead of the ${b[1].toLowerCase()}`;
  if (b[2] !== a[2]) return `Now keeps ${a[2]} records instead of ${b[2]}`;
  return undefined;
}

function codeListNote(before: string, after: string): string | undefined {
  const pick = (s: string) => s.match(/^(?:.*?\bcode) in ([A-Z0-9_]+_COD)\b/i);
  const b = pick(before);
  const a = pick(after);
  return b && a && b[1] !== a[1] ? `Now uses ${a[1]} instead of ${b[1]}` : undefined;
}

/**
 * A plain-English note for an edited line, or undefined when no known pattern fits.
 * `general` words it for a group of lines that share the edit but differ in their values.
 */
export function explainEdit(before: string, after: string, general = false): string | undefined {
  return dateNote(before, after) ?? boundaryNote(before, after, general) ?? windowNote(before, after) ?? recordNote(before, after) ?? codeListNote(before, after);
}

const OUTCOME: Record<string, string> = { SELECT: 'are included', REJECT: 'are excluded', NEXT: 'go on to the next rule' };

/** "Patients who don't match now go on to the next rule (previously they were included)" */
export function explainAction(which: 'pass' | 'fail', from: string, to: string): string {
  const who = which === 'pass' ? 'match' : "don't match";
  return `Patients who ${who} now ${OUTCOME[to] ?? to} (previously they ${(OUTCOME[from] ?? from).replace(/^are /, 'were ').replace(/^go /, 'went ')})`;
}

export const explainOperator = (from: string, to: string) =>
  to === 'OR' && from === 'AND' ? 'Now matches if any criterion is met (previously all had to be)' : to === 'AND' && from === 'OR' ? 'Now every criterion must be met (previously any one was enough)' : undefined;

export const explainNegation = (now: boolean) =>
  now ? 'Now excludes patients who have a matching record' : "No longer a 'must not exist' check: patients now need a matching record";
