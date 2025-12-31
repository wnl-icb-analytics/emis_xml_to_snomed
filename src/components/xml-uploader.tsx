'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Loader2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { parseEmisXml } from '@/lib/xml-parser';
import { Button } from '@/components/ui/button';
import { hasParsedXmlData, clearParsedXmlData, saveParsedXmlData, loadParsedXmlData } from '@/lib/storage';

export default function XmlUploader() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [hasStoredData, setHasStoredData] = useState(false);
  const { toast } = useToast();

  // Check for stored data on mount and load filename
  useEffect(() => {
    hasParsedXmlData().then((hasData) => {
      setHasStoredData(hasData);
      if (hasData) {
        // Load the stored data to get the filename
        loadParsedXmlData().then((data) => {
          if (data && data.fileName) {
            setFileName(data.fileName);
          }
        });
      }
    });
  }, []);

  // Listen for xml-parsed and xml-cleared events
  useEffect(() => {
    const handleXmlParsed = () => {
      setHasStoredData(true);
    };

    const handleXmlCleared = () => {
      setHasStoredData(false);
    };

    window.addEventListener('xml-parsed', handleXmlParsed);
    window.addEventListener('xml-cleared', handleXmlCleared);

    return () => {
      window.removeEventListener('xml-parsed', handleXmlParsed);
      window.removeEventListener('xml-cleared', handleXmlCleared);
    };
  }, []);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setFileName(file.name);
      setIsProcessing(true);

      try {
        // Parse XML client-side to avoid upload size limits
        const xmlContent = await file.text();
        const parsedData = await parseEmisXml(xmlContent);

        // Save to IndexedDB before dispatching event
        // This ensures data is available when components try to load it on mode switch
        const minimalData = {
          fileName: file.name,
          namespace: parsedData.namespace,
          parsedAt: parsedData.parsedAt,
          reports: parsedData.reports.map((report) => ({
            id: report.id,
            xmlId: report.xmlId,
            name: report.name,
            searchName: report.searchName,
            description: report.description,
            parentType: report.parentType,
            parentReportId: report.parentReportId,
            rule: report.rule,
            valueSets: report.valueSets.map((vs) => ({
              id: vs.id,
              codeSystem: vs.codeSystem,
              values: vs.values.map((v) => ({
                code: v.code,
                includeChildren: v.includeChildren,
                isRefset: v.isRefset,
                displayName: v.displayName && v.displayName !== v.code ? v.displayName : undefined,
              })),
              exceptions: vs.exceptions.map((e) => e.code),
            })),
          })),
        };

        await saveParsedXmlData(minimalData);

        window.dispatchEvent(
          new CustomEvent('xml-parsed', { detail: parsedData })
        );

        if (parsedData.reports.length === 0) {
          toast({
            variant: 'destructive',
            title: 'No Searches Found',
            description: `No valid searches found in ${file.name}`,
          });
        } else {
          toast({
            title: 'Success',
            description: `Loaded ${parsedData.reports.length} searches`,
          });
        }
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description:
            error instanceof Error
              ? error.message
              : 'Failed to parse XML file',
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [toast]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/xml': ['.xml'] },
    maxFiles: 1,
    disabled: isProcessing,
  });

  const handleClear = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setFileName(null);
    setHasStoredData(false);
    await clearParsedXmlData();
    window.dispatchEvent(new CustomEvent('xml-cleared'));
  };

  return (
    <div className="space-y-2">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-md p-3 text-center cursor-pointer
          transition-colors text-sm
          ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
          ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary hover:bg-accent/50'}
        `}
      >
        <input {...getInputProps()} />

        {isProcessing ? (
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Processing...</span>
          </div>
        ) : fileName || hasStoredData ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <FileText className="h-4 w-4 text-primary flex-shrink-0" />
              <span className="text-xs font-medium truncate">
                {fileName || 'Loaded from storage'}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={handleClear}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {isDragActive ? 'Drop XML file' : 'Upload XML'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
