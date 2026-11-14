'use client';

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EmisReport } from '@/lib/types';
import { buildImplementationGuideMarkdown } from '@/lib/agent-report-utils';
import { slugifyFileName } from '@/lib/valueset-utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Copy, Check, Download } from 'lucide-react';

/** Markdown renderer styling — the project has no typography plugin */
export const markdownComponents = {
  h1: ({ children }: any) => <h1 className="text-xl font-bold mt-2 mb-3">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-base font-semibold mt-6 mb-2 pb-1.5 border-b">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-sm font-semibold mt-4 mb-1.5">{children}</h3>,
  p: ({ children }: any) => <p className="text-sm leading-6 mb-2 text-foreground/90">{children}</p>,
  ul: ({ children }: any) => <ul className="text-sm space-y-1 mb-3 ml-4 list-disc marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }: any) => <ol className="text-sm space-y-1 mb-3 ml-4 list-decimal marker:text-muted-foreground">{children}</ol>,
  li: ({ children }: any) => <li className="leading-6">{children}</li>,
  code: ({ children }: any) => (
    <code className="font-mono text-[12px] bg-muted px-1 py-0.5 rounded">{children}</code>
  ),
  strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
  table: ({ children }: any) => (
    <div className="overflow-x-auto mb-3">
      <table className="text-xs border-collapse w-full">{children}</table>
    </div>
  ),
  th: ({ children }: any) => (
    <th className="text-left font-semibold px-2 py-1.5 border-b bg-muted/50 whitespace-nowrap">{children}</th>
  ),
  td: ({ children }: any) => <td className="px-2 py-1.5 border-b border-border/50 align-top">{children}</td>,
};

interface ImplementationGuideViewProps {
  report: EmisReport;
  allReports: EmisReport[];
}

export function ImplementationGuideView({ report, allReports }: ImplementationGuideViewProps) {
  const [copied, setCopied] = useState(false);

  const markdown = useMemo(
    () => buildImplementationGuideMarkdown(report, allReports),
    [report, allReports],
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slugifyFileName(report.searchName)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="shadow-sm">
      <CardContent className="pt-4">
        <div className="flex items-center justify-end gap-2 mb-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4 mr-1 text-emerald-500" /> : <Copy className="h-4 w-4 mr-1" />}
            {copied ? 'Copied' : 'Copy markdown'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" />
            Download .md
          </Button>
        </div>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {markdown}
        </ReactMarkdown>
      </CardContent>
    </Card>
  );
}
