'use client';

import { useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronRight, Folder, Info, ListTree, Network, Sparkles } from 'lucide-react';
import { buildPatchNotes, codeTally, RULES_OMITTED, type CodeNote, type DetailLine, type Highlight, type NoteGroup, type NoteLine, type PropertyNote, type SearchNote } from '@/lib/patch-notes';
import type { PatchPart } from '@/lib/patch-view';
import type { SearchDiffEntry, XmlDiffResult } from '@/lib/xml-diff';
import { useCompare } from '@/contexts/CompareContext';
import { CodeTable, ConceptCompare, codeCounts, hasCodesToShow } from '@/components/compare/code-list-changes';
import { DIFF, STATUS, SectionHeader, plural } from '@/components/compare/status';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Logic outlines longer than this start folded */
const DETAIL_OPEN_MAX = 15;

/** A sentence with its delta: before struck through ⇒ after in bold */
function Delta({ parts, large = false }: { parts: PatchPart[]; large?: boolean }) {
  return (
    <span className={cn('whitespace-pre-wrap break-words', large && 'text-base font-semibold')}>
      {parts.map((p, i) =>
        p.op === 'eq' ? (
          <span key={i}>{p.text}</span>
        ) : p.op === 'del' ? (
          <span key={i}>
            <span className={DIFF.delText}>{p.text.trim()}</span>
            {parts[i + 1]?.op === 'add' ? <span className="px-1 text-muted-foreground">⇒</span> : ' '}
          </span>
        ) : (
          <span key={i}>
            <span className={cn(DIFF.addText, 'font-semibold')}>{p.text.trim()}</span>{' '}
          </span>
        )
      )}
    </span>
  );
}

/** What the change means, under the delta */
function Note({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="mt-0.5 flex items-start gap-1 text-[13px] text-sky-800">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
      <span>{text}</span>
    </div>
  );
}

function Where({ text }: { text: string }) {
  return <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{text}</span>;
}

const TAG: Record<Exclude<NoteLine['kind'], 'edit'>, { label: string; className: string }> = {
  added: { label: 'New', className: 'bg-emerald-600 text-white' },
  removed: { label: 'Removed', className: 'bg-red-600 text-white' },
  replaced: { label: 'Replaced', className: 'bg-amber-500 text-white' },
};

function Tag({ kind }: { kind: Exclude<NoteLine['kind'], 'edit'> }) {
  return <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', TAG[kind].className)}>{TAG[kind].label}</span>;
}

function Detail({ lines, tone = 'plain' }: { lines: DetailLine[]; tone?: 'plain' | 'before' | 'after' }) {
  return (
    <div className={cn('rounded-md border py-1.5 text-[13px]', tone === 'before' ? DIFF.delBox : tone === 'after' ? DIFF.addBox : 'bg-slate-50')}>
      {lines.map((l, i) => (
        <div key={i} className="flex items-start gap-1.5 py-0.5 pr-3" style={{ paddingLeft: `${0.75 + l.depth * 1.1}rem` }}>
          <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-slate-400" />
          <span className="min-w-0">{l.text}</span>
        </div>
      ))}
    </div>
  );
}

function Toggle({ open, onClick, children }: { open: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

function LineItem({ line }: { line: NoteLine }) {
  const size = (line.detail?.length ?? 0) + (line.detailBefore?.length ?? 0);
  const [open, setOpen] = useState(size > 0 && size <= DETAIL_OPEN_MAX);
  const showWhere = line.kind === 'edit' || !line.parts.some((p) => p.text.startsWith(line.where));
  return (
    <li className="py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {line.kind !== 'edit' && <Tag kind={line.kind} />}
        {showWhere && <Where text={line.where} />}
        <span className="min-w-0 text-sm">
          <Delta parts={line.parts} />
        </span>
      </div>
      <Note text={line.note} />
      {size > 0 && (
        <div className="mt-1 pl-1">
          <Toggle open={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide logic' : line.detailBefore ? 'Show old and new logic' : `Show logic (${plural(line.detail!.length, 'line')})`}
          </Toggle>
          {open &&
            (line.detailBefore ? (
              <div className="mt-1.5 grid gap-2 lg:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-red-700">Before</div>
                  <Detail lines={line.detailBefore} tone="before" />
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">After</div>
                  <Detail lines={line.detail ?? []} tone="after" />
                </div>
              </div>
            ) : (
              <div className="mt-1.5">
                <Detail lines={line.detail!} />
              </div>
            ))}
        </div>
      )}
    </li>
  );
}

function GroupItem({ group: g }: { group: NoteGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-1.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <Delta parts={[...(g.before ? [{ op: 'del' as const, text: g.before }] : []), ...(g.after ? [{ op: 'add' as const, text: g.after }] : [])]} large />
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-white">×{g.lines.length}</span>
        <Toggle open={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide where' : `Where (${g.lines.length})`}
        </Toggle>
      </div>
      <Note text={g.note} />
      {open && (
        <ul className="mt-1 space-y-1 border-l-2 border-slate-200 pl-3">
          {g.lines.map((l, j) => (
            <li key={j} className="flex flex-wrap items-baseline gap-2 text-[13px]">
              <Where text={l.where} />
              <Delta parts={l.parts} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function PropertyItem({ p }: { p: PropertyNote }) {
  return (
    <li className="flex flex-wrap items-baseline gap-2 py-1.5 text-sm">
      <Where text={p.label} />
      <Delta parts={p.parts} />
    </li>
  );
}

function CodeItem({ note, plain }: { note: CodeNote; plain: boolean }) {
  const [open, setOpen] = useState(false);
  const l = note.list;
  const flips = note.childrenChanged.length;
  return (
    <li className="space-y-1 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        {!plain && l.status !== 'changed' && <Tag kind={l.status} />}
        <span className="font-mono font-semibold">{l.cluster ?? 'No cluster ID'}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{l.name}</span>
        <span>{l.summary}</span>
        {note.where.map((w) => (
          <Where key={w} text={w} />
        ))}
      </div>
      {hasCodesToShow(l, flips) && (
        <div className="pl-1">
          <Toggle open={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide codes' : plain ? `Show ${codeTally([...l.codesAdded, ...l.codesRemoved])}` : `Show codes ${codeCounts(l, flips)}`}
          </Toggle>
          {open && (
            <div className="mt-1.5">
              <CodeTable list={l} plain={plain} childrenChanged={note.childrenChanged} />
            </div>
          )}
        </div>
      )}
      {!plain && (
        <div className="pl-1">
          <ConceptCompare list={l} />
        </div>
      )}
    </li>
  );
}

/** "Reaches 27 searches" with the outputs it flows into */
function Reach({ note }: { note: SearchNote }) {
  const { selectByRef } = useCompare();
  const [open, setOpen] = useState(false);
  const r = note.reach;
  if (!r) return null;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800 hover:border-violet-400"
        title="Searches that depend on this one through parents or population criteria"
      >
        <Network className="h-3 w-3" />
        Reaches {plural(r.searches, 'search', 'searches')}
        {r.outputCount > 0 && ` · ${plural(r.outputCount, 'output')}`}
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && r.outputs.length > 0 && r.outputCount > r.outputs.length && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          First {r.outputs.length} of {r.outputCount.toLocaleString()} outputs
        </p>
      )}
      {open && r.outputs.length > 0 && (
        <ul className="mt-1.5 columns-1 gap-6 border-l-2 border-violet-200 pl-3 text-[13px] lg:columns-2">
          {r.outputs.map((o) => (
            <li key={`${o.folder}|${o.name}|${o.parent ?? ''}`} className="break-inside-avoid py-0.5">
              <button type="button" onClick={() => selectByRef(o)} className="text-left hover:underline">
                {o.name}
              </button>
              <span className="ml-1 text-[11px] text-muted-foreground">{o.folder}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Keys cards by their entry's place in the full result, so card state follows the search through scope filtering */
const cardKeys = (notes: SearchNote[], index: Map<SearchDiffEntry, number>): Array<[string, SearchNote]> =>
  notes.map((n) => [`e${index.get(n.entry) ?? n.ref.name}`, n]);

function SearchCard({ note, accent }: { note: SearchNote; accent: 'modified' | 'added' | 'removed' }) {
  const { select } = useCompare();
  const [routineOpen, setRoutineOpen] = useState(false);
  const plain = accent !== 'modified';
  const props = note.properties.filter((p) => !p.routine);
  const groups = note.groups.filter((g) => !g.routine);
  const lines = note.lines.filter((l) => !l.routine);
  const routine = { props: note.properties.filter((p) => p.routine), groups: note.groups.filter((g) => g.routine), lines: note.lines.filter((l) => l.routine) };
  const routineCount = routine.props.length + routine.groups.length + routine.lines.length;
  return (
    <Card className="overflow-hidden shadow-sm">
      <div className={cn('border-l-4 px-4 py-3', accent === 'modified' ? 'border-l-amber-500' : accent === 'added' ? 'border-l-emerald-500' : 'border-l-red-500')}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <button type="button" onClick={() => select(note.entry)} className="text-left text-base font-bold hover:text-primary hover:underline">
            {note.ref.name}
          </button>
          {note.tags
            .filter((t) => !t.startsWith('Reaches'))
            .map((t) => (
              <span key={t} className={cn('rounded-full border px-2 py-0.5 text-[11px]', t.startsWith('Logic unchanged') ? 'border-sky-300 bg-sky-50 text-sky-700' : 'bg-card text-muted-foreground')}>
                {t}
              </span>
            ))}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{note.ref.folder || '(root)'}</div>
        <Reach note={note} />

        <ul className="mt-2 divide-y divide-border/60">
          {props.map((p) => (
            <PropertyItem key={p.label} p={p} />
          ))}
          {groups.map((g, i) => (
            <GroupItem key={`g${i}`} group={g} />
          ))}
          {lines.map((l, i) => (
            <LineItem key={`l${i}`} line={l} />
          ))}
          {note.rules?.map((r, i) => (
            <li key={`r${i}`} className="py-1.5">
              <div className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-semibold">{r.title}</span>
                <span className="text-xs text-muted-foreground">{r.actions}</span>
              </div>
              <div className="mt-1">
                <Detail lines={r.lines} />
              </div>
            </li>
          ))}
          {note.rulesOmitted && <li className="py-1.5 text-sm italic text-muted-foreground">{RULES_OMITTED}.</li>}
          {!note.rulesOmitted && note.rules && !note.rules.length && (
            <li className="py-1.5 text-sm text-muted-foreground">No rules of its own; it reports on its parent population.</li>
          )}
          {routineCount > 0 && (
            <li className="py-1.5">
              <button type="button" onClick={() => setRoutineOpen(!routineOpen)} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <CalendarClock className="h-3.5 w-3.5" />
                Routine year rollover ({routineCount})
                {routineOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              {routineOpen && (
                <ul className="mt-1 divide-y divide-border/60 border-l-2 border-slate-200 pl-3">
                  {routine.props.map((p) => (
                    <PropertyItem key={p.label} p={p} />
                  ))}
                  {routine.groups.map((g, i) => (
                    <GroupItem key={`rg${i}`} group={g} />
                  ))}
                  {routine.lines.map((l, i) => (
                    <LineItem key={`rl${i}`} line={l} />
                  ))}
                </ul>
              )}
            </li>
          )}
        </ul>

        {note.codes.length > 0 && (
          <div className="mt-2 border-t pt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Code lists</div>
            <ul className="divide-y divide-border/60">
              {note.codes.map((c, i) => (
                <CodeItem key={i} note={c} plain={plain} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function Section({ title, count, hint, children }: { title: string; count: number; hint?: string; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <section className="space-y-3">
      <h3 className="flex flex-wrap items-baseline gap-2 border-b pb-1.5 text-lg font-bold">
        {title}
        <span className="rounded-full bg-slate-100 px-2 text-sm font-semibold text-slate-600">{count}</span>
        {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

const HIGHLIGHT_ICON: Record<Highlight['kind'], typeof Info> = {
  reach: Network,
  edit: Sparkles,
  codes: ListTree,
  folder: Folder,
  routine: CalendarClock,
};

/** Patch notes for a comparison: highlights, then every changed, new, removed and moved search with exact deltas */
export function PatchNotesView({ result, scopeOnly }: { result: XmlDiffResult; scopeOnly: boolean }) {
  const { selectByRef } = useCompare();
  const notes = useMemo(() => buildPatchNotes(result, { scopeOnly }), [result, scopeOnly]);
  const index = useMemo(() => new Map(result.entries.map((e, i) => [e, i])), [result]);
  const removedCount = notes.removed.reduce((n, g) => n + g.searches.length, 0);
  return (
    <div className="space-y-8">
      {notes.highlights.length > 0 && (
        <Card className="shadow-sm">
          <SectionHeader title="Highlights">
            <Sparkles className="h-3.5 w-3.5" />
          </SectionHeader>
          <CardContent className="pt-3">
            <ul className="space-y-1.5">
              {notes.highlights.map((h, i) => {
                const Icon = HIGHLIGHT_ICON[h.kind];
                return (
                  <li key={i} className={cn('text-sm', h.kind === 'routine' && 'text-muted-foreground')}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Icon className={cn('h-3.5 w-3.5 shrink-0 self-center', h.kind === 'reach' ? 'text-violet-600' : 'text-slate-400')} />
                      <Delta parts={h.parts} />
                      <span className="text-xs text-muted-foreground">{h.detail}</span>
                    </div>
                    {h.note && (
                      <div className="pl-5">
                        <Note text={h.note} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Section title="Changed searches" count={notes.changed.length} hint="furthest-reaching first; year rollovers folded">
        {cardKeys(notes.changed, index).map(([k, n]) => (
          <SearchCard key={k} note={n} accent="modified" />
        ))}
      </Section>

      <Section title="New searches" count={notes.added.length}>
        {cardKeys(notes.added, index).map(([k, n]) => (
          <SearchCard key={k} note={n} accent="added" />
        ))}
      </Section>

      <Section title="Removed searches" count={removedCount}>
        <Card className="shadow-sm">
          <CardContent className="space-y-3 pt-4">
            {notes.removed.map((g) => (
              <div key={g.folder}>
                <div className="text-sm font-semibold">
                  {g.folder || '(root)'} <span className="font-normal text-muted-foreground">· {g.searches.length}</span>
                </div>
                <ul className="mt-1 columns-1 gap-6 text-sm lg:columns-2">
                  {g.searches.map((n, i) => (
                    <li key={i} className="flex items-baseline gap-2 border-l-2 border-red-300 py-0.5 pl-2">
                      <button type="button" onClick={() => selectByRef(n.ref)} className="text-left text-red-900 hover:underline">
                        {n.ref.name}
                      </button>
                      {n.tags.map((t) => (
                        <span key={t} className="text-xs text-muted-foreground">
                          {t}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section title="Moved and renamed (logic unchanged)" count={notes.relocated.length}>
        <Card className="shadow-sm">
          <CardContent className="divide-y divide-border/60 pt-2">
            {notes.relocated.map((n, i) => (
              <div key={i} className="py-2">
                <button type="button" onClick={() => selectByRef(n.ref)} className={cn('text-left text-sm font-semibold hover:underline', STATUS.moved.text)}>
                  {n.ref.name}
                </button>
                {n.properties.map((p) => (
                  <div key={p.label} className="mt-1 flex flex-wrap items-baseline gap-2 text-[13px]">
                    <Where text={p.label} />
                    <Delta parts={p.parts} />
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section title="Routine year rollover" count={notes.routine.length} hint="only the year moved on">
        <Card className="shadow-sm">
          <CardContent className="divide-y divide-border/60 pt-2">
            {notes.routine.map((n, i) => (
              <div key={i} className="py-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <button type="button" onClick={() => selectByRef(n.ref)} className="text-left text-sm font-semibold hover:underline">
                    {n.ref.name}
                  </button>
                  {n.tags
                    .filter((t) => t.startsWith('Depends'))
                    .map((t) => (
                      <span key={t} className="text-xs text-muted-foreground">
                        {t}
                      </span>
                    ))}
                </div>
                <div className="mt-1 space-y-0.5 text-[13px]">
                  {n.properties.map((p) => (
                    <div key={p.label} className="flex flex-wrap items-baseline gap-2">
                      <Where text={p.label} />
                      <Delta parts={p.parts} />
                    </div>
                  ))}
                  {[...n.groups.flatMap((g) => g.lines), ...n.lines].map((l, j) => (
                    <div key={j} className="flex flex-wrap items-baseline gap-2">
                      <Where text={l.where} />
                      <Delta parts={l.parts} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
