'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { EquivalenceFilter } from '@/lib/types';

interface SettingsContextType {
  equivalenceFilter: EquivalenceFilter;
  setEquivalenceFilter: (filter: EquivalenceFilter) => void;
  primaryConceptMapVersion: string; // 'latest' or specific version like '2.1.4'
  setPrimaryConceptMapVersion: (version: string) => void;
  fallbackConceptMapVersion: string; // 'latest' or specific version like '7.1'
  setFallbackConceptMapVersion: (version: string) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const STORAGE_KEY = 'emis-xml-settings';

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [equivalenceFilter, setEquivalenceFilterState] = useState<EquivalenceFilter>('strict');
  const [primaryConceptMapVersion, setPrimaryConceptMapVersionState] = useState<string>('latest');
  const [fallbackConceptMapVersion, setFallbackConceptMapVersionState] = useState<string>('latest');

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const settings = JSON.parse(stored);
        if (settings.equivalenceFilter) {
          setEquivalenceFilterState(settings.equivalenceFilter);
        }
        // Support both old and new field names for backward compatibility
        if (settings.primaryConceptMapVersion) {
          setPrimaryConceptMapVersionState(settings.primaryConceptMapVersion);
        } else if (settings.conceptMapVersion) {
          setPrimaryConceptMapVersionState(settings.conceptMapVersion);
        }
        if (settings.fallbackConceptMapVersion) {
          setFallbackConceptMapVersionState(settings.fallbackConceptMapVersion);
        }
      }
    } catch (error) {
      console.error('Error loading settings from localStorage:', error);
    }
  }, []);

  // Save to localStorage whenever equivalence filter changes
  const setEquivalenceFilter = (filter: EquivalenceFilter) => {
    setEquivalenceFilterState(filter);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const settings = stored ? JSON.parse(stored) : {};
      settings.equivalenceFilter = filter;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving settings to localStorage:', error);
    }
  };

  // Save to localStorage whenever primary concept map version changes
  const setPrimaryConceptMapVersion = (version: string) => {
    setPrimaryConceptMapVersionState(version);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const settings = stored ? JSON.parse(stored) : {};
      settings.primaryConceptMapVersion = version;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving settings to localStorage:', error);
    }
  };

  // Save to localStorage whenever fallback concept map version changes
  const setFallbackConceptMapVersion = (version: string) => {
    setFallbackConceptMapVersionState(version);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const settings = stored ? JSON.parse(stored) : {};
      settings.fallbackConceptMapVersion = version;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving settings to localStorage:', error);
    }
  };

  return (
    <SettingsContext.Provider value={{
      equivalenceFilter,
      setEquivalenceFilter,
      primaryConceptMapVersion,
      setPrimaryConceptMapVersion,
      fallbackConceptMapVersion,
      setFallbackConceptMapVersion
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
