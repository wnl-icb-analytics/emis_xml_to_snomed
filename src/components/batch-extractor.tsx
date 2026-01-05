'use client';

import { useState, useEffect, useRef } from 'react';
import { useAppMode } from '@/contexts/AppModeContext';
import { useSettings } from '@/contexts/SettingsContext';
import { EmisReport, ExpandedCodeSet } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Package, Download, FileText, X, Loader2, CheckCircle2, AlertCircle, XCircle, Database } from 'lucide-react';
import { loadParsedXmlData } from '@/lib/storage';
import { ExtractionFileList } from '@/components/extraction-file-list';
import { ExtractionDataModel } from '@/components/extraction-data-model';
import { expandValueSet } from '@/lib/valueset-expansion';
import { formatTime, formatTimeNatural } from '@/lib/time-utils';
import { convertToCSV } from '@/lib/csv-utils';
import { ExtractionDataViewer } from '@/components/extraction-data-viewer';

interface ProcessingStatus {
  currentReport: number;
  totalReports: number;
  reportName: string;
  currentValueSet: number;
  totalValueSets: number;
  message: string;
}

interface NormalizedTables {
  reports: any[];
  valuesets: any[];
  originalCodes: any[];
  expandedConcepts: any[];
  failedCodes: any[];
  exceptions: any[];
}

export default function BatchExtractor() {
  const { selectedReportIds, toggleReportSelection, setIsExtracting: setContextIsExtracting } = useAppMode();
  const { equivalenceFilter } = useSettings();
  const [reports, setReports] = useState<EmisReport[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const cancellationRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'processing' | 'completed' | 'error'>('idle');
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [extractedData, setExtractedData] = useState<NormalizedTables | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [remainingTime, setRemainingTime] = useState<number | null>(null);
  const [totalTime, setTotalTime] = useState<number | null>(null);
  const [isCheckingXml, setIsCheckingXml] = useState(true);
  const [isDataViewerOpen, setIsDataViewerOpen] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const processingStatusRef = useRef<ProcessingStatus | null>(null);
  const selectedReportsRef = useRef<EmisReport[]>([]);

  // Load existing parsed data on mount
  useEffect(() => {
    loadParsedXmlData()
      .then((minimalData) => {
        if (minimalData && minimalData.reports) {
          setReports(minimalData.reports);
          setIsCheckingXml(false);
        } else {
          setIsCheckingXml(false);
        }
      })
      .catch((error) => {
        console.error('Failed to load stored data:', error);
        setReports([]);
        setIsCheckingXml(false);
      });
  }, []);

  useEffect(() => {
    const handleXmlParsed = (event: Event) => {
      const customEvent = event as CustomEvent;
      const parsedData = customEvent.detail;
      setReports(parsedData.reports || []);
    };

    const handleXmlCleared = () => {
      setReports([]);
      setStatus('idle');
      setProgress(0);
    };

    window.addEventListener('xml-parsed', handleXmlParsed);
    window.addEventListener('xml-cleared', handleXmlCleared);

    return () => {
      window.removeEventListener('xml-parsed', handleXmlParsed);
      window.removeEventListener('xml-cleared', handleXmlCleared);
    };
  }, []);

  const selectedReports = reports
    .filter((r) => selectedReportIds.has(r.id))
    .sort((a, b) => a.searchName.localeCompare(b.searchName));
  const totalValueSets = selectedReports.reduce((sum, r) => sum + r.valueSets.length, 0);

  // Reset status when selected reports change (allows new extraction)
  useEffect(() => {
    if (status === 'completed' && selectedReports.length > 0) {
      // Check if the selected reports have changed from what was extracted
      const currentReportIds = new Set(selectedReports.map(r => r.id));
      const extractedReportIds = extractedData?.reports.map(r => r.report_id) || [];
      const extractedSet = new Set(extractedReportIds);
      
      // If selection changed, reset to idle to allow new extraction
      const setsMatch = currentReportIds.size === extractedSet.size && 
        Array.from(currentReportIds).every(id => extractedSet.has(id));
      
      if (!setsMatch) {
        setStatus('idle');
        setExtractedData(null);
        setTotalTime(null);
      }
    }
  }, [selectedReports, status, extractedData]);

  // Update refs when state changes
  useEffect(() => {
    processingStatusRef.current = processingStatus;
  }, [processingStatus]);

  useEffect(() => {
    selectedReportsRef.current = selectedReports;
  }, [selectedReports]);

  // Timer effect - use refs to avoid recreating interval on every state change
  // Updates elapsed time and decrements remaining time every second
  useEffect(() => {
    if (status !== 'processing' || !startTimeRef.current) {
      return;
    }

    const interval = setInterval(() => {
      if (!startTimeRef.current) return;

      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedTime(elapsed);

      // Decrement remaining time by 1 second (it's recalculated when valuesets complete)
      setRemainingTime(prev => prev !== null && prev > 0 ? prev - 1 : prev);
    }, 1000);

    return () => clearInterval(interval);
  }, [status]); // Only depend on status, not processingStatus or selectedReports

  const handleExtract = async () => {
    if (selectedReports.length === 0) return;

    setIsExtracting(true);
    setContextIsExtracting(true);
    cancellationRef.current = false;
    setStatus('processing');
    setProgress(0);
    setErrorMessage('');
    const now = Date.now();
    setStartTime(now);
    startTimeRef.current = now;
    setElapsedTime(0);
    setRemainingTime(null);
    setTotalTime(null);

    const normalizedData: NormalizedTables = {
      reports: [],
      valuesets: [],
      originalCodes: [],
      expandedConcepts: [],
      failedCodes: [],
      exceptions: [],
    };

    let extractionCompleted = false;
    try {
      const totalReports = selectedReports.length;
      let completedReports = 0;

      for (const report of selectedReports) {
        // Check if extraction was cancelled
        if (cancellationRef.current) {
          setStatus('idle');
          setProcessingStatus(null);
          setIsExtracting(false);
          setContextIsExtracting(false);
          return;
        }
        completedReports++;
        const totalValueSets = report.valueSets.length;

        // Add report row to reports table (equivalence filter setting will be added after first ValueSet expansion)
        const reportRow = {
          report_id: report.id,
          report_xml_id: report.xmlId,
          report_name: report.name,
          search_name: report.searchName,
          description: report.description || '',
          parent_type: report.parentType || '',
          parent_report_id: report.parentReportId || '',
          folder_path: report.rule,
          xml_file_name: report.rule.split(' > ')[0] || 'unknown.xml',
          equivalence_filter_setting: equivalenceFilter, // Use current setting
          parsed_at: new Date().toISOString(),
        };
        normalizedData.reports.push(reportRow);

        // Process each ValueSet in the report
        let completedValueSets = 0;

        for (const [vsIndex, vs] of report.valueSets.entries()) {
          completedValueSets++;
          const valueSetStartTime = Date.now();

          setProcessingStatus({
            currentReport: completedReports,
            totalReports,
            reportName: report.searchName,
            currentValueSet: completedValueSets,
            totalValueSets,
            message: `Processing ValueSet ${completedValueSets} of ${totalValueSets}`,
          });

          // Check if extraction was cancelled before each API call
          if (cancellationRef.current) {
            setStatus('idle');
            setProcessingStatus(null);
            setIsExtracting(false);
            setContextIsExtracting(false);
            return;
          }

          try {
            // Use shared utility to expand the ValueSet
            const result = await expandValueSet(
              report.id,
              report.name,
              vs,
              vsIndex,
              equivalenceFilter
            );

            if (result.success && result.data && result.data.valueSetGroups) {
              const group = result.data.valueSetGroups[0];

              if (group) {
                // Add valueset row
                normalizedData.valuesets.push({
                  valueset_id: group.valueSetId,
                  report_id: report.id,
                  valueset_index: group.valueSetIndex,
                  valueset_hash: group.valueSetHash,
                  valueset_friendly_name: group.valueSetFriendlyName,
                  code_system: group.originalCodes?.[0]?.codeSystem || '',
                  ecl_expression: group.eclExpression || '',
                  expansion_error: group.expansionError || '',
                  expanded_at: result.data.expandedAt,
                });

                // Add original codes
                group.originalCodes?.forEach((oc: any, idx: number) => {
                  normalizedData.originalCodes.push({
                    original_code_id: `${group.valueSetId}-oc${idx}`,
                    valueset_id: group.valueSetId,
                    original_code: oc.originalCode,
                    display_name: oc.displayName,
                    code_system: oc.codeSystem,
                    include_children: oc.includeChildren || false,
                    is_refset: oc.isRefset || false,
                    translated_to_snomed_code: oc.translatedTo || '',
                    translated_to_display: oc.translatedToDisplay || '',
                  });
                });

                // Add expanded concepts
                group.concepts?.forEach((concept: any, idx: number) => {
                  normalizedData.expandedConcepts.push({
                    concept_id: `${group.valueSetId}-c${idx}`,
                    valueset_id: group.valueSetId,
                    snomed_code: concept.code,
                    display: concept.display,
                    source: concept.source || 'terminology_server', // Use actual source (rf2_file or terminology_server)
                    exclude_children: concept.excludeChildren || false,
                  });
                });

                // Add failed codes
                group.failedCodes?.forEach((failed: any, idx: number) => {
                  normalizedData.failedCodes.push({
                    failed_code_id: `${group.valueSetId}-failed${idx}`,
                    valueset_id: group.valueSetId,
                    original_code: failed.originalCode,
                    display_name: failed.displayName,
                    code_system: failed.codeSystem,
                    reason: failed.reason,
                  });
                });

                // Add exceptions (using data from API response with translation info)
                group.exceptions?.forEach((exception: any, excIdx: number) => {
                  normalizedData.exceptions.push({
                    exception_id: `${group.valueSetId}-exc${excIdx}`,
                    valueset_id: group.valueSetId,
                    original_excluded_code: exception.originalExcludedCode,
                    translated_to_snomed_code: exception.translatedToSnomedCode || '',
                    included_in_ecl: exception.includedInEcl || false,
                    translation_error: exception.translationError || '',
                  });
                });
              }
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // Import FhirApiError check (we'll need to add the import)
            const isFhirApiError = error instanceof Error && 
              (error as any).name === 'FhirApiError';
            const is404Error = isFhirApiError && (error as any).status === 404;
            
            // Check if this is a network error or other serious error (not 404)
            const isNetworkError = error instanceof Error && (
              errorMessage.includes('Network error') ||
              errorMessage.includes('timeout') ||
              errorMessage.includes('Unable to connect') ||
              errorMessage.includes('did not respond') ||
              errorMessage.includes('internet connection')
            );
            
            const isSeriousError = isNetworkError || (isFhirApiError && !is404Error);

            if (isSeriousError) {
              console.error(`Error expanding ValueSet ${vsIndex} in report ${report.name}:`, error);
              // For network errors and other serious API errors (401, 403, 5xx, etc.), stop the extraction
              // This prevents creating ValueSets with failed codes when there's a real error
              // 404 errors are acceptable (code not found) and should continue
              throw new Error(`Error while expanding ValueSet ${vsIndex + 1} in report "${report.name}": ${errorMessage}. Please check your connection and try again.`);
            } else if (is404Error) {
              // 404 errors are acceptable - code not found, continue with other ValueSets
              console.warn(`ValueSet ${vsIndex} in report ${report.name} returned 404 (code not found), continuing...`);
              // Continue processing other ValueSets
            } else {
              console.error(`Error expanding ValueSet ${vsIndex} in report ${report.name}:`, error);
              // For unexpected errors, also stop to be safe
              throw error;
            }
          }

          // Calculate remaining time based on overall average (total elapsed / completed valuesets)
          // This is more stable than rolling average and accounts for all valuesets, not just recent ones
          if (startTimeRef.current) {
            const elapsedSeconds = (Date.now() - startTimeRef.current) / 1000;
            const totalValueSetsCount = selectedReports.reduce((sum, r) => sum + r.valueSets.length, 0);

            // Calculate how many valuesets we've completed so far
            let completedValueSetsCount = 0;
            for (let i = 0; i < completedReports - 1; i++) {
              completedValueSetsCount += selectedReports[i]?.valueSets.length || 0;
            }
            completedValueSetsCount += completedValueSets; // Add completed valuesets in current report

            if (completedValueSetsCount > 0) {
              // Average time per valueset = total elapsed time / completed valuesets
              const avgTimePerValueSet = elapsedSeconds / completedValueSetsCount;
              const remainingValueSets = totalValueSetsCount - completedValueSetsCount;

              if (remainingValueSets > 0) {
                const estimatedSecondsRemaining = Math.ceil(remainingValueSets * avgTimePerValueSet);
                setRemainingTime(Math.max(0, estimatedSecondsRemaining));
              } else {
                setRemainingTime(0);
              }
            }
          }

          // Update progress
          const totalProgress = ((completedReports - 1) / totalReports + (completedValueSets / totalValueSets) / totalReports) * 100;
          setProgress(Math.round(totalProgress));
        }
      }

      setExtractedData(normalizedData);
      setProcessingStatus(null);
      // Store final elapsed time - calculate one final time to ensure accuracy using ref
      const finalTime = startTimeRef.current ? Math.floor((Date.now() - startTimeRef.current) / 1000) : (elapsedTime || 0);
      setTotalTime(finalTime);
      setStatus('completed');
      extractionCompleted = true;
    } catch (error) {
      if (!cancellationRef.current) {
        console.error('Batch extraction error:', error);
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'An unknown error occurred');
        setProcessingStatus(null);
      }
    } finally {
      setIsExtracting(false);
      setContextIsExtracting(false);
      cancellationRef.current = false;
      // Only clear timing if not completed (preserve totalTime for completed extractions)
      if (!extractionCompleted) {
        setStartTime(null);
        startTimeRef.current = null;
        setElapsedTime(0);
        setRemainingTime(null);
        setTotalTime(null);
      } else {
        // Clear these but keep totalTime
        setStartTime(null);
        startTimeRef.current = null;
        setElapsedTime(0);
        setRemainingTime(null);
      }
    }
  };

  const handleCancel = () => {
    cancellationRef.current = true;
    setStatus('idle');
    setProcessingStatus(null);
    setIsExtracting(false);
    setContextIsExtracting(false);
    setProgress(0);
    setStartTime(null);
    setElapsedTime(0);
    setRemainingTime(null);
  };

  const handleDownloadZIP = async () => {
    if (!extractedData) return;

    try {
      // Dynamic import of JSZip
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Add each CSV file to the ZIP
      if (extractedData.reports.length > 0) {
        zip.file('reports.csv', convertToCSV(extractedData.reports));
      }
      if (extractedData.valuesets.length > 0) {
        zip.file('valuesets.csv', convertToCSV(extractedData.valuesets));
      }
      if (extractedData.originalCodes.length > 0) {
        zip.file('original_codes.csv', convertToCSV(extractedData.originalCodes));
      }
      if (extractedData.expandedConcepts.length > 0) {
        zip.file('expanded_concepts.csv', convertToCSV(extractedData.expandedConcepts));
      }
      if (extractedData.failedCodes.length > 0) {
        zip.file('failed_codes.csv', convertToCSV(extractedData.failedCodes));
      }
      if (extractedData.exceptions.length > 0) {
        zip.file('exceptions.csv', convertToCSV(extractedData.exceptions));
      }

      // Generate ZIP file
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      // Download ZIP
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `emis-snomed-extract-${new Date().toISOString().split('T')[0]}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error creating ZIP:', error);
      alert('Failed to create ZIP file. Please try again.');
    }
  };

  // No XML loaded (only show after checking)
  if (!isCheckingXml && reports.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-full p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <h3 className="text-lg font-semibold mb-2">No XML File Loaded</h3>
                <p className="text-sm text-muted-foreground">
                  Upload an XML file from the sidebar to get started with batch extraction
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No reports selected
  if (selectedReports.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-full p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <Package className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <h3 className="text-lg font-semibold mb-2">No Reports Selected</h3>
                <p className="text-sm text-muted-foreground">
                  Select one or more reports from the sidebar to begin batch extraction
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 w-full max-w-full min-w-0">
      {/* Selected Reports & Extract Action */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Selected Reports</h2>
          <Badge variant="secondary">{selectedReports.length}</Badge>
        </div>

        <Card className={status === 'idle' ? 'bg-primary/5 border-primary/20' : 'border bg-muted/30'}>
          <CardContent className="pt-4">
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {selectedReports.map((report) => (
                <div
                  key={report.id}
                  className="flex items-start justify-between gap-3 p-2 rounded-md bg-background hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{report.searchName}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {report.valueSets.length} ValueSet{report.valueSets.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 flex-shrink-0"
                    onClick={() => toggleReportSelection(report.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            {status === 'idle' && (
              <div className="mt-4 pt-4 border-t flex flex-col items-center text-center space-y-3">
                <p className="text-sm text-foreground/80 max-w-2xl">
                  This will expand SNOMED codes for all selected reports and generate normalised tables ready for data warehouse import.
                </p>
                <Button
                  onClick={handleExtract}
                  disabled={isExtracting}
                  size="lg"
                  className="text-base px-8 py-6 h-auto [&_svg]:size-6"
                >
                  <Package className="mr-2" />
                  Extract All
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Processing Status */}
      {status === 'processing' && processingStatus && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Loader2 className="h-5 w-5 animate-spin text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">Extracting Reports</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Report {processingStatus.currentReport} of {processingStatus.totalReports}: {processingStatus.reportName}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {processingStatus.message}
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCancel}
                  className="gap-2 flex-shrink-0"
                >
                  <XCircle className="h-4 w-4" />
                  Cancel
                </Button>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Overall Progress</span>
                  <span className="text-xs font-medium">{Math.round(progress)}%</span>
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/20">
                  <div 
                    className="h-full bg-blue-600 dark:bg-blue-500 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                  <span>Elapsed: {formatTime(elapsedTime)}</span>
                  {remainingTime !== null && (
                    <span>Remaining: {formatTime(remainingTime)}</span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completed Status */}
      {status === 'completed' && extractedData && (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <div className="flex-1">
                  <h3 className="font-semibold text-green-900">Extraction Complete</h3>
                  <p className="text-sm text-green-700">
                    Successfully processed {selectedReports.length} reports
                    {totalTime !== null && totalTime >= 0 && (
                      <> in {formatTimeNatural(totalTime)}</>
                    )}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                <div className="bg-white/50 p-2 rounded">
                  <div className="text-xs text-muted-foreground">Reports</div>
                  <div className="font-semibold">{extractedData.reports.length}</div>
                </div>
                <div className="bg-white/50 p-2 rounded">
                  <div className="text-xs text-muted-foreground">ValueSets</div>
                  <div className="font-semibold">{extractedData.valuesets.length}</div>
                </div>
                <div className="bg-white/50 p-2 rounded">
                  <div className="text-xs text-muted-foreground">Expanded Concepts</div>
                  <div className="font-semibold">{extractedData.expandedConcepts.length}</div>
                </div>
                <div className="bg-white/50 p-2 rounded">
                  <div className="text-xs text-muted-foreground">Original Codes</div>
                  <div className="font-semibold">{extractedData.originalCodes.length}</div>
                </div>
                <div className="bg-white/50 p-2 rounded">
                  <div className="text-xs text-muted-foreground">Failed Codes</div>
                  <div className="font-semibold">{extractedData.failedCodes.length}</div>
                </div>
                <div className="bg-white/50 p-2 rounded">
                  <div className="text-xs text-muted-foreground">Exceptions</div>
                  <div className="font-semibold">{extractedData.exceptions.length}</div>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={handleDownloadZIP} variant="default">
                  <Download className="mr-2 h-4 w-4" />
                  Download ZIP Bundle
                </Button>
                <Button onClick={() => setIsDataViewerOpen(true)} variant="outline">
                  <Database className="mr-2 h-4 w-4" />
                  View Data
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error Status */}
      {status === 'error' && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-destructive mb-1">Extraction Failed</h3>
                <p className="text-sm text-muted-foreground">
                  {errorMessage || 'An error occurred while processing the reports. Please try again.'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card>
        <CardContent className="pt-6 p-0">
          <div className="divide-y divide-border">
            <div className="p-6">
              <ExtractionFileList />
            </div>
            <div className="p-6">
              <ExtractionDataModel />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Viewer Dialog */}
      {extractedData && (
        <ExtractionDataViewer
          open={isDataViewerOpen}
          onOpenChange={setIsDataViewerOpen}
          data={extractedData}
        />
      )}
    </div>
  );
}
