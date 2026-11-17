import type { CodeListChange, MatchMethod, SearchDiffStatus } from '@/lib/xml-diff';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Same palette as the rule cards' Include / Exclude / Next rule badges
const AMBER = 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/60 dark:text-amber-300 dark:border-amber-700';
const EMERALD = 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/60 dark:text-emerald-300 dark:border-emerald-700';
const RED = 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/60 dark:text-red-300 dark:border-red-700';
const SKY = 'bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-900/60 dark:text-sky-300 dark:border-sky-700';
const GRAY = 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600';

export const STATUS: Record<SearchDiffStatus, { label: string; badge: string; dot: string; text: string; hint: string }> = {
  modified: { label: 'Modified', badge: AMBER, dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', hint: 'Logic, codes or properties changed' },
  added: { label: 'Added', badge: EMERALD, dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', hint: 'Only in the newer file' },
  removed: { label: 'Removed', badge: RED, dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', hint: 'Only in the older file' },
  moved: { label: 'Moved', badge: SKY, dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400', hint: 'New folder, same logic' },
  renamed: { label: 'Renamed', badge: SKY, dot: 'bg-sky-400', text: 'text-sky-600 dark:text-sky-400', hint: 'New name, same logic' },
  unchanged: { label: 'Unchanged', badge: GRAY, dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', hint: 'Identical in both files' },
};

export const STATUS_ORDER: SearchDiffStatus[] = ['modified', 'added', 'removed', 'moved', 'renamed', 'unchanged'];

export const LIST_STATUS: Record<CodeListChange['status'], { label: string; badge: string }> = {
  changed: { label: 'Changed', badge: AMBER },
  added: { label: 'New', badge: EMERALD },
  removed: { label: 'Removed', badge: RED },
};

export const MATCH_LABEL: Record<MatchMethod, string> = {
  path: 'same folder and name',
  content: 'identical logic',
  'stable-ids': 'shared criteria IDs',
  name: 'same name',
  'similar-name': 'similar name and shared logic',
  codes: 'overlapping codes',
};

const BADGE = 'h-5 px-1.5 text-[10px] font-medium shrink-0';

export function StatusBadge({ status, className }: { status: SearchDiffStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(BADGE, STATUS[status].badge, className)}>
      {STATUS[status].label}
    </Badge>
  );
}

export function ListStatusBadge({ status, className }: { status: CodeListChange['status']; className?: string }) {
  return (
    <Badge variant="outline" className={cn(BADGE, LIST_STATUS[status].badge, className)}>
      {LIST_STATUS[status].label}
    </Badge>
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Card header bar matching the rule cards in Explore */
export function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 px-4 bg-gradient-to-r from-slate-700 to-slate-800 dark:from-slate-800 dark:to-slate-900 text-white rounded-t-xl">
      <span className="font-semibold text-sm">{title}</span>
      {children && <div className="flex items-center gap-2 text-xs text-slate-300">{children}</div>}
    </div>
  );
}
