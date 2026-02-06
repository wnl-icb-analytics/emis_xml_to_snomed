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
import { generateValueSetHash, generateValueSetFriendlyName, generateValueSetId } from '@/lib/valueset-utils';
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

      // Step 1: Build list of all ValueSets with their hashes
      interface ValueSetInstance {
        report: EmisReport;
        reportIndex: number;
        vsIndex: number;
        vs: any;
        hash: string;
        codes: string[];
      }
      
      const allInstances: ValueSetInstance[] = [];
      
      for (let reportIndex = 0; reportIndex < selectedReports.length; reportIndex++) {
        const report = selectedReports[reportIndex];
        
        // Add report row to reports table
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
          equivalence_filter_setting: equivalenceFilter,
          parsed_at: new Date().toISOString(),
        };
        normalizedData.reports.push(reportRow);
        
        for (let vsIndex = 0; vsIndex < report.valueSets.length; vsIndex++) {
          const vs = report.valueSets[vsIndex];
          const codes = vs.values.map((v: any) => v.code).sort();
          const hash = generateValueSetHash(codes);
          
          allInstances.push({
            report,
            reportIndex,
            vsIndex,
            vs,
            hash,
            codes,
          });
        }
      }

      // Step 2: Group by hash - only expand unique hashes
      // Also build hash->dedupIndex so identical code sets share the same _vs number
      const hashGroups = new Map<string, ValueSetInstance[]>();
      const hashToDedupIndex = new Map<string, number>();
      let dedupCounter = 0;
      for (const instance of allInstances) {
        if (!hashGroups.has(instance.hash)) {
          hashGroups.set(instance.hash, []);
          hashToDedupIndex.set(instance.hash, dedupCounter++);
        }
        hashGroups.get(instance.hash)!.push(instance);
      }

      const uniqueHashes = Array.from(hashGroups.keys());
      const totalUniqueValueSets = uniqueHashes.length;
      const totalInstanceCount = allInstances.length;
      
      console.log(`Deduplication: ${totalInstanceCount} ValueSet instances -> ${totalUniqueValueSets} unique code sets`);

      // Step 3: Expand unique hashes sequentially with 10ms gap to avoid overwhelming server
      const REQUEST_DELAY_MS = 10;
      const expandedByHash = new Map<string, any>(); // hash -> expansion result
      let completedCount = 0;

      for (const hash of uniqueHashes) {
        // Check cancellation
        if (cancellationRef.current) {
          setStatus('idle');
          setProcessingStatus(null);
          setIsExtracting(false);
          setContextIsExtracting(false);
          return;
        }

        // Update status
        setProcessingStatus({
          currentReport: completedCount + 1,
          totalReports: totalUniqueValueSets,
          reportName: `${totalInstanceCount} instances across ${totalReports} reports`,
          currentValueSet: completedCount + 1,
          totalValueSets: totalUniqueValueSets,
          message: `Expanding ValueSet ${completedCount + 1} of ${totalUniqueValueSets}`,
        });

        // Expand single ValueSet
        const instances = hashGroups.get(hash)!;
        const template = instances[0];

        let chunkResult: { hash: string; result: any; error: Error | undefined };
        try {
          const result = await expandValueSet(
            template.report.id,
            template.report.name,
            template.vs,
            0, // Index doesn't matter for expansion, only for naming
            equivalenceFilter
          );
          chunkResult = { hash, result, error: undefined };
        } catch (error) {
          chunkResult = { hash, result: null, error: error as Error };
        }

        const chunkResults = [chunkResult];

        // Check for serious errors
        for (const { hash, result, error } of chunkResults) {
          if (error) {
            const errorMessage = error.message || String(error);
            const isFhirApiError = (error as any).name === 'FhirApiError';
            const is404Error = isFhirApiError && (error as any).status === 404;

            // Detect different error categories
            const isTimeoutError = (
              errorMessage.toLowerCase().includes('timeout') ||
              errorMessage.includes('did not respond') ||
              errorMessage.includes('504') ||
              errorMessage.includes('408')
            );

            const isRateLimitError = (
              errorMessage.toLowerCase().includes('rate limit') ||
              errorMessage.includes('429')
            );

            const isServerError = (
              errorMessage.toLowerCase().includes('server error') ||
              errorMessage.includes('500') ||
              errorMessage.includes('502') ||
              errorMessage.includes('503')
            );

            const isNetworkError = (
              errorMessage.includes('Network error') ||
              errorMessage.includes('Unable to connect') ||
              errorMessage.includes('internet connection') ||
              errorMessage.toLowerCase().includes('fetch')
            );

            const isUnexpectedResponse = (
              errorMessage.toLowerCase().includes('unexpected response') ||
              errorMessage.toLowerCase().includes('failed to parse')
            );

            const isSeriousError = isTimeoutError || isRateLimitError || isServerError || isNetworkError || isUnexpectedResponse || (isFhirApiError && !is404Error);

            if (isSeriousError) {
              const instances = hashGroups.get(hash)!;
              console.error(`Error expanding ValueSet hash ${hash}:`, error);

              // Preserve original error message (which now has helpful context)
              throw new Error(errorMessage);
            } else if (is404Error) {
              console.warn(`ValueSet hash ${hash} returned 404 (code not found), continuing...`);
            } else {
              console.error(`Error expanding ValueSet hash ${hash}:`, error);
              throw error;
            }
          } else {
            expandedByHash.set(hash, result);
          }
        }

        // Update progress
        completedCount += 1;

        if (startTimeRef.current && completedCount > 0) {
          const elapsedSeconds = (Date.now() - startTimeRef.current) / 1000;
          const avgTimePerHash = elapsedSeconds / completedCount;
          const remainingHashes = totalUniqueValueSets - completedCount;

          if (remainingHashes > 0) {
            const estimatedSecondsRemaining = Math.ceil(remainingHashes * avgTimePerHash);
            setRemainingTime(Math.max(0, estimatedSecondsRemaining));
          } else {
            setRemainingTime(0);
          }
        }

        const totalProgress = (completedCount / totalUniqueValueSets) * 100;
        setProgress(Math.round(totalProgress));

        // Add delay between requests to avoid overwhelming the server
        if (completedCount < totalUniqueValueSets) {
          await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
        }
      }

      // Step 4: Propagate results to all instances that share each hash
      for (const instance of allInstances) {
        const result = expandedByHash.get(instance.hash);
        if (!result?.success || !result?.data?.valueSetGroups) continue;
        
        const templateGroup = result.data.valueSetGroups[0];
        if (!templateGroup) continue;

        // Use deduplicated index so identical code sets share the same _vs number
        const dedupIndex = hashToDedupIndex.get(instance.hash) ?? instance.vsIndex;
        const valueSetId = generateValueSetId(instance.report.id, instance.hash, dedupIndex);
        const friendlyName = generateValueSetFriendlyName(instance.report.name, dedupIndex);

        // Add valueset row
        normalizedData.valuesets.push({
          valueset_id: valueSetId,
          report_id: instance.report.id,
          valueset_index: dedupIndex,
          valueset_hash: instance.hash,
          valueset_friendly_name: friendlyName,
          code_system: templateGroup.originalCodes?.[0]?.codeSystem || '',
          ecl_expression: templateGroup.eclExpression || '',
          expansion_error: templateGroup.expansionError || '',
          expanded_at: result.data.expandedAt,
        });

        // Add original codes (shared across instances with same hash)
        templateGroup.originalCodes?.forEach((oc: any, idx: number) => {
          normalizedData.originalCodes.push({
            original_code_id: `${valueSetId}-oc${idx}`,
            valueset_id: valueSetId,
            original_code: oc.originalCode,
            display_name: oc.displayName,
            code_system: oc.codeSystem,
            include_children: oc.includeChildren || false,
            is_refset: oc.isRefset || false,
            translated_to_snomed_code: oc.translatedTo || '',
            translated_to_display: oc.translatedToDisplay || '',
          });
        });

        // Add expanded concepts (shared across instances with same hash)
        const parentCodesSet = new Set(templateGroup.parentCodes || []);
        templateGroup.concepts?.forEach((concept: any, idx: number) => {
          normalizedData.expandedConcepts.push({
            concept_id: `${valueSetId}-c${idx}`,
            valueset_id: valueSetId,
            snomed_code: concept.code,
            display: concept.display,
            source: concept.source || 'terminology_server',
            exclude_children: concept.excludeChildren || false,
            is_descendant: !parentCodesSet.has(concept.code),
          });
        });

        // Add failed codes
        templateGroup.failedCodes?.forEach((failed: any, idx: number) => {
          normalizedData.failedCodes.push({
            failed_code_id: `${valueSetId}-failed${idx}`,
            valueset_id: valueSetId,
            original_code: failed.originalCode,
            display_name: failed.displayName,
            code_system: failed.codeSystem,
            reason: failed.reason,
          });
        });

        // Add exceptions
        templateGroup.exceptions?.forEach((exception: any, excIdx: number) => {
          normalizedData.exceptions.push({
            exception_id: `${valueSetId}-exc${excIdx}`,
            valueset_id: valueSetId,
            original_excluded_code: exception.originalExcludedCode,
            translated_to_snomed_code: exception.translatedToSnomedCode || '',
            included_in_ecl: exception.includedInEcl || false,
            translation_error: exception.translationError || '',
          });
        });
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
                      <h3 className="font-semibold">Expanding Unique ValueSets</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Unique ValueSet {processingStatus.currentReport} of {processingStatus.totalReports} ({processingStatus.reportName})
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
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-destructive mb-1">Extraction Failed</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  {errorMessage || 'An error occurred while processing the reports. Please try again.'}
                </p>
                {/* Show helpful tips based on error type */}
                {errorMessage && (
                  <div className="bg-muted/50 rounded-md p-3 text-xs space-y-1">
                    {errorMessage.toLowerCase().includes('timeout') && (
                      <>
                        <p className="font-medium">Suggestions:</p>
                        <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                          <li>The terminology server may be overloaded - wait a few minutes and try again</li>
                          <li>Try selecting fewer reports to process at once</li>
                          <li>Large ValueSets with many codes take longer to expand</li>
                        </ul>
                      </>
                    )}
                    {errorMessage.toLowerCase().includes('rate limit') && (
                      <>
                        <p className="font-medium">Suggestions:</p>
                        <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                          <li>The server has temporarily blocked requests - wait 1-2 minutes</li>
                          <li>Processing will resume automatically if you try again</li>
                        </ul>
                      </>
                    )}
                    {(errorMessage.toLowerCase().includes('server error') || errorMessage.toLowerCase().includes('500')) && (
                      <>
                        <p className="font-medium">Suggestions:</p>
                        <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                          <li>The terminology server is experiencing issues</li>
                          <li>Try again in a few minutes</li>
                          <li>If the problem persists, check server status</li>
                        </ul>
                      </>
                    )}
                    {(errorMessage.toLowerCase().includes('network') || errorMessage.toLowerCase().includes('connect')) && (
                      <>
                        <p className="font-medium">Suggestions:</p>
                        <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                          <li>Check your internet connection</li>
                          <li>The terminology server may be unreachable</li>
                          <li>Try refreshing the page and starting again</li>
                        </ul>
                      </>
                    )}
                    {errorMessage.toLowerCase().includes('unexpected response') && (
                      <>
                        <p className="font-medium">Suggestions:</p>
                        <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                          <li>The server returned an invalid response</li>
                          <li>This may indicate server maintenance or a configuration issue</li>
                          <li>Try again in a few minutes</li>
                        </ul>
                      </>
                    )}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setStatus('idle');
                    setErrorMessage('');
                    setProgress(0);
                  }}
                >
                  Dismiss
                </Button>
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
