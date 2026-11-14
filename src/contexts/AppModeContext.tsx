'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

export type AppMode = 'explore' | 'extract' | 'compare';

interface AppModeContextType {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  selectedReportIds: Set<string>;
  toggleReportSelection: (reportId: string) => void;
  selectAllReports: (reportIds: string[]) => void;
  deselectAllReports: () => void;
  isReportSelected: (reportId: string) => boolean;
  isExtracting: boolean;
  setIsExtracting: (isExtracting: boolean) => void;
}

const AppModeContext = createContext<AppModeContextType | undefined>(undefined);

export function AppModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AppMode>('explore');
  const [selectedReportIds, setSelectedReportIds] = useState<Set<string>>(new Set());
  const [isExtracting, setIsExtracting] = useState(false);

  const toggleReportSelection = useCallback((reportId: string) => {
    // Prevent selection changes during extraction
    if (isExtracting) {
      return;
    }
    setSelectedReportIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(reportId)) {
        newSet.delete(reportId);
      } else {
        newSet.add(reportId);
      }
      return newSet;
    });
  }, [isExtracting]);

  const selectAllReports = useCallback((reportIds: string[]) => {
    // Prevent selection changes during extraction
    if (isExtracting) {
      return;
    }
    setSelectedReportIds(new Set(reportIds));
  }, [isExtracting]);

  const deselectAllReports = useCallback(() => {
    // Prevent selection changes during extraction
    if (isExtracting) {
      return;
    }
    setSelectedReportIds(new Set());
  }, [isExtracting]);

  const isReportSelected = useCallback((reportId: string) => {
    return selectedReportIds.has(reportId);
  }, [selectedReportIds]);

  const handleSetMode = useCallback((newMode: AppMode) => {
    // Prevent mode switching during extraction
    if (isExtracting) {
      return;
    }
    setMode(newMode);
    // Clear selections when switching to explore mode
    if (newMode === 'explore') {
      setSelectedReportIds(new Set());
    }
  }, [isExtracting]);

  return (
    <AppModeContext.Provider
      value={{
        mode,
        setMode: handleSetMode,
        selectedReportIds,
        toggleReportSelection,
        selectAllReports,
        deselectAllReports,
        isReportSelected,
        isExtracting,
        setIsExtracting,
      }}
    >
      {children}
    </AppModeContext.Provider>
  );
}

export function useAppMode() {
  const context = useContext(AppModeContext);
  if (context === undefined) {
    throw new Error('useAppMode must be used within an AppModeProvider');
  }
  return context;
}
