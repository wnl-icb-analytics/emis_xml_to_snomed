'use client';

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, ArrowRight, Download, GitCompare, Loader2 } from 'lucide-react';
import {
  codeListDetails,
  collectTerminologyChanges,
  entryRef,
  FIELD_LABEL,
  renderXmlDiffMarkdown,
  repeatedEdits,
  type FieldChange,
  type SearchDiffEntry,
  type SearchRef,
  type XmlDiffResult,
} from '@/lib/xml-diff';
import { diffLineWords, summarizeGuidePatch } from '@/lib/patch-view';
import { slugifyFileName } from '@/lib/valueset-utils';
import { downloadFile } from '@/lib/csv-utils';
import { useCompare, type ListFocus } from '@/contexts/CompareContext';
import { markdownComponents } from '@/components/implementation-guide-view';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeListChanges, listKey } from '@/components/compare/code-list-changes';
import { RuleDiffView } from '@/components/compare/rule-diff-view';
import { PatchNotesView } from '@/components/compare/patch-notes-view';
import { buildPatchNotes, renderPatchNotesMarkdown } from '@/lib/patch-notes';
import { listRefsIn, ruleChangeKind } from '@/lib/rule-diff';
import { EditChip, GuidePatchView, InlineDiff } from '@/components/compare/guide-patch-view';
import { DIFF, ListStatusBadge, MATCH_LABEL, STATUS, STATUS_ORDER, SectionHeader, StatusBadge, plural } from '@/components/compare/status';
import { cn } from '@/lib/utils';

export default function CompareMode() {
  const { result, loading, selected } = useCompare();
  if (loading) return <LoadingState />;
  if (!result) return <EmptyState />;
  return selected ? <EntryDetail key={result.entries.indexOf(selected)} entry={selected} /> : <Overview result={result} />;
}

function EmptyState() {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-2xl shadow-sm">
        <CardContent className="pt-6">
          <div className="space-y-4 text-center">
            <GitCompare className="mx-auto h-14 w-14 text-primary/60" />
            <div>
              <h2 className="mb-2 text-2xl font-bold">Compare two search sets</h2>
              <p className="text-muted-foreground">Pick an older and a newer shared XML file in the sidebar, then Compare.</p>
            </div>
            <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-left text-sm text-muted-foreground">
              <h3 className="mb-2 font-semibold text-foreground">How it works:</h3>
              <ol className="list-inside list-decimal space-y-1">
                <li>Searches are paired by folder and name, then by content. Search GUIDs change on every export and are ignored.</li>
                <li>Each changed search shows its property, code list and logic changes. Renumbered code lists are not reported.</li>
                <li>Add an optional scope list (e.g. the dbt mapping file) to focus on the searches you use and their parents.</li>
                <li>Download the result as JSON or Markdown for review.</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-md border-primary/40 bg-primary/5 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium">Comparing search sets…</p>
              <p className="text-xs text-muted-foreground">Both files are parsed on the server. Large sets take 10–20 seconds.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Downloads({ result }: { result: XmlDiffResult }) {
  const { scopeOnly } = useCompare();
  const name = `${slugifyFileName(result.base.label)}__vs__${slugifyFileName(result.target.label)}`;
  const md = (scopeOnly: boolean) =>
    downloadFile(renderXmlDiffMarkdown(result, { scopeOnly }), `${name}${scopeOnly ? '.scope' : ''}.diff.md`, 'text/markdown;charset=utf-8');
  return (
    <div className="flex shrink-0 gap-2">
      <Button
        size="sm"
        onClick={() =>
          downloadFile(renderPatchNotesMarkdown(buildPatchNotes(result, { scopeOnly })), `${name}${scopeOnly ? '.scope' : ''}.patch-notes.md`, 'text/markdown;charset=utf-8')
        }
      >
        <Download className="mr-1 h-4 w-4" />
        Patch notes
      </Button>
      <Button variant="outline" size="sm" onClick={() => downloadFile(JSON.stringify(result, null, 2), `${name}.diff.json`, 'application/json')}>
        <Download className="mr-1 h-4 w-4" />
        JSON
      </Button>
      <Button variant="outline" size="sm" onClick={() => md(false)}>
        <Download className="mr-1 h-4 w-4" />
        Full Markdown
      </Button>
      {result.scope && (
        <Button variant="outline" size="sm" onClick={() => md(true)}>
          <Download className="mr-1 h-4 w-4" />
          Markdown (in scope)
        </Button>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Clickable search name that opens its detail */
function SearchLink({ r, focus, className }: { r: SearchRef; focus?: ListFocus; className?: string }) {
  const { selectByRef } = useCompare();
  return (
    <button type="button" onClick={() => selectByRef(r, focus)} className={cn('text-left hover:text-primary hover:underline', className)}>
      {r.name}
    </button>
  );
}

/** Code list changes listed on the overview before "Show all" */
const LIST_PREVIEW = 8;

function Overview({ result }: { result: XmlDiffResult }) {
  const { counts, statuses, toggleStatus, scopeOnly } = useCompare();
  const entries = useMemo(() => (scopeOnly ? result.entries.filter((e) => e.scope) : result.entries), [result, scopeOnly]);
  const terminology = useMemo(() => collectTerminologyChanges(entries), [entries]);
  const [allLists, setAllLists] = useState(false);
  const modified = useMemo(() => entries.filter((e) => e.status === 'modified'), [entries]);
  const addedRemoved = useMemo(() => {
    const m = new Map<string, { added: number; removed: number }>();
    for (const e of entries) {
      if (e.status !== 'added' && e.status !== 'removed') continue;
      const f = m.get(entryRef(e).folder) ?? { added: 0, removed: 0 };
      f[e.status]++;
      m.set(entryRef(e).folder, f);
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);
  const moves = useMemo(() => {
    const m = new Map<string, { from: string; to: string; searches: number }>();
    for (const e of entries) {
      if (!e.moved || !e.base || !e.target) continue;
      const k = `${e.base.folder}>${e.target.folder}`;
      const v = m.get(k) ?? { from: e.base.folder, to: e.target.folder, searches: 0 };
      v.searches++;
      m.set(k, v);
    }
    return [...m.values()].sort((a, b) => b.searches - a.searches);
  }, [entries]);
  const s = result.scope;

  return (
    <div className="w-full min-w-0 max-w-full space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-x-2 text-2xl font-bold">
            <span>{result.base.label}</span>
            <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span>{result.target.label}</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.base.fileName} ({plural(result.base.searchCount, 'search', 'searches')}) → {result.target.fileName} (
            {plural(result.target.searchCount, 'search', 'searches')})
          </p>
        </div>
        <Downloads result={result} />
      </div>

      <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">
        {STATUS_ORDER.map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => toggleStatus(st)}
            aria-pressed={statuses.has(st)}
            title={`${STATUS[st].hint}. Click to show or hide in the list.`}
            className={cn(
              'rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition-all hover:border-foreground/20',
              !statuses.has(st) && 'bg-muted text-muted-foreground shadow-none'
            )}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span className={cn('h-2 w-2 rounded-full', STATUS[st].dot)} />
              {STATUS[st].label}
            </div>
            <div className={cn('mt-1 text-2xl font-semibold tabular-nums', counts[st] && statuses.has(st) ? STATUS[st].text : 'text-muted-foreground')}>
              {counts[st].toLocaleString()}
            </div>
          </button>
        ))}
      </div>
      {!scopeOnly && result.affected > 0 && (
        <p className="-mt-3 text-sm text-muted-foreground">
          {plural(result.affected, 'unchanged search depends', 'unchanged searches depend')} on a modified, added or removed search, mostly through
          shared registers.
        </p>
      )}

      {result.trimmed && (
        <Notice>
          Large diff: guides for {result.trimmed.guides} and code lists for {result.trimmed.codeLists} added or removed searches were left out
          {result.trimmed.rules ? `, and rule views for ${result.trimmed.rules} modified searches` : ''}. Run{' '}
          <code className="font-mono text-xs">scripts/diff-xml.ts</code> for the full output.
        </Notice>
      )}
      {s && (
        <p className="text-sm text-muted-foreground">
          Scope <span className="font-medium text-foreground">{s.label}</span>: {s.matched}/{s.searches} listed searches found, plus{' '}
          {plural(s.ancestors, 'search', 'searches')} they depend on. {plural(s.affectedUpstream, 'unchanged in-scope search depends', 'unchanged in-scope searches depend')} on a
          changed search.
        </p>
      )}
      {s && (s.unmatched.length > 0 || s.baseOnly.length > 0) && (
        <Notice>
          <details>
            <summary className="cursor-pointer">
              Scope rows to check: {s.unmatched.length} not found, {s.baseOnly.length} found only under the older name or folder
            </summary>
            <ul className="mt-2 ml-4 list-disc space-y-0.5 text-xs">
              {s.unmatched.map((r) => (
                <li key={`u${r.folder}${r.name}`}>
                  Not found: {r.folder} › <span className="font-medium">{r.name}</span>
                </li>
              ))}
              {s.baseOnly.map((r) => (
                <li key={`b${r.folder}${r.name}`}>
                  Older file only: {r.folder} › <span className="font-medium">{r.name}</span>
                </li>
              ))}
            </ul>
          </details>
        </Notice>
      )}

      <Tabs defaultValue="notes" className="w-full">
        <TabsList>
          <TabsTrigger value="notes">Patch notes</TabsTrigger>
          <TabsTrigger value="summary">Summary tables</TabsTrigger>
        </TabsList>
        <TabsContent value="notes" className="mt-4">
          <PatchNotesView result={result} scopeOnly={scopeOnly} />
        </TabsContent>
        <TabsContent value="summary" className="mt-4 space-y-6">
      {terminology.length > 0 && (
        <Card className="shadow-sm">
          <SectionHeader title="Code list changes">{plural(terminology.length, 'change')}</SectionHeader>
          <CardContent className="px-0 pb-1 pt-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">Cluster</th>
                  <th className="px-2 py-2 font-semibold">Change</th>
                  <th className="px-4 py-2 font-semibold">Searches</th>
                </tr>
              </thead>
              <tbody>
                {(allLists ? terminology : terminology.slice(0, LIST_PREVIEW)).map((t) => (
                  <tr key={`${t.status}${t.cluster}${t.summary}`} className="border-b border-border/50 align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs font-semibold">{t.cluster ?? <span className="font-sans font-normal text-muted-foreground">No cluster ID</span>}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-start gap-2">
                        <ListStatusBadge status={t.status} className="mt-0.5" />
                        <span>{t.summary}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {t.searches.map((r, i) => (
                        <SearchLink key={i} r={r} focus={{ cluster: t.cluster, summary: t.summary }} className="block" />
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {terminology.length > LIST_PREVIEW && (
              <button type="button" onClick={() => setAllLists(!allLists)} className="w-full border-t px-4 py-2 text-left text-xs text-primary hover:bg-muted">
                {allLists ? 'Show fewer' : `Show all ${terminology.length} code list changes`}
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {modified.length > 0 && (
        <Card className="shadow-sm">
          <SectionHeader title="Modified searches">{plural(modified.length, 'search', 'searches')}</SectionHeader>
          <CardContent className="divide-y divide-border/50 px-0 pb-1 pt-0">
            {modified.map((e) => (
              <ModifiedRow key={result.entries.indexOf(e)} e={e} />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {addedRemoved.length > 0 && (
          <Card className="shadow-sm">
            <SectionHeader title="Added and removed, by folder" />
            <CardContent className="px-0 pb-1 pt-0">
              <table className="w-full text-sm">
                <tbody>
                  {addedRemoved.map(([folder, c]) => (
                    <tr key={folder} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-2 text-xs">{folder || '(root)'}</td>
                      <td className="w-14 px-2 py-2 text-right text-xs tabular-nums text-emerald-600">{c.added ? `+${c.added}` : ''}</td>
                      <td className="w-14 px-4 py-2 text-right text-xs tabular-nums text-red-600">{c.removed ? `−${c.removed}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
        {moves.length > 0 && (
          <Card className="shadow-sm">
            <SectionHeader title="Folder moves" />
            <CardContent className="px-0 pb-1 pt-0">
              {moves.map((m) => (
                <div key={`${m.from}>${m.to}`} className="grid grid-cols-[1fr_auto_1fr_auto] items-start gap-2 border-b border-border/50 px-4 py-2 text-xs last:border-0">
                  <span className="text-muted-foreground">{m.from}</span>
                  <ArrowRight className="mt-0.5 h-3 w-3 text-muted-foreground" />
                  <span>{m.to}</span>
                  <span className="tabular-nums text-muted-foreground">{m.searches}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ModifiedRow({ e }: { e: SearchDiffEntry }) {
  const { select } = useCompare();
  const summary = useMemo(() => (e.guidePatch ? summarizeGuidePatch(e.guidePatch) : null), [e]);
  // One-off edits are often fragments of a longer rewrite; repeated ones are the pattern worth showing
  const edits = summary?.edits.filter((x) => x.lines > 1).slice(0, 3) ?? [];
  const lines = summary ? summary.changed + summary.added + summary.removed : 0;
  const lists = e.codeLists ?? [];
  const codesOnly = !!e.rules && ruleChangeKind(e.rules) === 'codes';
  return (
    <button type="button" onClick={() => select(e)} className="block w-full px-4 py-2.5 text-left transition-colors hover:bg-muted/40">
      <div className="truncate text-sm font-medium">{entryRef(e).name}</div>
      <div className="truncate text-xs text-muted-foreground">{entryRef(e).folder}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {lists.length > 0 && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium">
            {plural(lists.length, 'code list')}
          </Badge>
        )}
        {codesOnly ? (
          <Badge
            variant="outline"
            className="h-5 border-sky-300 bg-sky-50 px-1.5 text-[10px] font-medium text-sky-700"
            title="Rules and criteria are identical; only the codes inside a code list changed"
          >
            logic unchanged
          </Badge>
        ) : (
          lines > 0 && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium">
              {plural(lines, 'logic line')}
            </Badge>
          )
        )}
        {(e.renamed || e.moved) && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium">
            {[e.renamed && 'renamed', e.moved && 'moved'].filter(Boolean).join(' + ')}
          </Badge>
        )}
        {e.dependents > 0 && <span>{plural(e.dependents, 'dependent search', 'dependent searches')}</span>}
        {!!e.upstreamChanges?.length && <span>depends on {plural(e.upstreamChanges.length, 'changed search', 'changed searches')}</span>}
        {edits.map((x) => (
          <EditChip key={`${x.from}>${x.to}`} edit={x} />
        ))}
      </div>
    </button>
  );
}

function FieldValue({ f }: { f: FieldChange }) {
  // One line with only the edited characters marked; unrelated values fall back to old → new
  if (f.from && f.to && f.field !== 'reportType') return <InlineDiff parts={diffLineWords(f.from, f.to, true).parts} />;
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      {f.from ? <span className={DIFF.delText}>{f.from}</span> : <span className="text-muted-foreground">None</span>}
      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
      {f.to ? <span className={DIFF.addText}>{f.to}</span> : <span className="text-muted-foreground">None</span>}
    </span>
  );
}

function EntryDetail({ entry: e }: { entry: SearchDiffEntry }) {
  const { select, selectByRef } = useCompare();
  const r = entryRef(e);
  const crumbs = r.folder ? r.folder.split(' > ') : [];
  const lists = e.codeLists ?? [];
  const edits = useMemo(() => repeatedEdits(e), [e]);
  const patchSummary = useMemo(() => (e.guidePatch ? summarizeGuidePatch(e.guidePatch) : null), [e]);
  const changedLines = patchSummary ? patchSummary.changed + patchSummary.added + patchSummary.removed : 0;
  const hasCodes = lists.length > 0 || e.codesChildrenChanged.length > 0;
  const hasLibrary = e.libraryItemsAdded.length > 0 || e.libraryItemsRemoved.length > 0;
  // Searches in one file only: rules and code lists drawn as they are, guide in full
  const whole = e.status === 'added' || e.status === 'removed';
  const hasGuide = whole ? !!(e.guide || e.guideOmitted) : !!e.guidePatch;
  const codesOnly = !!e.rules && !whole && ruleChangeKind(e.rules) === 'codes';
  const details = useMemo(() => codeListDetails(e), [e]);
  // Lists the rules show in place; the Code lists card keeps the rest
  const inline = useMemo(() => new Set(listRefsIn(e.rules ?? []).map((l) => listKey(l.name, l.cluster))), [e]);
  const otherLists = details.filter((l) => !inline.has(listKey(l.name, l.cluster)));

  return (
    <div className="w-full min-w-0 max-w-full space-y-6 p-6">
      <nav className="flex flex-wrap items-center text-sm text-muted-foreground">
        <button type="button" onClick={() => select(null)} className="font-medium text-primary hover:underline">
          Overview
        </button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center">
            <span className="mx-2">/</span>
            <span className={i === crumbs.length - 1 ? 'font-medium text-foreground' : ''}>{c}</span>
          </span>
        ))}
      </nav>

      <div>
        <div className="flex items-start gap-3">
          <h2 className="min-w-0 flex-1 break-words text-2xl font-bold">{r.name}</h2>
          <StatusBadge status={e.status} className="mt-1.5 h-6 px-2 text-xs" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {e.matchedBy && e.matchedBy !== 'path' && <span title="How this search was paired with the older one">Paired by {MATCH_LABEL[e.matchedBy]}</span>}
          {e.dependents > 0 && <span>{plural(e.dependents, 'dependent search', 'dependent searches')}</span>}
          {e.scope && <span>{e.scope === 'direct' ? 'In scope' : 'In scope as a dependency'}</span>}
          {e.scopeTags?.map((t) => (
            <Badge key={t} variant="outline" className="h-5 border-slate-300 bg-slate-100 px-1.5 font-mono text-[11px] font-normal text-slate-700">
              {t}
            </Badge>
          ))}
        </div>
      </div>

      {e.warnings.length > 0 && (
        <Notice>
          {e.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </Notice>
      )}

      {e.fieldChanges.length > 0 && (
        <Card className="shadow-sm">
          <SectionHeader title="Properties" />
          <CardContent className="px-0 pb-1 pt-0">
            {e.fieldChanges.map((f) => (
              <div key={f.field} className="grid grid-cols-[9rem_1fr] gap-3 border-b border-border/50 px-4 py-2.5 text-sm last:border-0">
                <span className="font-medium text-muted-foreground">{FIELD_LABEL[f.field]}</span>
                <FieldValue f={f} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {edits.length > 0 && (
        <div className="-mb-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="mr-1">Same edit on several lines:</span>
          {edits.map((x) => (
            <EditChip key={`${x.from}>${x.to}`} edit={x} />
          ))}
        </div>
      )}

      {(e.rules || e.rulesOmitted || hasGuide || hasCodes) && (
        <Tabs defaultValue={e.rules || e.rulesOmitted || hasCodes ? 'rules' : 'guide'} className="w-full">
          <TabsList>
            <TabsTrigger value="rules" disabled={!e.rules && !e.rulesOmitted && !hasCodes}>
              Rules & codes
            </TabsTrigger>
            <TabsTrigger value="guide" disabled={!hasGuide}>
              Implementation guide
            </TabsTrigger>
          </TabsList>
          <TabsContent value="rules" className="mt-4 space-y-6">
            {whole && (
              <p className="text-sm text-muted-foreground">
                {e.status === 'added' ? 'Only in the newer file. Rules and code lists as they appear there.' : 'Only in the older file. Rules and code lists as they were.'}
              </p>
            )}
            {codesOnly && (
              <p className="text-sm text-muted-foreground">Rules and criteria are identical; only the codes inside a code list changed.</p>
            )}
            {e.rules && <RuleDiffView rules={e.rules} plain={whole} lists={details} />}
            {e.rulesOmitted && <p className="text-sm text-muted-foreground">Rules left out to keep the response small. See the implementation guide tab.</p>}
            {otherLists.length > 0 && (
              <Card className="shadow-sm">
                <SectionHeader title={e.rules ? 'Code lists not used by a rule' : 'Code lists'}>
                  {plural(otherLists.length, 'list')}
                  {e.codesOmitted !== undefined && ` · ${e.codesOmitted.toLocaleString()} codes left out`}
                </SectionHeader>
                <CardContent className="pt-4">
                  <CodeListChanges entry={e} exclude={inline} />
                </CardContent>
              </Card>
            )}
          </TabsContent>
          {hasGuide && (
            <TabsContent value="guide" className="mt-4">
              <Card className="shadow-sm">
                <SectionHeader title="Implementation guide">
                  {whole ? (e.status === 'added' ? 'newer file' : 'older file') : `${plural(changedLines, 'line')} in ${plural(patchSummary?.sections.length ?? 0, 'section')}`}
                </SectionHeader>
                <CardContent className="pt-4">
                  {!whole && e.guidePatch && <GuidePatchView patch={e.guidePatch} />}
                  {whole && e.guide && (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {e.guide}
                    </ReactMarkdown>
                  )}
                  {whole && !e.guide && (
                    <p className="text-sm text-muted-foreground">Guide left out to keep the response small. Open the file in Explore to read it.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      )}

      {hasLibrary && !e.rules && (
        <Card className="shadow-sm">
          <SectionHeader title="EMIS library items" />
          <CardContent className="space-y-1 pt-4 font-mono text-xs">
            {e.libraryItemsAdded.map((x) => (
              <div key={x} className="text-emerald-700 dark:text-emerald-300">+ {x}</div>
            ))}
            {e.libraryItemsRemoved.map((x) => (
              <div key={x} className="text-red-700 dark:text-red-300">− {x}</div>
            ))}
          </CardContent>
        </Card>
      )}

      {!!e.upstreamChanges?.length && (
        <Card className="shadow-sm">
          <SectionHeader title="Depends on changed searches" />
          <CardContent className="px-0 pb-1 pt-0">
            {e.upstreamChanges.map((u, i) => (
              <button
                key={i}
                type="button"
                onClick={() => selectByRef(u)}
                className="flex w-full items-center gap-3 border-b border-border/50 px-4 py-2 text-left text-sm last:border-0 hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{u.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{u.folder}</span>
                </span>
                <StatusBadge status={u.status} />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {e.status === 'modified' && !e.guidePatch && !hasCodes && !hasLibrary && e.fieldChanges.length === 0 && (
        <p className="text-sm text-muted-foreground">Structural change with no visible effect on the guide or code lists.</p>
      )}
      {e.status === 'unchanged' && <p className="text-sm text-muted-foreground">No changes to this search between the two files.</p>}
      {e.status === 'moved' && <p className="text-sm text-muted-foreground">Only the folder changed; the logic and code lists are identical.</p>}
      {e.status === 'renamed' && <p className="text-sm text-muted-foreground">Only the name changed; the logic and code lists are identical.</p>}

    </div>
  );
}
