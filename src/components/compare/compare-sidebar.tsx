'use client';

import { useEffect, useMemo, useRef } from 'react';
import { ArrowUpDown, FileJson, Folder, GitCompare, Loader2, Search, Upload, X } from 'lucide-react';
import { entryRef, type SearchDiffEntry } from '@/lib/xml-diff';
import { useCompare } from '@/contexts/CompareContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { STATUS, STATUS_ORDER, StatusBadge, plural } from '@/components/compare/status';
import { cn } from '@/lib/utils';

function FilePicker({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const { files } = useCompare();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-8 text-xs">
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

export function CompareControls() {
  const { basePath, targetPath, setBasePath, setTargetPath, swapFiles, scope, loadScopeFile, clearScope, runDiff, loading } = useCompare();
  const scopeInput = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2.5">
      <FilePicker id="compare-base" label="Older (base)" value={basePath} onChange={setBasePath} />
      <div className="flex justify-center">
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs text-muted-foreground" onClick={swapFiles} title="Swap older and newer">
          <ArrowUpDown className="h-3 w-3" />
          Swap
        </Button>
      </div>
      <FilePicker id="compare-target" label="Newer (target)" value={targetPath} onChange={setTargetPath} />

      <input
        ref={scopeInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadScopeFile(f);
          e.target.value = '';
        }}
      />
      {scope ? (
        <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs">
          <FileJson className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate font-medium">{scope.label}</span>
          <span className="shrink-0 text-muted-foreground">{plural(scope.count, 'search', 'searches')}</span>
          <button type="button" onClick={clearScope} className="ml-auto text-muted-foreground hover:text-foreground" title="Clear scope list">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => scopeInput.current?.click()}
          className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          title="JSON of {folder, name} rows, or the dbt mapping file. Marks searches you depend on and what they depend on."
        >
          <Upload className="h-3.5 w-3.5 shrink-0" />
          Scope list (optional)
        </button>
      )}

      <Button className="w-full" size="sm" onClick={runDiff} disabled={loading || !basePath || !targetPath || basePath === targetPath}>
        {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <GitCompare className="mr-1.5 h-4 w-4" />}
        {loading ? 'Comparing…' : 'Compare'}
      </Button>
      {basePath && basePath === targetPath && <p className="text-xs text-muted-foreground">Pick two different files.</p>}
    </div>
  );
}

/** Second line under a search: what kind of change it is */
function gist(e: SearchDiffEntry): string {
  if (e.status === 'unchanged') return e.upstreamChanges?.length ? 'Depends on a changed search' : '';
  if (e.status === 'added' || e.status === 'removed') return e.dependents ? plural(e.dependents, 'dependent search', 'dependent searches') : '';
  const fields = new Set(e.fieldChanges.map((f) => f.field));
  const parts = [
    e.guidePatch && 'logic',
    e.codeLists?.length && plural(e.codeLists.length, 'code list'),
    (fields.has('parent') || fields.has('populationCriteria')) && 'parent',
    (e.libraryItemsAdded.length || e.libraryItemsRemoved.length) && 'library items',
    fields.has('description') && 'description',
    e.renamed && 'renamed',
    e.moved && 'moved',
  ].filter(Boolean) as string[];
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function CompareChangeList() {
  const { result, visible, counts, statuses, toggleStatus, showAffected, setShowAffected, affectedCount, scopeOnly, setScopeOnly, query, setQuery, selected, select } =
    useCompare();
  const listRef = useRef<HTMLDivElement>(null);

  // Folder headers between runs of entries in the same folder
  const groups = useMemo(() => {
    const out: Array<{ folder: string; entries: SearchDiffEntry[] }> = [];
    for (const e of visible) {
      const folder = entryRef(e).folder;
      if (out.at(-1)?.folder !== folder) out.push({ folder, entries: [] });
      out.at(-1)!.entries.push(e);
    }
    return out;
  }, [visible]);

  const indexOf = useMemo(() => new Map(result?.entries.map((e, i) => [e, i])), [result]);

  // j / k move through the list when focus is not in a field
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t.closest('input, textarea, select, [role="combobox"], [role="listbox"]') || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const step = ev.key === 'j' ? 1 : ev.key === 'k' ? -1 : 0;
      if (!step || !visible.length) return;
      ev.preventDefault();
      const i = selected ? visible.indexOf(selected) : -1;
      select(visible[Math.max(0, Math.min(visible.length - 1, i + step))]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selected, select]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!result) return <div className="px-2 text-xs text-muted-foreground">Run a comparison to list changed searches here.</div>;

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name, folder, cluster or model" aria-label="Filter searches" className="h-8 pl-8 text-sm" />
      </div>
      <div className="flex flex-wrap gap-1">
        {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => toggleStatus(s)}
            aria-pressed={statuses.has(s)}
            title={STATUS[s].hint}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors',
              statuses.has(s) ? STATUS[s].badge : 'border-border text-muted-foreground hover:bg-muted/50'
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', STATUS[s].dot)} />
            {STATUS[s].label}
            <span className="tabular-nums opacity-80">{counts[s].toLocaleString()}</span>
          </button>
        ))}
        {affectedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAffected(!showAffected)}
            aria-pressed={showAffected}
            title="Unchanged searches that depend on a modified, added or removed search. Shown even when Unchanged is off."
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors',
              showAffected ? STATUS.modified.badge : 'border-border text-muted-foreground hover:bg-muted/50'
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full border border-amber-500" />
            Depends on a change
            <span className="tabular-nums opacity-80">{affectedCount.toLocaleString()}</span>
          </button>
        )}
      </div>
      {result.scope && (
        <div className="flex items-center gap-2 px-0.5">
          <Switch id="scope-only" checked={scopeOnly} onCheckedChange={setScopeOnly} />
          <Label htmlFor="scope-only" className="text-xs">
            In scope only ({result.scope.label})
          </Label>
        </div>
      )}
      <div className="flex justify-between px-2 text-xs text-muted-foreground">
        <span>{plural(visible.length, 'search', 'searches')}</span>
        <span title="Keyboard: j next, k previous">j / k to move</span>
      </div>

      <div ref={listRef} className="space-y-0.5 pr-1">
        {groups.map((g) => {
          const segments = g.folder ? g.folder.split(' > ') : ['(root)'];
          return (
            <div key={indexOf.get(g.entries[0])}>
              <div className="flex items-start gap-2 px-2 pb-0.5 pt-2" title={g.folder}>
                <Folder className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{segments.at(-1)}</div>
                  {segments.length > 1 && <div className="truncate text-[11px] text-muted-foreground">{segments.slice(0, -1).join(' › ')}</div>}
                </div>
                <Badge variant="secondary" className="h-5 text-xs">
                  {g.entries.length}
                </Badge>
              </div>
              {g.entries.map((e) => {
                const r = entryRef(e);
                const sub = gist(e);
                const isSelected = selected === e;
                return (
                  <button
                    key={indexOf.get(e)}
                    type="button"
                    data-selected={isSelected}
                    onClick={() => select(e)}
                    title={r.name}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-sm py-1.5 pl-8 pr-2 text-left text-sm transition-colors hover:bg-accent',
                      isSelected && 'bg-accent'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate', e.status === 'removed' && 'text-muted-foreground')}>{r.name}</span>
                      {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
                    </span>
                    {e.scope && (
                      <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] font-medium" title={e.scopeTags?.join(', ')}>
                        {e.scope === 'direct' ? 'scope' : 'dependency'}
                      </Badge>
                    )}
                    <StatusBadge status={e.status} />
                  </button>
                );
              })}
            </div>
          );
        })}
        {!visible.length && <div className="px-2 py-4 text-center text-sm text-muted-foreground">No searches match the filters.</div>}
      </div>
    </div>
  );
}
