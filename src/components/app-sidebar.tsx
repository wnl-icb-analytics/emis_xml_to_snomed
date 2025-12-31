'use client';

import { useState } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import XmlUploader from '@/components/xml-uploader';
import FolderTreeNavigation from '@/components/folder-tree-navigation';
import BatchReportSelector from '@/components/batch-report-selector';
import { Separator } from '@/components/ui/separator';
import ModeToggle from '@/components/mode-toggle';
import { useAppMode } from '@/contexts/AppModeContext';
import { CodeExpansionDocs } from '@/components/code-expansion-docs';
import { SettingsDialog } from '@/components/settings-dialog';
import { HelpCircle, Settings } from 'lucide-react';

export function AppSidebar() {
  const { mode } = useAppMode();
  const [docsOpen, setDocsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <Sidebar collapsible="icon" style={{ '--sidebar-width': '28rem' } as React.CSSProperties}>
      <SidebarHeader>
        <div className="px-2 py-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold">EMIS XML Analyser</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                SNOMED CT Code Expansion
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSettingsOpen(true)}
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setDocsOpen(true)}
                title="View code expansion documentation"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <ModeToggle />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>XML File</SidebarGroupLabel>
          <SidebarGroupContent className="px-2">
            <XmlUploader />
          </SidebarGroupContent>
        </SidebarGroup>
        <Separator />
        <SidebarGroup>
          <SidebarGroupLabel>
            {mode === 'explore' ? 'Search Reports' : 'Select Reports'}
          </SidebarGroupLabel>
          <SidebarGroupContent className="px-2">
            {mode === 'explore' ? (
              <FolderTreeNavigation />
            ) : (
              <BatchReportSelector />
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <CodeExpansionDocs open={docsOpen} onOpenChange={setDocsOpen} />
    </Sidebar>
  );
}
