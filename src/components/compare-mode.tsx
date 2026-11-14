'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowRight, Download, FileJson, GitCompare, Loader2, Search, Upload, X } from 'lucide-react';
import type { XmlBlobFileSummary } from '@/lib/blob-xml';
import {
  entryRef,
  groupCodeChanges,
  renderXmlDiffMarkdown,
  type CodeRef,
  type SearchDiffEntry,
  type SearchDiffStatus,
  type XmlDiffResult,
} from '@/lib/xml-diff';
import { slugifyFileName } from '@/lib/valueset-utils';
import { markdownComponents } from '@/components/implementation-guide-view';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

const STATUS: Record<SearchDiffStatus, { label: string; tile: string; dot: string; text: string }> = {
  modified: { label: 'Modified', tile: 'border-amber-500/40 bg-amber-500/5', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  added: { label: 'Added', tile: 'border-emerald-500/40 bg-emerald-500/5', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  removed: { label: 'Removed', tile: 'border-red-500/40 bg-red-500/5', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  moved: { label: 'Moved', tile: 'border-sky-500/40 bg-sky-500/5', dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400' },
  renamed: { label: 'Renamed', tile: 'border-sky-500/40 bg-sky-500/5', dot: 'bg-sky-400', text: 'text-sky-600 dark:text-sky-400' },
  unchanged: { label: 'Unchanged', tile: 'border-border bg-muted/20', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
};
const STATUS_ORDER: SearchDiffStatus[] = ['modified', 'added', 'removed', 'moved', 'renamed', 'unchanged'];
const SCOPE_STORAGE_KEY = 'compare-scope';

interface StoredScope {
  label: string;
  json: unknown;
  count: number;
}


function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CompareMode() {
  const { toast } = useToast();
  const [files, setFiles] = useState<XmlBlobFileSummary[]>([]);
  const [basePath, setBasePath] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [scope, setScope] = useState<StoredScope | null>(null);
  const [result, setResult] = useState<XmlDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [statuses, setStatuses] = useState<Set<SearchDiffStatus>>(new Set(['modified', 'added', 'removed', 'moved', 'renamed']));
  const [scopeOnly, setScopeOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SearchDiffEntry | null>(null);
  const scopeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/xml-files')
      .then((r) => r.json())
      .then((d) => {
        const list: XmlBlobFileSummary[] = d.files ?? [];
        setFiles(list);
        // Newest upload as target, next newest as base
        if (list[0]) setTargetPath(list[0].pathname);
        if (list[1]) setBasePath(list[1].pathname);
      })
      .catch(() => toast({ variant: 'destructive', title: 'Shared files unavailable' }));
    try {
      const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
      if (stored) setScope(JSON.parse(stored));
    } catch {
      /* ignore corrupt storage */
    }
  }, [toast]);

  const runDiff = useCallback(async () => {
    if (!basePath || !targetPath) return;
    setLoading(true);
    setSelected(null);
    try {
      const res = await fetch('/api/xml-diff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ basePathname: basePath, targetPathname: targetPath, scope: scope?.json, scopeLabel: scope?.label }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Diff failed');
      setResult(data.data);
      setScopeOnly(!!data.data.scope);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Diff failed', description: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }, [basePath, targetPath, scope, toast]);

  const onScopeFile = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      const list = Array.isArray(json) ? json : json?.searches;
      if (!Array.isArray(list)) throw new Error('Expected an array of {folder, name} or an object with a searches array');
      const next = { label: file.name.replace(/\.json$/i, ''), json, count: list.length };
      setScope(next);
      localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      toast({ variant: 'destructive', title: 'Invalid scope file', description: error instanceof Error ? error.message : String(error) });
    }
  };

  const clearScope = () => {
    setScope(null);
    localStorage.removeItem(SCOPE_STORAGE_KEY);
  };

  const visible = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    return result.entries.filter((e) => {
      if (!statuses.has(e.status)) return false;
      if (scopeOnly && !e.scope) return false;
      if (!q) return true;
      const hay = [e.base?.name, e.base?.folder, e.target?.name, e.target?.folder, ...(e.scopeTags ?? [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [result, statuses, scopeOnly, query]);

  const counts = useMemo(() => {
    const c: Record<SearchDiffStatus, number> = { added: 0, removed: 0, modified: 0, moved: 0, renamed: 0, unchanged: 0 };
    if (!result) return c;
    if (!scopeOnly) return result.summary;
    result.entries.filter((e) => e.scope).forEach((e) => c[e.status]++);
    return c;
  }, [result, scopeOnly]);

  const toggleStatus = (s: SearchDiffStatus) =>
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const baseName = result ? `${slugifyFileName(result.base.label)}__vs__${slugifyFileName(result.target.label)}` : 'diff';

  return (
    <div className="p-6 space-y-4 max-w-[1600px]">
      <div className="flex items-center gap-2">
        <GitCompare className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-semibold">Compare search sets</h2>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            <FilePicker label="Base (older)" value={basePath} onChange={setBasePath} files={files} />
            <ArrowRight className="h-4 w-4 mb-2.5 text-muted-foreground" />
            <FilePicker label="Target (newer)" value={targetPath} onChange={setTargetPath} files={files} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={scopeInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onScopeFile(f);
                e.target.value = '';
              }}
            />
            {scope ? (
              <div className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                <FileJson className="h-3.5 w-3.5 text-primary" />
                <span className="font-medium">{scope.label}</span>
                <span className="text-muted-foreground">({scope.count} searches)</span>
                <button type="button" onClick={clearScope} className="ml-1 text-muted-foreground hover:text-foreground" title="Clear scope">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => scopeInput.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Scope list (optional)
              </Button>
            )}
            <span className="text-xs text-muted-foreground">JSON of {'{folder, name}'} rows, or the dbt mapping file</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" onClick={runDiff} disabled={loading || !basePath || !targetPath || basePath === targetPath}>
                {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <GitCompare className="h-4 w-4 mr-1.5" />}
                {loading ? 'Comparing…' : 'Compare'}
              </Button>
            </div>
          </div>
          {loading && <div className="text-xs text-muted-foreground">Parsing both files on the server. Large search sets take 10–20 seconds.</div>}
        </CardContent>
      </Card>

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{result.base.label}</span>
            <span className="text-muted-foreground">({result.base.searchCount})</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{result.target.label}</span>
            <span className="text-muted-foreground">({result.target.searchCount})</span>
            {result.scope && (
              <span className="text-xs text-muted-foreground">
                · scope {result.scope.label}: {result.scope.matched}/{result.scope.searches} found, +{result.scope.ancestors} parents
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => download(`${baseName}.diff.json`, JSON.stringify(result, null, 2), 'application/json')}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                JSON
              </Button>
              <Button variant="outline" size="sm" onClick={() => download(`${baseName}.diff.md`, renderXmlDiffMarkdown(result), 'text/markdown;charset=utf-8')}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Markdown
              </Button>
              {result.scope && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    download(`${baseName}.scope.diff.md`, renderXmlDiffMarkdown(result, { scopeOnly: true }), 'text/markdown;charset=utf-8')
                  }
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Markdown (in scope)
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-6 gap-2">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={`rounded-md border px-3 py-2 text-left transition-opacity ${STATUS[s].tile} ${statuses.has(s) ? '' : 'opacity-40'}`}
              >
                <div className={`text-2xl font-semibold tabular-nums ${STATUS[s].text}`}>{counts[s]}</div>
                <div className="text-xs text-muted-foreground">{STATUS[s].label}</div>
              </button>
            ))}
          </div>

          {result.folderMoves.length > 0 && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {result.folderMoves.map((m) => (
                <div key={`${m.from}>${m.to}`}>
                  Folder move: <span className="text-foreground">{m.from}</span> → <span className="text-foreground">{m.to}</span> ({m.searches})
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name, folder or model" className="h-9 pl-8 text-sm" />
            </div>
            {result.scope && (
              <div className="flex items-center gap-2">
                <Switch id="scope-only" checked={scopeOnly} onCheckedChange={setScopeOnly} />
                <Label htmlFor="scope-only" className="text-sm">In scope only</Label>
              </div>
            )}
            <span className="text-xs text-muted-foreground">{visible.length} shown</span>
          </div>

          <div className="grid grid-cols-[minmax(320px,2fr)_5fr] gap-4">
            <Card className="overflow-hidden">
              <div className="h-[70vh] overflow-y-auto">
                <EntryList entries={visible} selected={selected} onSelect={setSelected} />
              </div>
            </Card>
            <Card className="overflow-hidden">
              <div className="h-[70vh] overflow-y-auto">
                {selected ? (
                  <EntryDetail entry={selected} />
                ) : (
                  <div className="p-6 text-sm text-muted-foreground">Select a search to see what changed.</div>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function FilePicker({ label, value, onChange, files }: { label: string; value: string; onChange: (v: string) => void; files: XmlBlobFileSummary[] }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder="Select a shared XML file" />
        </SelectTrigger>
        <SelectContent>
          {files.map((f) => (
            <SelectItem key={f.pathname} value={f.pathname} className="text-sm">
              {f.fileName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EntryList({ entries, selected, onSelect }: { entries: SearchDiffEntry[]; selected: SearchDiffEntry | null; onSelect: (e: SearchDiffEntry) => void }) {
  if (!entries.length) return <div className="p-4 text-sm text-muted-foreground">No searches match the filters.</div>;
  return (
    <div className="py-1">
      {entries.map((e, i) => {
        const r = entryRef(e);
        const showHeader = i === 0 || entryRef(entries[i - 1]).folder !== r.folder;
        return (
          <div key={i}>
            {showHeader && (
              <div className="sticky top-0 z-10 bg-card/95 backdrop-blur px-3 pt-3 pb-1 text-[11px] font-medium text-muted-foreground border-b">
                {r.folder || '(root)'}
              </div>
            )}
            <button
              type="button"
              onClick={() => onSelect(e)}
              className={`w-full flex items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/50 ${selected === e ? 'bg-muted' : ''}`}
            >
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS[e.status].dot}`} title={STATUS[e.status].label} />
              <span className="min-w-0 flex-1">
                <span className="block line-clamp-2 break-words">{r.name}</span>
                {(e.moved || e.renamed) && e.status !== 'unchanged' && (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {e.renamed ? 'renamed' : ''}
                    {e.renamed && e.moved ? ' + ' : ''}
                    {e.moved ? 'moved' : ''}
                  </span>
                )}
              </span>
              {e.scope && (
                <span
                  className={`shrink-0 rounded px-1 text-[10px] font-medium ${e.scope === 'direct' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}
                  title={e.scopeTags?.join(', ')}
                >
                  {e.scope === 'direct' ? 'scope' : 'parent'}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function EntryDetail({ entry: e }: { entry: SearchDiffEntry }) {
  const r = entryRef(e);
  const groups = groupCodeChanges(e);
  return (
    <div className="p-5 space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${STATUS[e.status].dot}`} />
          <span className={`text-xs font-medium uppercase tracking-wide ${STATUS[e.status].text}`}>{STATUS[e.status].label}</span>
          {e.matchedBy && e.matchedBy !== 'path' && <span className="text-xs text-muted-foreground">· matched by {e.matchedBy}</span>}
          {e.dependents > 0 && <span className="text-xs text-muted-foreground">· {e.dependents} dependent searches</span>}
        </div>
        <h3 className="mt-1 text-lg font-semibold">{r.name}</h3>
        <div className="text-xs text-muted-foreground">{r.folder}</div>
        {e.scopeTags && e.scopeTags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {e.scopeTags.map((t) => (
              <span key={t} className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">
                {t}
              </span>
            ))}
          </div>
        )}
        {e.scope === 'ancestor' && <div className="mt-2 text-xs text-muted-foreground">Parent of an in-scope search.</div>}
      </div>

      {e.fieldChanges.length > 0 && (
        <Section title="Properties">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium" />
                <th className="py-1 pr-3 font-medium">Base</th>
                <th className="py-1 font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {e.fieldChanges.map((f) => (
                <tr key={f.field} className="border-b border-border/50 align-top">
                  <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{f.field}</td>
                  <td className="py-1.5 pr-3 text-red-600 dark:text-red-400 line-through decoration-red-400/50">{f.from ?? '—'}</td>
                  <td className="py-1.5 text-emerald-600 dark:text-emerald-400">{f.to ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {(e.status === 'modified' || e.status === 'moved' || e.status === 'renamed') && groups.length > 0 && (
        <Section title="Code changes">
          <div className="space-y-2">
            {groups.map((g) => (
              <CodeGroup key={g.cluster} cluster={g.cluster} added={g.added} removed={g.removed} />
            ))}
          </div>
        </Section>
      )}

      {e.codesChildrenChanged.length > 0 && (
        <Section title="Include-children changes">
          {e.codesChildrenChanged.map((c) => (
            <div key={c.code} className="text-xs">
              <code className="font-mono">{c.code}</code> {c.displayName}: {String(c.from)} → {String(c.to)}
            </div>
          ))}
        </Section>
      )}

      {(e.libraryItemsAdded.length > 0 || e.libraryItemsRemoved.length > 0) && (
        <Section title="Library items">
          {e.libraryItemsAdded.map((x) => (
            <div key={x} className="font-mono text-xs text-emerald-600 dark:text-emerald-400">+ {x}</div>
          ))}
          {e.libraryItemsRemoved.map((x) => (
            <div key={x} className="font-mono text-xs text-red-600 dark:text-red-400">− {x}</div>
          ))}
        </Section>
      )}

      {e.guidePatch && (
        <Section title="Logic changes (implementation guide)">
          <GuidePatch patch={e.guidePatch} />
        </Section>
      )}

      {e.status === 'modified' && !e.guidePatch && groups.length === 0 && e.fieldChanges.length === 0 && (
        <div className="text-xs text-muted-foreground">Structural change with no visible effect on the guide or codes.</div>
      )}

      {e.status === 'unchanged' && <div className="text-sm text-muted-foreground">No changes between the two files.</div>}

      {e.guide && (
        <Section title={e.status === 'added' ? 'New search' : 'Removed search'}>
          <div className={`rounded-md border-l-2 pl-4 ${e.status === 'added' ? 'border-emerald-500' : 'border-red-500'}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {e.guide}
            </ReactMarkdown>
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 border-b pb-1 text-sm font-semibold">{title}</h4>
      {children}
    </div>
  );
}

const CODE_PREVIEW = 15;

function CodeGroup({ cluster, added, removed }: { cluster: string; added: CodeRef[]; removed: CodeRef[] }) {
  const [open, setOpen] = useState(false);
  const rows = [...added.map((c) => ['+', c] as const), ...removed.map((c) => ['−', c] as const)];
  const shown = open ? rows : rows.slice(0, CODE_PREVIEW);
  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs">
        <span className="font-mono font-medium">{cluster}</span>
        <span className="text-emerald-600 dark:text-emerald-400">+{added.length}</span>
        <span className="text-red-600 dark:text-red-400">−{removed.length}</span>
      </div>
      <div className="divide-y divide-border/50">
        {shown.map(([sign, c]) => (
          <div
            key={`${sign}${c.excluded ? 'x' : ''}${c.code}`}
            className={`flex gap-2 px-3 py-1 text-xs ${sign === '+' ? 'bg-emerald-500/5' : 'bg-red-500/5'}`}
          >
            <span className={sign === '+' ? 'text-emerald-600' : 'text-red-600'}>{sign}</span>
            <code className="font-mono">{c.code}</code>
            <span className="min-w-0 flex-1 truncate">{c.displayName}</span>
            {c.isRefset && <span className="text-muted-foreground">refset</span>}
            {c.excluded && <span className="text-muted-foreground">exception</span>}
          </div>
        ))}
      </div>
      {rows.length > CODE_PREVIEW && (
        <button type="button" onClick={() => setOpen(!open)} className="w-full border-t px-3 py-1 text-left text-xs text-primary hover:bg-muted/30">
          {open ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

function GuidePatch({ patch }: { patch: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border text-[12px] leading-5 font-mono">
      {patch.split('\n').map((line, i) => {
        const cls = line.startsWith('+')
          ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
          : line.startsWith('-')
            ? 'bg-red-500/10 text-red-800 dark:text-red-300'
            : line.startsWith('@@')
              ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
              : 'text-foreground/70';
        return (
          <div key={i} className={`px-3 whitespace-pre-wrap break-words ${cls}`}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}
