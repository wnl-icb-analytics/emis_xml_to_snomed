'use client';

import { useAppMode, type AppMode } from '@/contexts/AppModeContext';
import { Button } from '@/components/ui/button';
import { FolderTree, GitCompare, Package } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const MODES: Array<{ mode: AppMode; label: string; Icon: typeof FolderTree }> = [
  { mode: 'explore', label: 'Explore', Icon: FolderTree },
  { mode: 'extract', label: 'Extract', Icon: Package },
  { mode: 'compare', label: 'Compare', Icon: GitCompare },
];

export default function ModeToggle() {
  const { mode, setMode, isExtracting } = useAppMode();
  const { toast } = useToast();

  const handleModeChange = (newMode: AppMode) => {
    if (isExtracting && newMode !== mode) {
      toast({
        title: 'Extraction in progress',
        description: 'Please wait for the extraction to complete or cancel it before switching modes.',
        variant: 'destructive',
      });
      return;
    }
    setMode(newMode);
  };

  return (
    <div className="flex gap-1 p-1 bg-muted rounded-md">
      {MODES.map(({ mode: m, label, Icon }) => (
        <Button
          key={m}
          variant={mode === m ? 'default' : 'ghost'}
          size="sm"
          onClick={() => handleModeChange(m)}
          className="flex-1 gap-2"
          disabled={isExtracting && mode !== m}
        >
          <Icon className="h-4 w-4" />
          <span className="hidden sm:inline">{label}</span>
        </Button>
      ))}
    </div>
  );
}
