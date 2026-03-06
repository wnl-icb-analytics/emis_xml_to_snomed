'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { upload } from '@vercel/blob/client';
import { Upload, FileText, Loader2, X, Cloud } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { parseEmisXml } from '@/lib/xml-parser';
import { Button } from '@/components/ui/button';
import { hasParsedXmlData, clearParsedXmlData, saveParsedXmlData, loadParsedXmlData } from '@/lib/storage';
import { buildMinimalParsedXmlData } from '@/lib/parsed-xml-session';
import { buildXmlBlobPath, type XmlBlobFileSummary } from '@/lib/blob-xml';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function XmlUploader() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [hasStoredData, setHasStoredData] = useState(false);
  const [blobFiles, setBlobFiles] = useState<XmlBlobFileSummary[]>([]);
  const [selectedBlobPath, setSelectedBlobPath] = useState<string>('');
  const [isLoadingBlobFiles, setIsLoadingBlobFiles] = useState(true);
  const [isLoadingSelectedBlob, setIsLoadingSelectedBlob] = useState(false);
  const { toast } = useToast();

  const refreshBlobFiles = useCallback(async () => {
    setIsLoadingBlobFiles(true);
    try {
      const response = await fetch('/api/xml-files');
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load shared XML files');
      }
      setBlobFiles(data.files || []);
    } catch (error) {
      console.error('Failed to refresh blob files:', error);
      toast({
        variant: 'destructive',
        title: 'Shared files unavailable',
        description: error instanceof Error ? error.message : 'Failed to load shared XML files',
      });
    } finally {
      setIsLoadingBlobFiles(false);
    }
  }, [toast]);

  // Check for stored data on mount and load filename
  useEffect(() => {
    hasParsedXmlData().then((hasData) => {
      setHasStoredData(hasData);
      if (hasData) {
        loadParsedXmlData().then((data) => {
          if (data && data.fileName) {
            setFileName(data.fileName);
          }
        });
      }
    });
    refreshBlobFiles();
  }, [refreshBlobFiles]);

  useEffect(() => {
    if (!fileName || selectedBlobPath) return;
    const matchingBlob = blobFiles.find((blobFile) => blobFile.fileName === fileName);
    if (matchingBlob) {
      setSelectedBlobPath(matchingBlob.pathname);
    }
  }, [blobFiles, fileName, selectedBlobPath]);

  // Listen for xml-parsed and xml-cleared events
  useEffect(() => {
    const handleXmlParsed = () => {
      setHasStoredData(true);
    };

    const handleXmlCleared = () => {
      setHasStoredData(false);
      setSelectedBlobPath('');
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
        const [xmlContent] = await Promise.all([
          file.text(),
          upload(buildXmlBlobPath(file.name), file, {
            access: 'private',
            handleUploadUrl: '/api/xml-files/upload',
            multipart: true,
          }),
        ]);
        const parsedData = await parseEmisXml(xmlContent);
        const minimalData = buildMinimalParsedXmlData(parsedData, file.name);

        await saveParsedXmlData(minimalData);
        setSelectedBlobPath(buildXmlBlobPath(file.name));
        await refreshBlobFiles();

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

  const handleSelectBlob = async (pathname: string) => {
    if (!pathname) return;

    setSelectedBlobPath(pathname);
    setIsLoadingSelectedBlob(true);

    try {
      const response = await fetch('/api/xml-files/load', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ pathname }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load selected XML file');
      }

      await saveParsedXmlData(data.data);
      setFileName(data.fileName);
      setHasStoredData(true);
      window.dispatchEvent(new CustomEvent('xml-parsed', { detail: data.data }));
      toast({
        title: 'Shared XML loaded',
        description: `Loaded ${data.fileName}`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to load XML',
        description: error instanceof Error ? error.message : 'Failed to load selected XML file',
      });
    } finally {
      setIsLoadingSelectedBlob(false);
    }
  };

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

  const activeLabel = isProcessing
    ? 'Uploading XML...'
    : isLoadingSelectedBlob
      ? 'Loading shared XML...'
      : fileName || 'No XML selected';

  const showStatusRow = isProcessing || isLoadingSelectedBlob;

  return (
    <div className="space-y-2.5">
      {showStatusRow && (
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/10 px-3 py-2">
          {isProcessing || isLoadingSelectedBlob ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
          ) : selectedBlobPath ? (
            <Cloud className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          ) : hasStoredData ? (
            <FileText className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          ) : (
            <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/85">
            {activeLabel}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Select value={selectedBlobPath} onValueChange={handleSelectBlob} disabled={isLoadingBlobFiles || isLoadingSelectedBlob}>
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder={isLoadingBlobFiles ? 'Loading shared files...' : 'Open shared XML file'} />
          </SelectTrigger>
          <SelectContent>
            {blobFiles.map((blobFile) => (
              <SelectItem key={blobFile.pathname} value={blobFile.pathname} className="text-sm">
                {blobFile.fileName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(fileName || hasStoredData) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={handleClear}
            title="Clear current file"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div
        {...getRootProps()}
        className={`
          rounded-md px-3 py-2 cursor-pointer transition-colors
          ${isDragActive ? 'border-primary bg-primary/10 text-primary' : 'border-primary/35 bg-primary/[0.04]'}
          ${isProcessing ? 'opacity-60 cursor-not-allowed' : 'hover:border-primary/55 hover:bg-primary/[0.07]'}
          border border-dashed
        `}
      >
        <input {...getInputProps()} />
        <div className="flex items-center gap-2">
          {isProcessing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
          ) : (
            <Upload className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          )}
          <span className={`text-xs ${isDragActive ? 'text-primary' : 'text-foreground/85'}`}>
            {isProcessing ? 'Uploading and parsing...' : isDragActive ? 'Drop XML to upload or replace' : hasStoredData ? 'Upload replacement XML' : 'Upload XML file'}
          </span>
          {fileName && !isProcessing && !isLoadingSelectedBlob && (
            <span className="ml-auto truncate text-[11px] text-muted-foreground">
              {fileName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
