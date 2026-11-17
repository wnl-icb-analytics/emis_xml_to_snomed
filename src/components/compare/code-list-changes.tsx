'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { codeListDetails, type CodeListDetail, type CodeRef, type SearchDiffEntry } from '@/lib/xml-diff';
import { ListStatusBadge, plural } from '@/components/compare/status';
import { cn } from '@/lib/utils';

/** Codes shown before "Show all" */
const CODE_PREVIEW = 50;

function CodeRow({ sign, c }: { sign: '+' | '−'; c: CodeRef }) {
  return (
    <div className={cn('grid grid-cols-[1rem_11rem_1fr_auto] gap-2 px-3 py-1 text-xs', sign === '+' ? 'bg-emerald-500/[0.06]' : 'bg-red-500/[0.06]')}>
      <span className={cn('font-mono', sign === '+' ? 'text-emerald-600' : 'text-red-600')}>{sign}</span>
      <code className="truncate font-mono">{c.code}</code>
      <span className={cn('min-w-0 truncate', !c.displayName && 'italic text-muted-foreground')} title={c.displayName}>
        {c.displayName || (c.isRefset ? 'Refset (no name in export)' : 'No display name')}
      </span>
      <span className="flex gap-1 text-[10px] text-muted-foreground">
        {c.isRefset && <span className="rounded border px-1">refset</span>}
        {c.excluded && <span className="rounded border px-1">exception</span>}
        {c.includeChildren && !c.excluded && <span className="rounded border px-1">+ children</span>}
      </span>
    </div>
  );
}

function CodeListRow({ list: l }: { list: CodeListDetail }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const rows = useMemo(
    () => [...l.codesAdded.map((c) => ['+', c] as const), ...l.codesRemoved.map((c) => ['−', c] as const)],
    [l]
  );
  // A lone refset is fully described by the summary
  const expandable = rows.length > 1 || (rows.length === 1 && !rows[0][1].isRefset);
  const shown = all ? rows : rows.slice(0, CODE_PREVIEW);
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
        {expandable && (
          <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {open ? 'Hide codes' : 'Show codes'}
            <span className="text-muted-foreground">
              {[l.codesAdded.length && `+${l.codesAdded.length}`, l.codesRemoved.length && `−${l.codesRemoved.length}`].filter(Boolean).join(' / ')}
            </span>
          </button>
        )}
      </div>
      {open && (
        <div className="max-h-80 divide-y divide-border/50 overflow-y-auto border-t">
          {shown.map(([sign, c]) => (
            <CodeRow key={`${sign}${c.excluded ? 'x' : ''}${c.code}`} sign={sign} c={c} />
          ))}
          {rows.length > shown.length && (
            <button type="button" onClick={() => setAll(true)} className="w-full px-3 py-1.5 text-left text-xs text-primary hover:bg-muted/40">
              Show all {rows.length.toLocaleString()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function CodeListChanges({ entry }: { entry: SearchDiffEntry }) {
  const lists = useMemo(() => codeListDetails(entry), [entry]);
  return (
    <div className="space-y-2">
      {lists.map((l) => (
        <CodeListRow key={`${l.status}${l.name}${l.cluster}`} list={l} />
      ))}
      {entry.codesChildrenChanged.length > 0 && (
        <div className="rounded-lg border bg-card px-3 py-2.5 text-sm">
          <div className="mb-1 font-medium">Include-children changed on {plural(entry.codesChildrenChanged.length, 'code')}</div>
          {entry.codesChildrenChanged.map((c) => (
            <div key={`${c.list}${c.code}`} className="text-xs text-muted-foreground">
              <code className="font-mono text-foreground">{c.code}</code> {c.displayName}
              {c.list && <span className="font-mono text-[11px]"> in {c.list}</span>}: {c.from ? 'with children' : 'code only'} →{' '}
              {c.to ? 'with children' : 'code only'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
