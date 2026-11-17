'use client';

import { useMemo, useState } from 'react';
import { mergeRepeatedHunks, parseGuidePatch, type PatchPart, type PatchRow, type RepeatedEdit } from '@/lib/patch-view';
import { DIFF } from '@/components/compare/status';
import { cn } from '@/lib/utils';

/** Markdown bold, code and quote-italic markers read as noise in a diff; a * inside a search name is kept */
const clean = (s: string) => s.replace(/\*\*|`/g, '').replace(/\*"|"\*/g, '"');

const PREFIX = /^(\s*)(- |\d+\. |#{1,4} )?/;

const ROW: Record<PatchRow['kind'], { line: string; gutter: string; symbol: string }> = {
  context: { line: 'text-muted-foreground', gutter: 'text-transparent', symbol: ' ' },
  add: { line: DIFF.addRow, gutter: 'text-emerald-600', symbol: '+' },
  del: { line: DIFF.delRow, gutter: 'text-red-600', symbol: '−' },
  change: { line: DIFF.editRow, gutter: 'text-amber-600', symbol: '~' },
};

const PART: Record<PatchPart['op'], string> = {
  eq: '',
  del: DIFF.delText,
  add: DIFF.addText,
};

function PatchLine({ row }: { row: PatchRow }) {
  // Indentation and list markers come from the newer text; they are drawn, not printed
  const parts: PatchPart[] = row.kind === 'change' ? row.parts : [{ op: 'eq', text: row.text }];
  const lead = parts[0]?.op === 'eq' ? parts[0].text : '';
  const [prefix, indent, marker = ''] = lead.match(PREFIX) ?? ['', ''];
  const body = prefix ? [{ ...parts[0], text: parts[0].text.slice(prefix.length) }, ...parts.slice(1)] : parts;
  const heading = marker.startsWith('#');
  const style = ROW[row.kind];
  return (
    <div className={cn('grid grid-cols-[1.25rem_1fr] text-[13px] leading-6', style.line)}>
      <span className={cn('select-none text-center font-mono', style.gutter)} aria-hidden>
        {style.symbol}
      </span>
      <div className={cn('flex min-w-0 pr-3', heading && 'font-semibold text-foreground')} style={{ paddingLeft: `${indent.length * 0.45}rem` }}>
        {marker && !heading && <span className="mr-1.5 shrink-0 text-muted-foreground">{marker.trim() === '-' ? '•' : marker.trim()}</span>}
        <span className="min-w-0 whitespace-pre-wrap break-words">
          {body.map((p, i) => (
            <span key={i} className={PART[p.op]}>
              {clean(p.text)}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

/** Guide patch as edited lines with word-level highlights, one block per guide section */
export function GuidePatchView({ patch }: { patch: string }) {
  const hunks = useMemo(() => mergeRepeatedHunks(parseGuidePatch(patch)), [patch]);
  return (
    <div className="space-y-3">
      {hunks.map((h, i) => (
        <div key={i} className="overflow-hidden rounded-md border bg-card">
          {h.section && (
            <div className="border-b bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {h.section}
              {h.section === 'Start population' && <span className="font-normal"> · inherited from parent searches</span>}
              {h.alsoIn && <span className="font-normal"> · same change in {h.alsoIn.map(shortSection).join('; ')}</span>}
            </div>
          )}
          <HunkRows rows={h.rows} />
        </div>
      ))}
    </div>
  );
}

/** "Rule 3 of 4 — Exclusion · Criterion B" → "Rule 3 · Criterion B" */
const shortSection = (s: string) => s.replace(/ of \d+ — [^·]+/, ' ').replace(/\s+·/, ' ·').trim();

/** Runs of added or removed lines longer than this start collapsed */
const LONG_RUN = 12;
/** Lines of a collapsed run that stay visible */
const RUN_PREVIEW = 4;

function HunkRows({ rows }: { rows: PatchRow[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Split into runs of the same kind so long blocks of new or removed logic can fold
  const runs: Array<{ start: number; rows: PatchRow[] }> = [];
  rows.forEach((r, i) => {
    const last = runs.at(-1);
    if (last && last.rows[0].kind === r.kind && (r.kind === 'add' || r.kind === 'del')) last.rows.push(r);
    else runs.push({ start: i, rows: [r] });
  });
  return (
    <div className="py-1">
      {runs.map((run) => {
        const folded = run.rows.length > LONG_RUN && !expanded.has(run.start);
        const shown = folded ? run.rows.slice(0, RUN_PREVIEW) : run.rows;
        return (
          <div key={run.start}>
            {shown.map((r, j) => (
              <PatchLine key={j} row={r} />
            ))}
            {folded && (
              <button
                type="button"
                onClick={() => setExpanded((prev) => new Set(prev).add(run.start))}
                className={cn(
                  'grid w-full grid-cols-[1.25rem_1fr] text-left text-xs leading-6 hover:underline',
                  run.rows[0].kind === 'add' ? DIFF.addRow : DIFF.delRow
                )}
              >
                <span />
                <span>
                  Show {run.rows.length - RUN_PREVIEW} more {run.rows[0].kind === 'add' ? 'added' : 'removed'} lines
                </span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function EditChip({ edit, className }: { edit: RepeatedEdit; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-xs', className)}>
      {edit.from && <span className={DIFF.delText}>{edit.from}</span>}
      {edit.from && edit.to && <span className="text-muted-foreground">→</span>}
      {edit.to && <span className={DIFF.addText}>{edit.to}</span>}
      <span className="text-muted-foreground">×{edit.lines}</span>
    </span>
  );
}

/** Word-level diff of two short values, e.g. a search name */
export function InlineDiff({ parts }: { parts: PatchPart[] }) {
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => (
        <span key={i} className={PART[p.op]}>
          {p.text}
        </span>
      ))}
    </span>
  );
}
