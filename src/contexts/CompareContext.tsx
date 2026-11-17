'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { XmlBlobFileSummary } from '@/lib/blob-xml';
import { entryRef, type SearchDiffEntry, type SearchDiffStatus, type XmlDiffResult } from '@/lib/xml-diff';
import { useAppMode } from '@/contexts/AppModeContext';
import { useToast } from '@/hooks/use-toast';

const SCOPE_STORAGE_KEY = 'compare-scope';
const CHANGED: SearchDiffStatus[] = ['modified', 'added', 'removed', 'moved', 'renamed'];

export interface StoredScope {
  label: string;
  json: unknown;
  count: number;
}

interface CompareContextValue {
  files: XmlBlobFileSummary[];
  basePath: string;
  targetPath: string;
  setBasePath: (p: string) => void;
  setTargetPath: (p: string) => void;
  swapFiles: () => void;
  scope: StoredScope | null;
  loadScopeFile: (file: File) => Promise<void>;
  clearScope: () => void;
  result: XmlDiffResult | null;
  loading: boolean;
  runDiff: () => Promise<void>;
  statuses: Set<SearchDiffStatus>;
  toggleStatus: (s: SearchDiffStatus) => void;
  scopeOnly: boolean;
  setScopeOnly: (v: boolean) => void;
  query: string;
  setQuery: (q: string) => void;
  /** Entries passing the status, scope and text filters, in folder order */
  visible: SearchDiffEntry[];
  /** Status counts, limited to in-scope searches when scopeOnly is on */
  counts: Record<SearchDiffStatus, number>;
  selected: SearchDiffEntry | null;
  select: (e: SearchDiffEntry | null) => void;
  selectByRef: (folder: string, name: string) => void;
}

const CompareContext = createContext<CompareContextValue | undefined>(undefined);

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const { mode } = useAppMode();
  const [files, setFiles] = useState<XmlBlobFileSummary[]>([]);
  const [basePath, setBasePath] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [scope, setScope] = useState<StoredScope | null>(null);
  const [result, setResult] = useState<XmlDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [statuses, setStatuses] = useState<Set<SearchDiffStatus>>(new Set(CHANGED));
  const [scopeOnly, setScopeOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SearchDiffEntry | null>(null);

  const loadFiles = useCallback(() => {
    fetch('/api/xml-files')
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.success || !Array.isArray(d.files)) throw new Error(d.error || `Server returned ${r.status}`);
        return d.files as XmlBlobFileSummary[];
      })
      .then((list) => {
        setFiles(list);
        // Keep choices that still exist; otherwise newest upload as target, next newest as base
        const keep = (p: string, fallback?: string) => (list.some((f) => f.pathname === p) ? p : fallback ?? '');
        setTargetPath((p) => keep(p, list[0]?.pathname));
        setBasePath((p) => keep(p, list[1]?.pathname));
      })
      .catch((error) =>
        toast({ variant: 'destructive', title: 'Shared files unavailable', description: error instanceof Error ? error.message : String(error) })
      );
  }, [toast]);

  // Load on first entry to compare mode, then refresh after uploads
  const active = mode === 'compare';
  useEffect(() => {
    if (!active) return;
    loadFiles();
    window.addEventListener('xml-parsed', loadFiles);
    return () => window.removeEventListener('xml-parsed', loadFiles);
  }, [active, loadFiles]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
      if (stored) setScope(JSON.parse(stored));
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

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
      const text = await res.text();
      let data: { success?: boolean; error?: string; data?: XmlDiffResult };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(res.status === 413 ? 'The diff is too large to return' : `Server returned ${res.status} ${res.statusText}`.trim());
      }
      if (!res.ok || !data.success || !data.data) throw new Error(data.error || 'Diff failed');
      setResult(data.data);
      setScopeOnly(!!data.data.scope);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Diff failed', description: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }, [basePath, targetPath, scope, toast]);

  const loadScopeFile = useCallback(
    async (file: File) => {
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
    },
    [toast]
  );

  const clearScope = useCallback(() => {
    setScope(null);
    localStorage.removeItem(SCOPE_STORAGE_KEY);
  }, []);

  const swapFiles = useCallback(() => {
    setBasePath(targetPath);
    setTargetPath(basePath);
  }, [basePath, targetPath]);

  const toggleStatus = useCallback(
    (s: SearchDiffStatus) =>
      setStatuses((prev) => {
        const next = new Set(prev);
        if (next.has(s)) next.delete(s);
        else next.add(s);
        return next;
      }),
    []
  );

  const visible = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    return result.entries.filter((e) => {
      const affected = scopeOnly && e.status === 'unchanged' && !!e.upstreamChanges?.length;
      if (!statuses.has(e.status) && !affected) return false;
      if (scopeOnly && !e.scope) return false;
      if (!q) return true;
      const hay = [e.base?.name, e.base?.folder, e.target?.name, e.target?.folder, ...(e.scopeTags ?? []), ...(e.codeLists ?? []).map((l) => l.cluster ?? '')]
        .join(' ')
        .toLowerCase();
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

  const selectByRef = useCallback(
    (folder: string, name: string) => {
      const hit = result?.entries.find((x) => entryRef(x).folder === folder && entryRef(x).name === name);
      if (hit) setSelected(hit);
    },
    [result]
  );

  const value: CompareContextValue = {
    files,
    basePath,
    targetPath,
    setBasePath,
    setTargetPath,
    swapFiles,
    scope,
    loadScopeFile,
    clearScope,
    result,
    loading,
    runDiff,
    statuses,
    toggleStatus,
    scopeOnly,
    setScopeOnly,
    query,
    setQuery,
    visible,
    counts,
    selected,
    select: setSelected,
    selectByRef,
  };
  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export function useCompare() {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error('useCompare must be used within a CompareProvider');
  return ctx;
}
