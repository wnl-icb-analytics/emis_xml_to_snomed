'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Settings, PackageCheck, SlidersHorizontal, RotateCcw } from 'lucide-react';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ConceptMapVersion {
  id: string;
  version: string;
  status: string;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const {
    equivalenceFilter,
    setEquivalenceFilter,
    primaryConceptMapVersion,
    setPrimaryConceptMapVersion,
    fallbackConceptMapVersion,
    setFallbackConceptMapVersion
  } = useSettings();
  const { toast } = useToast();

  const [primaryVersions, setPrimaryVersions] = useState<ConceptMapVersion[]>([]);
  const [fallbackVersions, setFallbackVersions] = useState<ConceptMapVersion[]>([]);
  const [isLoadingPrimary, setIsLoadingPrimary] = useState(false);
  const [isLoadingFallback, setIsLoadingFallback] = useState(false);
  const [primaryError, setPrimaryError] = useState<string | null>(null);
  const [fallbackError, setFallbackError] = useState<string | null>(null);

  // Fetch available ConceptMap versions when dialog opens
  useEffect(() => {
    if (open) {
      // Fetch primary ConceptMap versions
      setIsLoadingPrimary(true);
      setPrimaryError(null);
      fetch('/api/terminology/concept-map-versions?type=primary')
        .then((res) => {
          if (!res.ok) {
            throw new Error(`Failed to fetch ConceptMap versions: ${res.status} ${res.statusText}`);
          }
          return res.json();
        })
        .then((data) => {
          if (data.versions) {
            setPrimaryVersions(data.versions);
            setPrimaryError(null);
          } else if (data.error) {
            throw new Error(data.error);
          }
        })
        .catch((err) => {
          console.error('Failed to fetch primary ConceptMap versions:', err);
          setPrimaryError(err instanceof Error ? err.message : 'Failed to fetch ConceptMap versions. Please check your internet connection.');
        })
        .finally(() => setIsLoadingPrimary(false));

      // Fetch fallback ConceptMap versions
      setIsLoadingFallback(true);
      setFallbackError(null);
      fetch('/api/terminology/concept-map-versions?type=fallback')
        .then((res) => {
          if (!res.ok) {
            throw new Error(`Failed to fetch ConceptMap versions: ${res.status} ${res.statusText}`);
          }
          return res.json();
        })
        .then((data) => {
          if (data.versions) {
            setFallbackVersions(data.versions);
            setFallbackError(null);
          } else if (data.error) {
            throw new Error(data.error);
          }
        })
        .catch((err) => {
          console.error('Failed to fetch fallback ConceptMap versions:', err);
          setFallbackError(err instanceof Error ? err.message : 'Failed to fetch ConceptMap versions. Please check your internet connection.');
        })
        .finally(() => setIsLoadingFallback(false));
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
        <div className="px-6 pt-6">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <Settings className="h-6 w-6" />
              Settings
            </DialogTitle>
            <DialogDescription>
              Configure code expansion and mapping options
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-6 py-4 px-6 overflow-y-auto">
          {/* ConceptMap Version Selection */}
          <div className="space-y-3">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <PackageCheck className="h-5 w-5" />
              ConceptMap Versions
            </h3>
            <p className="text-sm text-muted-foreground">
              Choose which versions of the EMIS→SNOMED ConceptMaps to use for code translation. "Latest" automatically uses the newest version available on the terminology server.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Primary ConceptMap (CodeID) */}
              <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
                <Label htmlFor="primary-version" className="font-medium">
                  CodeID ConceptMap
                </Label>
                {isLoadingPrimary ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading available versions...
                  </div>
                ) : (
                  <>
                    <Select
                      value={primaryConceptMapVersion}
                      onValueChange={(value) => {
                        setPrimaryConceptMapVersion(value);
                        toast({
                          title: 'Settings updated',
                          description: `CodeID ConceptMap version set to ${value === 'latest' ? 'Latest' : `v${value}`}`,
                        });
                      }}
                    >
                      <SelectTrigger id="primary-version" className="w-full">
                        <SelectValue placeholder="Select a version" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="latest">Latest (Recommended)</SelectItem>
                        {primaryVersions.length > 0 ? (
                          primaryVersions.filter(v => v.status === 'active').map((v) => (
                            <SelectItem key={v.id} value={v.version}>
                              v{v.version}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="latest" disabled>
                            No versions available
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {primaryError ? (
                      <div className="space-y-1">
                        <p className="text-xs text-amber-600 font-medium">
                          ⚠ Unable to fetch versions
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {primaryError.includes('internet') 
                            ? 'Using "Latest" will auto-resolve when online.'
                            : primaryError}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {primaryConceptMapVersion === 'latest'
                          ? 'Auto-resolves to latest version'
                          : `Using version ${primaryConceptMapVersion}`}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Fallback ConceptMap (DrugCodeID) */}
              <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
                <Label htmlFor="fallback-version" className="font-medium">
                  DrugCodeID ConceptMap
                </Label>
                {isLoadingFallback ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading available versions...
                  </div>
                ) : (
                  <>
                    <Select
                      value={fallbackConceptMapVersion}
                      onValueChange={(value) => {
                        setFallbackConceptMapVersion(value);
                        toast({
                          title: 'Settings updated',
                          description: `DrugCodeID ConceptMap version set to ${value === 'latest' ? 'Latest' : `v${value}`}`,
                        });
                      }}
                    >
                      <SelectTrigger id="fallback-version" className="w-full">
                        <SelectValue placeholder="Select a version" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="latest">Latest (Recommended)</SelectItem>
                        {fallbackVersions.length > 0 ? (
                          fallbackVersions.filter(v => v.status === 'active').map((v) => (
                            <SelectItem key={v.id} value={v.version}>
                              v{v.version}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="latest" disabled>
                            No versions available
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {fallbackError ? (
                      <div className="space-y-1">
                        <p className="text-xs text-amber-600 font-medium">
                          ⚠ Unable to fetch versions
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fallbackError.includes('internet')
                            ? 'Using "Latest" will auto-resolve when online.'
                            : fallbackError}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {fallbackConceptMapVersion === 'latest'
                          ? 'Auto-resolves to latest version'
                          : `Using version ${fallbackConceptMapVersion}`}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Separator */}
          <div className="border-t pt-6">
            {/* ConceptMap Equivalence Filter */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <SlidersHorizontal className="h-5 w-5" />
                ConceptMap Equivalence Filter
              </h3>
            <p className="text-sm text-muted-foreground">
              When translating EMIS codes to SNOMED CT, each mapping has an equivalence type that describes how well the concepts match. Choose which equivalence levels to accept:
            </p>
            <RadioGroup
              value={equivalenceFilter}
              onValueChange={(value) => {
                setEquivalenceFilter(value as any);
                const filterLabels: Record<string, string> = {
                  strict: 'Equivalent + Narrower',
                  'with-broader': 'Equivalent + Narrower + Broader',
                  'with-related': 'Equivalent + Narrower + Related-to',
                  all: 'All (including Inexact)',
                };
                toast({
                  title: 'Settings updated',
                  description: `Equivalence filter set to "${filterLabels[value] || value}"`,
                });
              }}
              className="space-y-2"
            >
              <div className="flex items-start space-x-2">
                <RadioGroupItem value="strict" id="strict" className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="strict" className="font-medium cursor-pointer">
                    Equivalent + Narrower (Recommended)
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    SNOMED code has the same meaning or is more specific. Safest option - preserves or adds clinical detail.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-2">
                <RadioGroupItem value="with-broader" id="with-broader" className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="with-broader" className="font-medium cursor-pointer">
                    + Broader
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    SNOMED code is less specific than EMIS code. Example: EMIS "Type 2 diabetes with retinopathy" maps to SNOMED "Type 2 diabetes". Increases coverage but loses detail.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-2">
                <RadioGroupItem value="with-related" id="with-related" className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="with-related" className="font-medium cursor-pointer">
                    + Related-to
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    SNOMED code is related but with different context. Example: EMIS "Influenza vaccination given by care home staff" maps to SNOMED "Influenza vaccination". Improves match rate, particularly for EMIS Local codes.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-2">
                <RadioGroupItem value="all" id="all" className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="all" className="font-medium cursor-pointer">
                    + Inexact (All)
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    SNOMED code is the best available match but not a good one. Maximum coverage, lowest confidence. Use with caution.
                  </p>
                </div>
              </div>
            </RadioGroup>
            </div>
          </div>
        </div>

        {/* Footer with Reset Button */}
        <div className="border-t px-6 py-4 flex justify-end">
          <Button
            variant="outline"
            onClick={() => {
              setEquivalenceFilter('strict');
              setPrimaryConceptMapVersion('latest');
              setFallbackConceptMapVersion('latest');
              toast({
                title: 'Settings reset',
                description: 'All settings have been reset to their default values.',
              });
            }}
            className="flex items-center gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reset to Defaults
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
