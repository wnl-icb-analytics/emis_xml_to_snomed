'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Microscope } from 'lucide-react';
import { codeListDetails, type CodeListDetail, type CodeRef, type SearchDiffEntry } from '@/lib/xml-diff';
import type { EmisValueSet } from '@/lib/types';
import { expandValueSet } from '@/lib/valueset-expansion';
import { useSettings } from '@/contexts/SettingsContext';
import { DIFF, ListStatusBadge, plural } from '@/components/compare/status';
import { cn } from '@/lib/utils';

/** Codes shown before "Show all" */
const CODE_PREVIEW = 50;

/** Identifies a code list within one search (names are shared by lists with identical codes) */
export const listKey = (name: string, cluster: string | null) => `${name}\u0000${cluster ?? ''}`;

type ChildrenChange = SearchDiffEntry['codesChildrenChanged'][number];
type Sign = '+' | '−' | '~' | '';

function CodeRow({ sign, c, note }: { sign: Sign; c: Pick<CodeRef, 'code' | 'displayName'> & Partial<CodeRef>; note?: string }) {
  const tint = sign === '+' ? DIFF.addRow : sign === '−' ? DIFF.delRow : sign === '~' ? DIFF.editRow : 'bg-card';
  return (
    <div className={cn('grid grid-cols-[1rem_11rem_1fr_auto] gap-2 px-3 py-1 text-xs', tint)}>
      <span className={cn('font-mono', sign === '+' ? 'text-emerald-600' : sign === '−' ? 'text-red-600' : 'text-amber-600')}>{sign}</span>
      <code className="truncate font-mono">{c.code}</code>
      <span className={cn('min-w-0 truncate', !c.displayName && 'italic text-muted-foreground')} title={c.displayName}>
        {c.displayName || (c.isRefset ? 'Refset (no name in export)' : 'No display name')}
      </span>
      <span className="flex gap-1 text-[10px] text-muted-foreground">
        {note && <span>{note}</span>}
        {c.isRefset && <span className="rounded border bg-card px-1">refset</span>}
        {c.excluded && <span className="rounded border bg-card px-1">exception</span>}
        {c.includeChildren && !c.excluded && !note && <span className="rounded border bg-card px-1">+ children</span>}
      </span>
    </div>
  );
}

/**
 * The codes behind one code list change: added (+), removed (−) and include-children flips (~).
 * `plain` lists a whole new or removed search's codes without change marks.
 */
export function CodeTable({ list: l, plain = false, childrenChanged = [] }: { list: CodeListDetail; plain?: boolean; childrenChanged?: ChildrenChange[] }) {
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    const sign = (s: Sign): Sign => (plain ? '' : s);
    return [
      ...l.codesAdded.map((c) => ({ sign: sign('+'), c })),
      ...l.codesRemoved.map((c) => ({ sign: sign('−'), c })),
      ...childrenChanged.map((c) => ({
        sign: '~' as const,
        c,
        note: `${c.from ? 'with children' : 'code only'} → ${c.to ? 'with children' : 'code only'}`,
      })),
    ];
  }, [l, plain, childrenChanged]);
  const shown = all ? rows : rows.slice(0, CODE_PREVIEW);
  return (
    <div className="max-h-80 divide-y divide-border/50 overflow-y-auto rounded border">
      {shown.map((r) => (
        <CodeRow key={`${r.sign}${'excluded' in r.c && r.c.excluded ? 'x' : ''}${r.c.code}`} sign={r.sign} c={r.c} note={'note' in r ? r.note : undefined} />
      ))}
      {rows.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="w-full bg-card px-3 py-1.5 text-left text-xs text-primary hover:bg-muted">
          Show all {rows.length.toLocaleString()}
        </button>
      )}
    </div>
  );
}

interface Concept {
  code: string;
  display: string;
}

interface ConceptComparison {
  before: number;
  after: number;
  gained: Concept[];
  lost: Concept[];
  /** Codes on either side the server could not translate or expand */
  failed: number;
}

/** One version of a list as a ValueSet the terminology expansion understands */
function asValueSet(id: string, cluster: string | null, codes: CodeRef[]): EmisValueSet {
  return {
    id,
    codeSystem: codes[0]?.codeSystem,
    description: cluster ?? undefined,
    values: codes.filter((c) => !c.excluded).map((c) => ({ code: c.code, displayName: c.displayName, includeChildren: c.includeChildren, isRefset: c.isRefset })),
    exceptions: codes.filter((c) => c.excluded).map((c) => ({ code: c.code, displayName: c.displayName })),
  };
}

// Expansions are slow; keep them for the session
const comparisons = new Map<string, Promise<ConceptComparison>>();

async function expandSide(name: string, vs: EmisValueSet, filter: ReturnType<typeof useSettings>['equivalenceFilter']) {
  if (!vs.values.length) return { concepts: new Map<string, string>(), failed: 0 };
  const data = await expandValueSet(`compare-${vs.id}`, name, vs, 0, filter);
  const group = data.data?.valueSetGroups?.[0];
  if (group?.expansionError) throw new Error(group.expansionError);
  const concepts = new Map<string, string>();
  for (const c of group?.concepts ?? []) if (!c.isRefset) concepts.set(c.code, c.display);
  return { concepts, failed: (group?.failedCodes?.length ?? 0) + (group?.dmdCodes?.length ?? 0) };
}

/** Everything that changes an expansion, so distinct inputs never share a cached result */
const sideKey = (codes: CodeRef[]) =>
  codes.map((c) => [c.codeSystem, c.code, c.excluded ? 'x' : '', c.includeChildren ? 'c' : '', c.isRefset ? 'r' : ''].join(':')).join(',');

function compareConcepts(l: CodeListDetail, filter: ReturnType<typeof useSettings>['equivalenceFilter']): Promise<ConceptComparison> {
  // Kept codes hold the newer flags; the older side expands with the include-children value it had
  const baseChildren = new Map(l.childrenChanged.map((c) => [c.code, c.from]));
  const kept = l.codesKept.map((c) => (!c.excluded && baseChildren.has(c.code) ? { ...c, includeChildren: baseChildren.get(c.code)! } : c));
  const before = [...l.codesRemoved, ...kept];
  const after = [...l.codesAdded, ...l.codesKept];
  // Keyed by content, so the same list in another search reuses the expansion
  const key = [filter, sideKey(before), sideKey(after)].join('\u0000');
  let p = comparisons.get(key);
  if (!p) {
    p = Promise.all([
      expandSide(l.name, asValueSet(`${l.name}-before`, l.previousCluster !== undefined ? l.previousCluster : l.cluster, before), filter),
      expandSide(l.name, asValueSet(`${l.name}-after`, l.cluster, after), filter),
    ]).then(([b, a]) => ({
      before: b.concepts.size,
      after: a.concepts.size,
      gained: [...a.concepts].filter(([c]) => !b.concepts.has(c)).map(([code, display]) => ({ code, display })),
      lost: [...b.concepts].filter(([c]) => !a.concepts.has(c)).map(([code, display]) => ({ code, display })),
      failed: b.failed + a.failed,
    }));
    p.catch(() => comparisons.delete(key));
    comparisons.set(key, p);
  }
  return p;
}

function ConceptList({ sign, concepts }: { sign: '+' | '−'; concepts: Concept[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? concepts : concepts.slice(0, CODE_PREVIEW);
  return (
    <div className="max-h-72 divide-y divide-border/50 overflow-y-auto rounded border">
      {shown.map((c) => (
        <CodeRow key={c.code} sign={sign} c={{ code: c.code, displayName: c.display }} />
      ))}
      {concepts.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="w-full bg-card px-3 py-1.5 text-left text-xs text-primary hover:bg-muted">
          Show all {concepts.length.toLocaleString()}
        </button>
      )}
    </div>
  );
}

/**
 * Expands both versions of a changed list on the terminology server (children, refset members,
 * EMIS code translation) and shows which SNOMED concepts the change adds and drops.
 */
export function ConceptCompare({ list }: { list: CodeListDetail }) {
  const { equivalenceFilter } = useSettings();
  type State = { status: 'idle' | 'loading' | 'done' | 'error'; filter?: typeof equivalenceFilter; result?: ConceptComparison; error?: string };
  const [raw, setState] = useState<State>({ status: 'idle' });
  const [open, setOpen] = useState<'gained' | 'lost' | null>(null);
  if (list.status !== 'changed') return null;
  if (list.keptOmitted) {
    return <span className="text-xs text-muted-foreground">Concept comparison unavailable: retained codes were left out to keep this comparison under the response size limit.</span>;
  }
  // A result for another equivalence filter is stale
  const state: State = raw.filter === equivalenceFilter ? raw : { status: 'idle' };
  const run = () => {
    const filter = equivalenceFilter;
    setState({ status: 'loading', filter });
    compareConcepts(list, filter).then(
      (result) => setState((s) => (s.filter === filter ? { status: 'done', filter, result } : s)),
      (e) => setState((s) => (s.filter === filter ? { status: 'error', filter, error: e instanceof Error ? e.message : String(e) } : s))
    );
  };
  if (state.status === 'idle') {
    return (
      <button type="button" onClick={run} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" title="Expand both versions on the terminology server">
        <Microscope className="h-3.5 w-3.5" />
        Compare expanded concepts (wider or narrower?)
      </button>
    );
  }
  if (state.status === 'loading') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Expanding both versions on the terminology server; large lists take a minute or two…
      </span>
    );
  }
  if (state.status === 'error') {
    return (
      <span className="text-xs text-red-700">
        Could not expand: {state.error}{' '}
        <button type="button" onClick={run} className="text-primary hover:underline">
          Retry
        </button>
      </span>
    );
  }
  const r = state.result!;
  const verdict = r.gained.length && r.lost.length ? 'wider and narrower' : r.gained.length ? 'wider' : r.lost.length ? 'narrower' : 'the same concepts';
  // Codes the server could not expand are missing from one side, so counts are a lower bound
  const partial = r.failed > 0;
  return (
    <div className="space-y-1.5 rounded-md border bg-slate-50 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">
          {partial ? 'Partial expansion' : 'Expanded'}: {verdict}
        </span>
        <span>
          {r.before.toLocaleString()} ⇒ {r.after.toLocaleString()} concepts
        </span>
        <button type="button" disabled={!r.gained.length} onClick={() => setOpen(open === 'gained' ? null : 'gained')} className={cn(DIFF.addText, 'font-semibold disabled:opacity-60')}>
          +{r.gained.length.toLocaleString()} gained
        </button>
        <button type="button" disabled={!r.lost.length} onClick={() => setOpen(open === 'lost' ? null : 'lost')} className={cn('rounded-sm bg-red-100 px-0.5 font-semibold text-red-800 disabled:opacity-60')}>
          −{r.lost.length.toLocaleString()} lost
        </button>
        {partial && <span className="text-amber-700">{plural(r.failed, 'code')} could not be expanded, so counts are approximate</span>}
      </div>
      {open === 'gained' && <ConceptList sign="+" concepts={r.gained} />}
      {open === 'lost' && <ConceptList sign="−" concepts={r.lost} />}
    </div>
  );
}

/** "+1 / −521", the counts behind a list's Show codes toggle */
export const codeCounts = (l: CodeListDetail, children = 0) =>
  [l.codesAdded.length && `+${l.codesAdded.length}`, l.codesRemoved.length && `−${l.codesRemoved.length}`, children && `~${children}`].filter(Boolean).join(' / ');

/** A lone refset is fully described by its summary */
export const hasCodesToShow = (l: CodeListDetail, children = 0) => {
  const n = l.codesAdded.length + l.codesRemoved.length;
  return children > 0 || n > 1 || (n === 1 && !(l.codesAdded[0] ?? l.codesRemoved[0]).isRefset);
};

function CodeListRow({ list: l, childrenChanged }: { list: CodeListDetail; childrenChanged: ChildrenChange[] }) {
  const [open, setOpen] = useState(false);
  const counts = l.status === 'changed' ? `${l.from.toLocaleString()} → ${l.to.toLocaleString()}` : (l.status === 'added' ? l.to : l.from).toLocaleString();
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5">
        <ListStatusBadge status={l.status} />
        <span className="font-mono text-sm font-semibold">{l.cluster ?? 'No cluster ID'}</span>
        <span className="font-mono text-[11px] text-muted-foreground" title="valueset_friendly_name in the extraction CSVs">
          {l.name}
          {l.previousName && ` (was ${l.previousName})`}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {l.codeSystem} · {counts} {l.status === 'changed' || (l.status === 'added' ? l.to : l.from) !== 1 ? 'codes' : 'code'}
        </span>
        <p className="basis-full text-sm text-foreground/90">{l.summary}</p>
        {hasCodesToShow(l, childrenChanged.length) && (
          <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {open ? 'Hide codes' : 'Show codes'}
            <span className="text-muted-foreground">{codeCounts(l, childrenChanged.length)}</span>
          </button>
        )}
      </div>
      {open && (
        <div className="px-3 pb-3">
          <CodeTable list={l} childrenChanged={childrenChanged} />
        </div>
      )}
      {l.status === 'changed' && (
        <div className="px-3 pb-2.5">
          <ConceptCompare list={l} />
        </div>
      )}
    </div>
  );
}

/** Code list changes as cards; `exclude` skips lists already shown inline in the rules */
export function CodeListChanges({ entry, exclude }: { entry: SearchDiffEntry; exclude?: Set<string> }) {
  const lists = useMemo(() => codeListDetails(entry).filter((l) => !exclude?.has(listKey(l.name, l.cluster))), [entry, exclude]);
  return (
    <div className="space-y-2">
      {lists.map((l) => (
        <CodeListRow key={`${l.status}${l.name}${l.cluster}`} list={l} childrenChanged={l.childrenChanged} />
      ))}
    </div>
  );
}
