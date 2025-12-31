'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { EquivalenceFilter } from '@/lib/types';

interface SettingsContextType {
  equivalenceFilter: EquivalenceFilter;
  setEquivalenceFilter: (filter: EquivalenceFilter) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const STORAGE_KEY = 'emis-xml-settings';

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [equivalenceFilter, setEquivalenceFilterState] = useState<EquivalenceFilter>('strict');

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const settings = JSON.parse(stored);
        if (settings.equivalenceFilter) {
          setEquivalenceFilterState(settings.equivalenceFilter);
        }
      }
    } catch (error) {
      console.error('Error loading settings from localStorage:', error);
    }
  }, []);

  // Save to localStorage whenever settings change
  const setEquivalenceFilter = (filter: EquivalenceFilter) => {
    setEquivalenceFilterState(filter);
    try {
      const settings = { equivalenceFilter: filter };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving settings to localStorage:', error);
    }
  };

  return (
    <SettingsContext.Provider value={{ equivalenceFilter, setEquivalenceFilter }}>
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
