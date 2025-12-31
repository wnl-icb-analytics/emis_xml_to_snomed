'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import CodeDisplay from './code-display';
import { Feature, ExpandedCodeSet } from '@/lib/types';
import { useSettings } from '@/contexts/SettingsContext';

interface FeatureItemProps {
  feature: Feature;
  isSelected: boolean;
  onToggle: () => void;
}

export default function FeatureItem({
  feature,
  isSelected,
  onToggle,
}: FeatureItemProps) {
  const { equivalenceFilter } = useSettings();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [expandedCodes, setExpandedCodes] = useState<ExpandedCodeSet | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const handleExpand = async () => {
    setIsExpanding(true);
    setError(null);

    try {
      // Collect parent codes and exceptions from valueSets
      const parentCodes: string[] = [];
      const includeChildren: boolean[] = [];
      const excludedCodes: string[] = [];

      feature.valueSets.forEach((vs) => {
        vs.values.forEach((v) => {
          console.log('Value from valueSet:', v);
          parentCodes.push(v.code);
          includeChildren.push(v.includeChildren);
        });
        vs.exceptions.forEach((e) => {
          excludedCodes.push(e.code);
        });
      });

      console.log('Collected parent codes:', parentCodes);

      const response = await fetch('/api/terminology/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          featureId: feature.id,
          featureName: feature.name,
          parentCodes,
          excludedCodes,
          includeChildren,
          equivalenceFilter,
        }),
      });

      const result = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to expand codes');
      }

      setExpandedCodes(result.data);
      setIsExpanded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to expand codes');
    } finally {
      setIsExpanding(false);
    }
  };

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center gap-3">
        <Checkbox
          id={feature.id}
          checked={isSelected}
          onCheckedChange={onToggle}
        />
        <Label
          htmlFor={feature.id}
          className="flex-1 cursor-pointer font-medium"
        >
          {feature.name}
        </Label>

        <Button
          variant="outline"
          size="sm"
          onClick={handleExpand}
          disabled={isExpanding}
        >
          {isExpanding ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Expanding...
            </>
          ) : (
            'Expand Codes'
          )}
        </Button>

        {expandedCodes && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      {error && (
        <div className="mt-2 text-sm text-destructive">Error: {error}</div>
      )}

      {isExpanded && expandedCodes && (
        <div className="mt-4">
          <CodeDisplay expandedCodes={expandedCodes} />
        </div>
      )}
    </div>
  );
}
