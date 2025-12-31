'use client';

import { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { loadParsedXmlData, clearParsedXmlData } from '@/lib/storage';
import {
  ChevronRight,
  Folder,
  FileText,
  Search,
  Home,
  ChevronDown,
  FolderOpen,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmisXmlDocument, EmisReport } from '@/lib/types';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { buildFolderTree, navigateToFolder, searchFolderTree, getFolderContents, countReportsInFolder, FolderNode } from '@/lib/folder-tree-utils';

// Using shared FolderNode interface from folder-tree-utils

export default function FolderTreeNavigation() {
  const [parsedData, setParsedData] = useState<EmisXmlDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadParsedXmlData()
      .then((minimalData) => {
        if (minimalData) {
          setParsedData(minimalData);
        }
      })
      .catch((error) => {
        console.error('Failed to load stored data:', error);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    const handleXmlParsed = (event: Event) => {
      const customEvent = event as CustomEvent<EmisXmlDocument>;
      setParsedData(customEvent.detail);
      setIsLoading(false);

      // Note: xml-uploader now handles saving to IndexedDB before dispatching this event
      // This ensures data is available immediately when components mount after mode switch

      setCurrentPath([]);
      setSelectedReportId(null);
      setExpandedFolders(new Set());
    };

    const handleXmlCleared = () => {
      setParsedData(null);
      setIsLoading(false);
      setCurrentPath([]);
      setSelectedReportId(null);
      setExpandedFolders(new Set());
      clearParsedXmlData().catch((error) => {
        console.error('Failed to clear stored data:', error);
      });
    };

    window.addEventListener('xml-parsed', handleXmlParsed);
    window.addEventListener('xml-cleared', handleXmlCleared);
    return () => {
      window.removeEventListener('xml-parsed', handleXmlParsed);
      window.removeEventListener('xml-cleared', handleXmlCleared);
    };
  }, []);

  const folderTree = useMemo(() => {
    if (!parsedData) return null;
    return buildFolderTree(parsedData.reports);
  }, [parsedData]);

  const currentNode = useMemo(() => {
    if (!folderTree) return null;
    return navigateToFolder(folderTree, currentPath);
  }, [folderTree, currentPath]);

  const filteredItems = useMemo(() => {
    if (!searchQuery || !folderTree) {
      // When not searching, show current folder contents
      if (!currentNode) return { folders: [], reports: [] };
      return getFolderContents(currentNode);
    }

    // Global search across entire tree using shared utility
    return searchFolderTree(folderTree, searchQuery);
  }, [folderTree, currentNode, searchQuery]);

  const handleReportClick = (report: EmisReport) => {
    console.log('Dispatching report-selected event:', report);
    setSelectedReportId(report.id);
    window.dispatchEvent(
      new CustomEvent('report-selected', { detail: report })
    );
  };

  const handleFolderClick = (folderPath: string) => {
    const fullPath = folderPath;
    if (expandedFolders.has(fullPath)) {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.delete(fullPath);
        return next;
      });
    } else {
      setExpandedFolders((prev) => new Set(prev).add(fullPath));
    }
  };

  const toggleFolder = (folderName: string) => {
    setCurrentPath([...currentPath, folderName]);
  };

  const navigateUp = () => {
    if (currentPath.length > 0) {
      setCurrentPath(currentPath.slice(0, -1));
    }
  };

  const renderFolderContents = (node: FolderNode, depth: number = 0) => {
    const { folders, reports } = getFolderContents(node);

    return (
      <div>
        {folders.map((folder) => {
          const folderPath = folder.pathSegments.join('/');
          const isExpanded = expandedFolders.has(folderPath);
          const reportCount = countReportsInFolder(folder);

          return (
            <div key={folderPath}>
              <div
                className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent transition-colors text-sm`}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={() => handleFolderClick(folderPath)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                )}
                {isExpanded ? (
                  <FolderOpen className="h-4 w-4 text-blue-500 flex-shrink-0" />
                ) : (
                  <Folder className="h-4 w-4 text-blue-500 flex-shrink-0" />
                )}
                <span className="flex-1 truncate">{folder.name}</span>
                <Badge variant="secondary" className="text-xs h-5">
                  {reportCount}
                </Badge>
              </div>
              {isExpanded && renderFolderContents(folder, depth + 1)}
            </div>
          );
        })}

        {reports.map((report) => (
          <TooltipProvider key={report.id} delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent transition-colors text-sm ${
                    selectedReportId === report.id ? 'bg-accent' : ''
                  }`}
                  style={{ paddingLeft: `${depth * 12 + 8 + 20}px` }}
                  onClick={() => handleReportClick(report)}
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="flex-1 truncate">{report.searchName}</span>
                  <Badge variant="outline" className="text-xs h-5">
                    {report.valueSets.length}
                  </Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-md">
                <p className="font-medium">{report.searchName}</p>
                {report.name !== report.searchName && (
                  <p className="text-xs text-muted-foreground mt-1">{report.name}</p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </div>
    );
  };

  // Don't show "No file loaded" while still loading from IndexedDB
  if (!parsedData && !isLoading) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground px-2">
          No file loaded
        </div>
      </div>
    );
  }

  // Show nothing while loading (search input will appear once data loads)
  if (isLoading) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      <Separator />

      <div className="text-xs text-muted-foreground px-2">
        {parsedData?.reports.length ?? 0} searches
      </div>

      <div className="space-y-0.5 overflow-y-auto pr-2">
        {searchQuery ? (
          <>
            {filteredItems.folders.map((folder) => (
              <div
                key={folder.pathSegments.join('/')}
                className="flex flex-col gap-0.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent transition-colors text-sm"
                onClick={() => handleFolderClick(folder.pathSegments.join('/'))}
              >
                <div className="flex items-center gap-2">
                  <Folder className="h-4 w-4 text-blue-500 flex-shrink-0" />
                  <span className="flex-1 truncate font-medium">{folder.name}</span>
                  <Badge variant="secondary" className="text-xs h-5">
                    {countReportsInFolder(folder)}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground pl-6 truncate">
                  {folder.pathSegments.join(' > ')}
                </div>
              </div>
            ))}
            {filteredItems.reports.map((report) => (
              <TooltipProvider key={report.id} delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`flex flex-col gap-0.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent transition-colors text-sm ${
                        selectedReportId === report.id ? 'bg-accent' : ''
                      }`}
                      onClick={() => handleReportClick(report)}
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="flex-1 truncate">{report.searchName}</span>
                        <Badge variant="outline" className="text-xs h-5">
                          {report.valueSets.length}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground pl-5 truncate">
                        {report.rule}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-md">
                    <p className="font-medium">{report.searchName}</p>
                    {report.name !== report.searchName && (
                      <p className="text-xs text-muted-foreground mt-1">{report.name}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">{report.rule}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
            {filteredItems.folders.length === 0 && filteredItems.reports.length === 0 && (
              <div className="text-sm text-muted-foreground px-2 py-4 text-center">
                No results found
              </div>
            )}
          </>
        ) : (
          folderTree && renderFolderContents(folderTree)
        )}
      </div>
    </div>
  );
}
