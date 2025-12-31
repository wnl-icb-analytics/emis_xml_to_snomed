'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

// Import documentation components
import { XmlParsingOverview } from '@/components/docs/xml-parsing-overview';
import { XmlStructureExample } from '@/components/docs/xml-structure-example';
import { XmlParsingSteps } from '@/components/docs/xml-parsing-steps';
import { CodeExpansionOverview } from '@/components/docs/code-expansion-overview';
import { CodeExpansionSteps } from '@/components/docs/code-expansion-steps';
import { RequestArchitecture } from '@/components/docs/request-architecture';
import { DataExportInfo } from '@/components/docs/data-export-info';

interface CodeExpansionDocsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CodeExpansionDocs({ open, onOpenChange }: CodeExpansionDocsProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-full max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Documentation</DialogTitle>
          <DialogDescription className="text-base">
            How the system parses XML files and expands codes into SNOMED CT concepts
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="xml-parsing" className="w-full">
          <TabsList>
            <TabsTrigger value="xml-parsing">XML Parsing</TabsTrigger>
            <TabsTrigger value="code-expansion">Code Expansion</TabsTrigger>
            <TabsTrigger value="data-export">Data Export</TabsTrigger>
          </TabsList>

          <TabsContent value="xml-parsing" className="space-y-6 py-4 mt-4">
            <XmlParsingOverview />
            <Separator />
            <XmlStructureExample />
            <Separator />
            <XmlParsingSteps />
          </TabsContent>

          <TabsContent value="code-expansion" className="space-y-6 py-4 mt-4">
            <CodeExpansionOverview />
            <Separator />
            <CodeExpansionSteps />
            <Separator />
            <RequestArchitecture />
          </TabsContent>

          <TabsContent value="data-export" className="space-y-6 py-4 mt-4">
            <DataExportInfo />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
