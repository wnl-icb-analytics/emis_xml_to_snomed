'use client';

import { useState, useEffect, useRef } from 'react';
import { EmisReport, ExpandedCodeSet, EmisXmlDocument } from '@/lib/types';
import CodeDisplay from '@/components/code-display';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, AlertCircle, XCircle, ArrowUpRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { hasParsedXmlData, loadParsedXmlData } from '@/lib/storage';
import { expandValueSet } from '@/lib/valueset-expansion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function ExploreMode() {
  const [selectedReport, setSelectedReport] = useState<EmisReport | null>(null);
  const [expandedData, setExpandedData] = useState<ExpandedCodeSet | null>(null);
  const [isExpanding, setIsExpanding] = useState(false);
  const [hasXmlLoaded, setHasXmlLoaded] = useState(false);
  const [isCheckingXml, setIsCheckingXml] = useState(true);
  const [allReports, setAllReports] = useState<EmisReport[]>([]);
  const cancellationRef = useRef(false);
  const [pendingReport, setPendingReport] = useState<EmisReport | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  // Check if XML is already loaded in IndexedDB on mount
  useEffect(() => {
    loadParsedXmlData().then((data: EmisXmlDocument | null) => {
      if (data) {
        setHasXmlLoaded(true);
        setAllReports(data.reports || []);
      }
      setIsCheckingXml(false);
    });
  }, []);

  const isExpandingRef = useRef(false);
  const selectedReportRef = useRef<EmisReport | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    isExpandingRef.current = isExpanding;
    selectedReportRef.current = selectedReport;
  }, [isExpanding, selectedReport]);

  useEffect(() => {
    const handleReportSelected = (event: Event) => {
      const customEvent = event as CustomEvent<EmisReport>;
      const newReport = customEvent.detail;
      console.log('Report selected event received:', newReport);
      
      // If expansion is in progress, show dialog to confirm cancellation
      if (isExpandingRef.current && selectedReportRef.current && selectedReportRef.current.id !== newReport.id) {
        setPendingReport(newReport);
        setShowCancelDialog(true);
      } else {
        // No expansion in progress, switch immediately
        setSelectedReport(newReport);
        setExpandedData(null);
      }
    };

    const handleXmlParsed = (event: Event) => {
      const customEvent = event as CustomEvent<EmisXmlDocument>;
      setHasXmlLoaded(true);
      setAllReports(customEvent.detail.reports || []);
      setSelectedReport(null);
      setExpandedData(null);
    };

    const handleXmlCleared = () => {
      setHasXmlLoaded(false);
      setAllReports([]);
      setSelectedReport(null);
      setExpandedData(null);
    };

    window.addEventListener('report-selected', handleReportSelected);
    window.addEventListener('xml-parsed', handleXmlParsed);
    window.addEventListener('xml-cleared', handleXmlCleared);

    return () => {
      window.removeEventListener('report-selected', handleReportSelected);
      window.removeEventListener('xml-parsed', handleXmlParsed);
      window.removeEventListener('xml-cleared', handleXmlCleared);
    };
  }, []);

  const handleExpandReport = async () => {
    if (!selectedReport) return;

    // Capture the report at the start to ensure we expand the correct one
    const reportToExpand = selectedReport;
    const reportId = reportToExpand.id;

    setIsExpanding(true);
    cancellationRef.current = false;

    try {
      // Initialize expandedData with empty valueSetGroups
      const initialData: ExpandedCodeSet = {
        featureId: reportToExpand.id,
        featureName: reportToExpand.name,
        concepts: [],
        totalCount: 0,
        sqlFormattedCodes: '',
        expandedAt: new Date().toISOString(),
        valueSetGroups: [],
      };
      setExpandedData(initialData);

      // Process each valueSet sequentially with separate API calls
      const allConcepts = new Map<string, any>();

      for (let vsIndex = 0; vsIndex < reportToExpand.valueSets.length; vsIndex++) {
        // Check if expansion was cancelled or if report has changed
        if (cancellationRef.current || selectedReport?.id !== reportId) {
          setIsExpanding(false);
          setExpandedData(null);
          return;
        }

        const vs = reportToExpand.valueSets[vsIndex];

        // Use shared utility to expand the ValueSet
        const result = await expandValueSet(
          reportToExpand.id,
          reportToExpand.name,
          vs,
          vsIndex
        );

        if (result.success && result.data && result.data.valueSetGroups) {
          // Add concepts to global map
          result.data.valueSetGroups[0]?.concepts.forEach((concept: any) => {
            if (!allConcepts.has(concept.code)) {
              allConcepts.set(concept.code, concept);
            }
          });

          // Update expandedData with this completed valueSet
          setExpandedData(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              valueSetGroups: [...(prev.valueSetGroups || []), result.data.valueSetGroups[0]],
              concepts: Array.from(allConcepts.values()),
              totalCount: allConcepts.size,
            };
          });
        }
      }

      // Final update with all concepts
      setExpandedData(prev => {
        if (!prev) return prev;
        const concepts = Array.from(allConcepts.values());
        return {
          ...prev,
          concepts,
          totalCount: concepts.length,
          sqlFormattedCodes: `(${concepts.map(c => `'${c.code}'`).join(', ')})`,
        };
      });

    } catch (err) {
      console.error('Expansion error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      // Only set error if we're still expanding the same report
      if (selectedReport?.id === reportId) {
        setExpandedData({
          featureId: reportToExpand.id,
          featureName: reportToExpand.name,
          concepts: [],
          totalCount: 0,
          sqlFormattedCodes: '',
          expandedAt: new Date().toISOString(),
          error: errorMessage,
        });
      }
    } finally {
      // Only clear expansion state if we're still on the same report
      if (selectedReport?.id === reportId) {
        setIsExpanding(false);
      }
      cancellationRef.current = false;
    }
  };

  const handleCancel = () => {
    cancellationRef.current = true;
    setIsExpanding(false);
    setExpandedData(null);
  };

  const handleConfirmSwitchReport = () => {
    // Cancel current expansion
    cancellationRef.current = true;
    setIsExpanding(false);
    setExpandedData(null);
    
    // Switch to new report
    if (pendingReport) {
      setSelectedReport(pendingReport);
      setExpandedData(null);
    }
    
    // Close dialog and clear pending
    setShowCancelDialog(false);
    setPendingReport(null);
  };

  const handleCancelSwitchReport = () => {
    // Keep current report, just close dialog
    setShowCancelDialog(false);
    setPendingReport(null);
  };

  // Empty state when no XML loaded (only show after checking)
  if (!isCheckingXml && !hasXmlLoaded) {
    return (
      <div className="flex items-center justify-center min-h-full p-6">
          <Card className="max-w-2xl w-full">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <FileText className="h-16 w-16 mx-auto text-muted-foreground" />
                <div>
                  <h2 className="text-2xl font-bold mb-2">Welcome to EMIS XML SNOMED Analyser</h2>
                  <p className="text-muted-foreground mb-4">
                    Get started by uploading an EMIS XML export file
                  </p>
                </div>
                <div className="text-left space-y-2 text-sm text-muted-foreground bg-muted/50 p-4 rounded-lg">
                  <h3 className="font-semibold text-foreground mb-2">How it works:</h3>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Upload your EMIS search export XML file using the sidebar</li>
                    <li>Browse the folder structure and select a search report</li>
                    <li>Expand codes to see SNOMED CT translations and child concepts</li>
                    <li>Export results as CSV or copy SQL-formatted code lists</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
      </div>
    );
  }

  // Instruction state when XML loaded but no report selected
  if (!selectedReport) {
    return (
      <div className="flex items-center justify-center min-h-full p-6">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground" />
                <div>
                  <h3 className="text-lg font-semibold mb-2">Select a search report</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose a report from the sidebar to view and expand its SNOMED codes
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
      </div>
    );
  }

  // Extract breadcrumb path from report.rule
  const getBreadcrumbs = () => {
    if (!selectedReport) return [];
    const segments = selectedReport.rule.split(' > ');
    // Skip the first segment (XML filename) and return the rest
    return segments.slice(1);
  };

  const breadcrumbs = getBreadcrumbs();

  // Report selected view
  return (
    <>
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Expansion in progress</AlertDialogTitle>
            <AlertDialogDescription>
              An expansion is currently running for "{selectedReport?.name}". 
              Do you want to cancel it and switch to "{pendingReport?.name}"?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelSwitchReport}>
              Continue expansion
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSwitchReport}>
              Cancel expansion and switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="p-6 space-y-6 w-full max-w-full min-w-0">
        {/* Breadcrumbs */}
        {breadcrumbs.length > 0 && (
          <nav className="flex flex-wrap text-sm text-muted-foreground">
            {breadcrumbs.map((segment, index) => (
              <div key={index} className="flex items-center">
                {index > 0 && <span className="mx-2">/</span>}
                <span className={index === breadcrumbs.length - 1 ? 'text-foreground font-medium' : ''}>
                  {segment}
                </span>
              </div>
            ))}
          </nav>
        )}

        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold truncate">{selectedReport.name}</h2>
          {selectedReport.searchName !== selectedReport.name && (
            <p className="text-sm text-muted-foreground mt-1">
              {selectedReport.searchName}
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            {selectedReport.valueSets.length} ValueSet{selectedReport.valueSets.length !== 1 ? 's' : ''}
          </p>
          {selectedReport.description && (
            <p className="text-sm text-foreground/70 mt-2 italic">
              {selectedReport.description}
            </p>
          )}
          {selectedReport.parentType && (
            <p className="text-sm text-muted-foreground mt-2">
              <span className="font-medium">Population:</span>{' '}
              {selectedReport.parentType === 'ACTIVE' && 'Currently registered patients'}
              {selectedReport.parentType === 'ALL' && 'All patients (including deducted and deceased)'}
              {selectedReport.parentType === 'POP' && selectedReport.parentReportId && (() => {
                console.log('Looking for parent report:', selectedReport.parentReportId);
                console.log('All reports xmlIds:', allReports.map(r => ({ xmlId: r.xmlId, name: r.searchName })));
                const parentReport = allReports.find(r => r.xmlId === selectedReport.parentReportId);
                console.log('Found parent report:', parentReport);

                if (parentReport) {
                  return (
                    <>
                      Based on{' '}
                      <button
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('report-selected', { detail: parentReport }));
                        }}
                        className="inline-flex items-center text-primary hover:underline font-medium cursor-pointer"
                      >
                        "{parentReport.searchName}"
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                      {' '}search results
                    </>
                  );
                } else {
                  return `Based on another search (${selectedReport.parentReportId})`;
                }
              })()}
            </p>
          )}
        </div>

        {/* Prominent expand card - only show before expansion starts */}
        {!expandedData && !isExpanding && (
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-1">Ready to expand SNOMED codes</h3>
                  <p className="text-sm text-muted-foreground max-w-xl">
                    This will query the terminology server to expand {selectedReport.valueSets.length === 1 ? 'the' : `all ${selectedReport.valueSets.length}`} ValueSet{selectedReport.valueSets.length !== 1 ? 's' : ''} and retrieve the complete list of SNOMED CT codes and their descriptions.
                  </p>
                </div>
                <Button
                  onClick={handleExpandReport}
                  size="lg"
                  className="text-base px-8 py-6 h-auto"
                >
                  Expand all codes
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {expandedData && (
          <>
            {expandedData.error ? (
              <Card className="border-destructive">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-destructive mb-1">Expansion Error</h3>
                      <p className="text-sm text-muted-foreground">{expandedData.error}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <CodeDisplay
                expandedCodes={expandedData}
                report={selectedReport}
                isExpanding={isExpanding}
                totalValueSets={selectedReport?.valueSets.length}
                onCancel={handleCancel}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
