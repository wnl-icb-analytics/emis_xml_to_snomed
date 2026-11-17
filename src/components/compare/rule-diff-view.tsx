'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, CornerDownRight, Filter, Link as LinkIcon, TriangleAlert, Users } from 'lucide-react';
import type { ListRef, NodeStatus, RuleDiff } from '@/lib/rule-diff';
import { changeStarts, outlineRule, type OutlineMode, type OutlineRow } from '@/lib/rule-outline';
import type { CodeListDetail } from '@/lib/xml-diff';
import { diffLineWords } from '@/lib/patch-view';
import { codeSystemLabel } from '@/lib/agent-report-utils';
import { useCompare } from '@/contexts/CompareContext';
import { actionBadgeClass, actionLabel, codeSystemBadgeClass } from '@/components/rule-display';
import { CodeTable, ConceptCompare, codeCounts, hasCodesToShow, listKey } from '@/components/compare/code-list-changes';
import { InlineDiff } from '@/components/compare/guide-patch-view';
import { DIFF, ListStatusBadge, plural } from '@/components/compare/status';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ListDetails {
  byKey: Map<string, CodeListDetail>;
}
const ListDetailsContext = createContext<ListDetails>({ byKey: new Map() });
/** Plain: a whole new or removed search, drawn without change marks */
const PlainContext = createContext(false);

const TABLE_BADGE = 'h-5 border-gray-200 bg-gray-100 px-1.5 text-[10px] text-gray-600';
const ROW: Record<NodeStatus, { tint: string; bar: string; symbol: string; sign: string }> = {
  unchanged: { tint: '', bar: 'bg-transparent', symbol: '', sign: '' },
  added: { tint: DIFF.addRow, bar: 'bg-emerald-500', symbol: 'text-emerald-600', sign: '+' },
  removed: { tint: DIFF.delRow, bar: 'bg-red-500', symbol: 'text-red-600', sign: '−' },
  changed: { tint: DIFF.editRow, bar: 'bg-amber-500', symbol: 'text-amber-600', sign: '~' },
};

/** Row text: edited characters marked, struck through when removed */
function RowText({ row, plain }: { row: OutlineRow; plain: boolean }) {
  if (!plain && row.from !== undefined) return <InlineDiff parts={diffLineWords(row.from, row.text, true).parts} />;
  return <span className={cn(!plain && row.status === 'removed' && 'line-through decoration-red-400')}>{row.text}</span>;
}

/** Inline code list button; opens the list's summary and codes under the row */
function ListButton({ list, open, onToggle }: { list: ListRef; open: boolean; onToggle: () => void }) {
  const plain = useContext(PlainContext);
  const { byKey } = useContext(ListDetailsContext);
  const detail = byKey.get(listKey(list.name, list.cluster));
  const flips = detail?.childrenChanged.length ?? 0;
  const canOpen = !!detail && (hasCodesToShow(detail, flips) || !plain);
  return (
    <button
      type="button"
      disabled={!canOpen}
      onClick={onToggle}
      title={list.name}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded border bg-card px-1.5 py-0.5 text-[11px] leading-4',
        canOpen && 'hover:border-foreground/30',
        open && 'border-amber-400 ring-1 ring-amber-300'
      )}
    >
      {canOpen && (open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />)}
      {/* Without a cluster ID the row text already names the codes */}
      {list.cluster && (
        <span className={cn('min-w-0 max-w-[28rem] truncate text-foreground/80', list.change === 'removed' && !plain && 'line-through')}>{list.preview}</span>
      )}
      <span className="shrink-0 text-muted-foreground">{plural(list.count, 'code')}</span>
      <Badge variant="outline" className={cn(codeSystemBadgeClass(list.codeSystem), 'h-4 shrink-0 px-1 text-[9px]')}>
        {codeSystemLabel(list.codeSystem)}
      </Badge>
      {canOpen && detail && <span className="shrink-0 text-primary">{plain ? 'show codes' : codeCounts(detail, flips) || 'codes'}</span>}
      {list.change && !plain && <ListStatusBadge status={list.change} className="h-4 px-1 text-[9px]" />}
    </button>
  );
}

function ListPanel({ list }: { list: ListRef }) {
  const plain = useContext(PlainContext);
  const { byKey } = useContext(ListDetailsContext);
  const detail = byKey.get(listKey(list.name, list.cluster));
  if (!detail) return null;
  const flips = detail.childrenChanged;
  return (
    <div className="space-y-1.5 rounded-md border bg-card p-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono font-semibold">{detail.cluster ?? 'No cluster ID'}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{detail.name}</span>
        {!plain && <span className="text-foreground">{detail.summary}</span>}
      </div>
      {hasCodesToShow(detail, flips.length) && <CodeTable list={detail} plain={plain} childrenChanged={flips} />}
      {!plain && <ConceptCompare list={detail} />}
    </div>
  );
}

const KIND_ICON: Partial<Record<OutlineRow['kind'], typeof Filter>> = {
  population: Users,
  library: TriangleAlert,
  relationship: LinkIcon,
  restriction: Filter,
};

function Row({ row, flash }: { row: OutlineRow; flash: boolean }) {
  const plain = useContext(PlainContext);
  const { byKey } = useContext(ListDetailsContext);
  const { focus } = useCompare();
  const focusedLists = (row.lists ?? []).filter((l) => {
    const d = byKey.get(listKey(l.name, l.cluster));
    return !!d && !!focus && d.cluster === focus.cluster && d.summary === focus.summary;
  });
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusedLists.map((l) => listKey(l.name, l.cluster))));
  const ref = useRef<HTMLDivElement>(null);
  const scrollToFocus = focusedLists.length > 0;
  useEffect(() => {
    // A focus comes from the overview link that opened this search
    if (scrollToFocus) ref.current?.scrollIntoView({ block: 'center' });
  }, [scrollToFocus]);
  const s = ROW[plain ? 'unchanged' : row.status];
  const Icon = KIND_ICON[row.kind];
  const toggle = (l: ListRef) =>
    setOpen((prev) => {
      const next = new Set(prev);
      const k = listKey(l.name, l.cluster);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const guides = Array.from({ length: row.depth }, (_, i) => <span key={i} className="w-5 shrink-0 border-l border-slate-200" />);

  let content: React.ReactNode;
  if (row.kind === 'criterion' || row.kind === 'folded') {
    const folded = row.kind === 'folded';
    content = (
      <>
        {row.joiner && <span className="rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500">{row.joiner}</span>}
        {row.linked && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-blue-500" aria-label="Linked criterion" />}
        <span className={cn(folded ? 'text-muted-foreground' : 'font-semibold', !plain && row.status === 'removed' && 'line-through decoration-red-400')}>
          {folded && (row.count ?? 1) > 1 ? `${row.count} criteria: ${row.text}` : <RowText row={row} plain={plain} />}
        </span>
        {!folded && row.tableFrom && !plain && (
          <Badge variant="outline" className={cn(TABLE_BADGE, 'line-through')} title="Data source before">
            {row.tableFrom}
          </Badge>
        )}
        {!folded && (
          <Badge variant="outline" className={cn(TABLE_BADGE, row.tableFrom && !plain && 'border-amber-300 bg-amber-100 text-amber-900')}>
            {row.table}
          </Badge>
        )}
        {(row.negation || row.negationFrom) && (
          <Badge
            variant="outline"
            className={cn('h-5 border-red-200 bg-red-100 px-1.5 text-[10px] text-red-700', row.negationFrom !== undefined && !row.negation && 'line-through')}
            title={row.negationFrom !== undefined ? (row.negation ? 'NOT added' : 'NOT removed') : 'Patients must NOT have a matching record'}
          >
            NOT
          </Badge>
        )}
        {folded && <span className="text-xs text-muted-foreground">· no changes</span>}
      </>
    );
  } else if (row.kind === 'operator' || row.kind === 'group') {
    content = (
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <RowText row={row} plain={plain} />
      </span>
    );
  } else {
    content = (
      <>
        {Icon && (
          <Icon className={cn('h-3.5 w-3.5 shrink-0', row.kind === 'relationship' ? 'text-blue-500' : row.kind === 'library' ? 'text-amber-500' : 'text-muted-foreground')} />
        )}
        {row.kind === 'test' && <span className="text-xs text-muted-foreground">Test the kept record:</span>}
        {(row.kind !== 'test' || !row.lists?.some((l) => l.cluster)) && (
          <span className={cn(row.kind === 'relationship' && 'text-blue-700', row.kind === 'restriction' && 'text-indigo-700')}>
            <RowText row={row} plain={plain} />
          </span>
        )}
        {row.lists?.map((l, i) => (
          <span key={`${l.name}${l.cluster}${i}`} className="contents">
            {i > 0 && <span className="text-[10px] font-semibold text-muted-foreground">OR</span>}
            <ListButton list={l} open={open.has(listKey(l.name, l.cluster))} onToggle={() => toggle(l)} />
          </span>
        ))}
      </>
    );
  }

  const openLists = (row.lists ?? []).filter((l) => open.has(listKey(l.name, l.cluster)));
  return (
    <div ref={ref} data-change-row={row.key}>
      <div className={cn('flex min-h-[30px] items-stretch text-[13px]', s.tint, flash && 'relative z-10 ring-2 ring-primary/60')}>
        <span className={cn('w-1 shrink-0', s.bar)} aria-hidden />
        <span className={cn('w-5 shrink-0 text-center font-mono text-xs leading-[30px]', s.symbol)} aria-hidden>
          {s.sign}
        </span>
        {guides}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 py-1 pr-3">{content}</div>
        {row.mark && !plain && <ListStatusBadge status={row.mark} className="mr-3 self-center" />}
      </div>
      {openLists.length > 0 && (
        <div className={cn('flex', s.tint)}>
          <span className={cn('w-1 shrink-0', s.bar)} aria-hidden />
          <span className="w-5 shrink-0" />
          {guides}
          <span className="w-5 shrink-0 border-l border-slate-200" />
          <div className="min-w-0 flex-1 space-y-2 py-1.5 pr-3">
            {openLists.map((l) => (
              <ListPanel key={listKey(l.name, l.cluster)} list={l} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ruleTitle = (r: RuleDiff, total: number) => {
  if (r.kind === 'column') return r.label;
  const role = total > 1 ? (r.number === 1 ? ' (Primary)' : ' (Additional)') : '';
  return `Rule ${r.number}${role}${r.previousNumber ? ` · was Rule ${r.previousNumber}` : ''}`;
};

/** Header-level changes, which get their own "next change" stop */
const ruleHeadChanged = (r: RuleDiff) =>
  r.status === 'added' || r.status === 'removed' || !!r.passFrom || !!r.failFrom || !!r.reordered || r.columns?.from !== undefined;

function Actions({ r, compact = false }: { r: RuleDiff; compact?: boolean }) {
  const plain = useContext(PlainContext);
  if (r.columns) {
    const edited = !plain && r.columns.from !== undefined;
    return (
      <span className={cn('text-xs', compact ? 'text-muted-foreground' : 'text-slate-300')}>
        Shows:{' '}
        {edited ? (
          <span className="rounded bg-card px-1 text-foreground">
            <InlineDiff parts={diffLineWords(r.columns.from!, r.columns.text, true).parts} />
          </span>
        ) : (
          r.columns.text
        )}
      </span>
    );
  }
  const badge = (action?: string, was?: string) =>
    action && (
      <>
        {was && !plain && (
          <Badge variant="outline" className={cn(actionBadgeClass(was), 'line-through', compact && 'h-5 text-[10px]')}>
            {actionLabel(was)}
          </Badge>
        )}
        <Badge variant="outline" className={cn(actionBadgeClass(action), compact && 'h-5 text-[10px]')}>
          {actionLabel(action)}
        </Badge>
      </>
    );
  return (
    <span className={cn('flex items-center gap-1.5 text-xs', compact ? 'text-muted-foreground' : 'text-slate-300')}>
      Pass {badge(r.pass, r.passFrom)} Fail {badge(r.fail, r.failFrom)}
    </span>
  );
}

function RuleBlock({ rule: r, index, total, mode, flashKey }: { rule: RuleDiff; index: number; total: number; mode: OutlineMode; flashKey: string | null }) {
  const plain = useContext(PlainContext);
  const [opened, setOpened] = useState(false);
  const rows = useMemo(() => outlineRule(r, opened ? 'full' : mode), [r, mode, opened]);
  if (r.status === 'unchanged' && mode === 'changes' && !opened) {
    return (
      <button
        type="button"
        onClick={() => setOpened(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-dashed bg-card px-4 py-2.5 text-left text-sm text-muted-foreground hover:border-foreground/30"
      >
        <ChevronRight className="h-4 w-4 shrink-0" />
        <span className="font-medium text-foreground/70">{ruleTitle(r, total)}</span>
        <span>· {plural(r.criteria.length + r.population.length + r.libraryItems.length, 'criterion', 'criteria')} · no changes</span>
        <span className="ml-auto">
          <Actions r={r} compact />
        </span>
      </button>
    );
  }
  const headChange = !plain && ruleHeadChanged(r);
  return (
    <Card
      data-change-row={headChange ? `${index}:head` : undefined}
      className={cn(
        'overflow-hidden bg-card shadow-sm',
        !plain && r.status === 'added' && 'ring-2 ring-emerald-400',
        !plain && r.status === 'removed' && 'ring-2 ring-red-300',
        flashKey === `${index}:head` && 'ring-2 ring-primary/60'
      )}
    >
      <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-slate-700 to-slate-800 px-4 py-2.5 text-white">
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-semibold', !plain && r.status === 'removed' && 'line-through decoration-red-300')}>{ruleTitle(r, total)}</span>
          {!plain && r.status !== 'unchanged' && <ListStatusBadge status={r.status} />}
          {!plain && r.reordered && (
            <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900" title="Rules run in order, so moving one can change who is kept">
              Moved
            </span>
          )}
        </div>
        <Actions r={r} />
      </div>
      <div className="py-1">
        {rows.map((row) => (
          <Row key={row.key} row={row} flash={flashKey === `${index}:${row.key}`} />
        ))}
        {!rows.length && <p className="px-4 py-2 text-xs italic text-muted-foreground">No criteria in this rule.</p>}
      </div>
    </Card>
  );
}

/** Floating "change n of m" control; n / p keys step through changes */
function ChangeNav({ ids, onJump }: { ids: string[]; onJump: (id: string) => void }) {
  const [at, setAt] = useState(-1);
  const go = useCallback(
    (step: number) => {
      if (!ids.length) return;
      const next = at < 0 ? (step > 0 ? 0 : ids.length - 1) : (at + step + ids.length) % ids.length;
      setAt(next);
      onJump(ids[next]);
    },
    [at, ids, onJump]
  );
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t.closest('input, textarea, select, [role="combobox"], [role="listbox"]') || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === 'n') go(1);
      else if (ev.key === 'p') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);
  if (!ids.length) return null;
  return (
    <div className="fixed bottom-6 right-6 z-30 flex items-center gap-1 rounded-full border bg-card px-2 py-1.5 text-sm shadow-lg">
      <button type="button" onClick={() => go(-1)} className="rounded-full p-1 hover:bg-muted" title="Previous change (p)">
        <ChevronUp className="h-4 w-4" />
      </button>
      <span className="min-w-[7.5rem] text-center tabular-nums">{at < 0 ? plural(ids.length, 'change') : `Change ${at + 1} of ${ids.length}`}</span>
      <button type="button" onClick={() => go(1)} className="rounded-full p-1 hover:bg-muted" title="Next change (n)">
        <ChevronDown className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * A search's rules as an indented outline inside Explore-style rule cards. Changes are marked in a
 * coloured gutter; `plain` draws a whole new or removed search as it is.
 */
export function RuleDiffView({
  rules,
  plain = false,
  lists = [],
}: {
  rules: RuleDiff[];
  plain?: boolean;
  /** Code list changes, opened in place from the rows that use them */
  lists?: CodeListDetail[];
}) {
  const [mode, setMode] = useState<OutlineMode>(plain ? 'full' : 'changes');
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const details = useMemo<ListDetails>(
    () => ({ byKey: new Map(lists.map((l) => [listKey(l.name, l.cluster), l])) }),
    [lists]
  );
  const total = rules.filter((r) => r.kind === 'rule' && (plain || r.status !== 'removed')).length;

  // Stops in reading order: rule headers (new, removed, actions changed), then the start of each run of changed rows
  const changeIds = useMemo(() => {
    if (plain) return [];
    return rules.flatMap((r, i) => {
      if (r.status === 'unchanged') return [];
      if (r.status === 'added' || r.status === 'removed') return [`${i}:head`];
      const head = ruleHeadChanged(r) ? [`${i}:head`] : [];
      const rows = outlineRule(r, mode);
      const starts = changeStarts(rows);
      return [...head, ...rows.filter((row) => starts.has(row.key)).map((row) => `${i}:${row.key}`)];
    });
  }, [rules, mode, plain]);

  const jump = useCallback((id: string) => {
    const [ri, key] = id.split(':');
    const el =
      key === 'head'
        ? document.querySelector(`[data-change-row="${id}"]`)
        : document.querySelectorAll('[data-rule-index]')[Number(ri)]?.querySelector(`[data-change-row="${key}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashKey(id);
    window.setTimeout(() => setFlashKey((k) => (k === id ? null : k)), 1500);
  }, []);

  const changed = rules.filter((r) => r.status !== 'unchanged').length;
  if (!plain && !changed) {
    return <p className="text-sm text-muted-foreground">Rules unchanged. The change is in the properties, parent searches or code lists.</p>;
  }

  return (
    <ListDetailsContext.Provider value={details}>
      <PlainContext.Provider value={plain}>
        <div className="space-y-4">
          {!plain && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-md border bg-card p-0.5 text-xs">
                {(['changes', 'full'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn('rounded px-2.5 py-1', mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                  >
                    {m === 'changes' ? 'Changes only' : 'Full search'}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                {plural(rules.length, 'rule')}, {changed} with changes · {plural(changeIds.length, 'change')} · <kbd className="font-mono">n</kbd> /{' '}
                <kbd className="font-mono">p</kbd> to step through
              </span>
              <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
                {(['added', 'removed', 'changed'] as const).map((st) => (
                  <span key={st} className="flex items-center gap-1">
                    <span className={cn('h-3 w-1 rounded-sm', ROW[st].bar)} />
                    {st === 'added' ? 'New' : st === 'removed' ? 'Removed' : 'Edited'}
                  </span>
                ))}
              </span>
            </div>
          )}
          {rules.map((r, i) => (
            <div key={i} data-rule-index={i}>
              <RuleBlock rule={r} index={i} total={total} mode={mode} flashKey={flashKey} />
            </div>
          ))}
          {!rules.length && <p className="text-sm text-muted-foreground">This search has no rules of its own.</p>}
        </div>
        {!plain && <ChangeNav key={mode} ids={changeIds} onJump={jump} />}
      </PlainContext.Provider>
    </ListDetailsContext.Provider>
  );
}
