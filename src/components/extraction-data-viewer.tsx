'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { normalizedTableColumns } from '@/lib/normalized-table-columns';

interface NormalizedTables {
  reports: any[];
  valuesets: any[];
  originalCodes: any[];
  expandedConcepts: any[];
  failedCodes: any[];
  exceptions: any[];
}

interface ExtractionDataViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: NormalizedTables;
}

export function ExtractionDataViewer({ open, onOpenChange, data }: ExtractionDataViewerProps) {
  const [searchQueries, setSearchQueries] = useState({
    reports: '',
    valuesets: '',
    originalCodes: '',
    expandedConcepts: '',
    failedCodes: '',
    exceptions: '',
  });

  const filterRows = (rows: any[], query: string, searchFields: string[]) => {
    if (!query.trim()) return rows;
    const lowerQuery = query.toLowerCase();
    return rows.filter((row) =>
      searchFields.some((field) =>
        String(row[field] || '').toLowerCase().includes(lowerQuery)
      )
    );
  };

  const renderTable = (
    tableName: keyof NormalizedTables,
    columns: readonly { key: string; label: string }[],
    searchFields: string[],
    description: string
  ) => {
    const rows = data[tableName] || [];
    const filteredRows = filterRows(rows, searchQueries[tableName], searchFields);
    const MAX_VISIBLE_ROWS = 1000; // Limit to prevent browser freeze
    const isLimitedView = filteredRows.length > MAX_VISIBLE_ROWS;
    const displayRows = isLimitedView ? filteredRows.slice(0, MAX_VISIBLE_ROWS) : filteredRows;

    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{description}</p>

        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQueries[tableName]}
              onChange={(e) => setSearchQueries({ ...searchQueries, [tableName]: e.target.value })}
              className="pl-8 h-9"
            />
          </div>
          <div className="text-sm text-muted-foreground">
            {filteredRows.length === rows.length ? (
              <span>{rows.length} rows</span>
            ) : (
              <span>{filteredRows.length} / {rows.length} rows</span>
            )}
            {isLimitedView && (
              <Badge variant="secondary" className="ml-2">Showing first {MAX_VISIBLE_ROWS}</Badge>
            )}
          </div>
        </div>

        <div className="rounded-md border overflow-auto" style={{ maxHeight: '500px' }}>
          <Table className="min-w-max">
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col.key} className="font-semibold whitespace-nowrap">
                    {col.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                    {searchQueries[tableName] ? 'No matching rows found' : 'No data'}
                  </TableCell>
                </TableRow>
              ) : (
                displayRows.map((row, idx) => (
                  <TableRow key={idx}>
                    {columns.map((col) => {
                      let cellValue = row[col.key] ?? '-';
                      // Truncate ecl_expression to 20 characters
                      if (col.key === 'ecl_expression' && typeof cellValue === 'string' && cellValue.length > 20) {
                        cellValue = `${cellValue.substring(0, 20)}...`;
                      }
                      return (
                        <TableCell 
                          key={col.key} 
                          className="whitespace-nowrap"
                          title={col.key === 'ecl_expression' && row[col.key] ? row[col.key] : undefined}
                        >
                          {cellValue}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Extracted Data Tables</DialogTitle>
          <DialogDescription>
            View the normalized data tables generated from the extraction
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="reports" className="flex-1">
          <TabsList className="w-auto">
            <TabsTrigger value="reports" className="text-xs">
              Reports <Badge variant="secondary" className="ml-1 text-xs h-4">{data.reports.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="valuesets" className="text-xs">
              ValueSets <Badge variant="secondary" className="ml-1 text-xs h-4">{data.valuesets.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="originalCodes" className="text-xs">
              Original <Badge variant="secondary" className="ml-1 text-xs h-4">{data.originalCodes.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="expandedConcepts" className="text-xs">
              Expanded <Badge variant="secondary" className="ml-1 text-xs h-4">{data.expandedConcepts.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="failedCodes" className="text-xs">
              Failed <Badge variant="secondary" className="ml-1 text-xs h-4">{data.failedCodes.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="exceptions" className="text-xs">
              Exceptions <Badge variant="secondary" className="ml-1 text-xs h-4">{data.exceptions.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="reports" className="mt-4">
            {renderTable('reports', normalizedTableColumns.reports, ['report_name', 'search_name', 'folder_path'],
            'High-level information about each extracted report, including source file and folder path.')}
          </TabsContent>

          <TabsContent value="valuesets" className="mt-4">
            {renderTable('valuesets', normalizedTableColumns.valuesets, ['valueset_friendly_name', 'code_system', 'expansion_error'],
            'ValueSets extracted from each report. Each ValueSet contains a collection of codes to be expanded.')}
          </TabsContent>

          <TabsContent value="originalCodes" className="mt-4">
            {renderTable('originalCodes', normalizedTableColumns.originalCodes, ['original_code', 'display_name', 'translated_to_snomed_code'],
            'Original codes from the XML, including ConceptMap translations and historical resolution results.')}
          </TabsContent>

          <TabsContent value="expandedConcepts" className="mt-4">
            {renderTable('expandedConcepts', normalizedTableColumns.expandedConcepts, ['snomed_code', 'display'],
            'Expanded SNOMED CT concepts resulting from ECL queries and refset expansion (including descendants).')}
          </TabsContent>

          <TabsContent value="failedCodes" className="mt-4">
            {renderTable('failedCodes', normalizedTableColumns.failedCodes, ['original_code', 'display_name', 'reason'],
            'Codes that could not be translated or resolved, along with the reason for failure.')}
          </TabsContent>

          <TabsContent value="exceptions" className="mt-4">
            {renderTable('exceptions', normalizedTableColumns.exceptions, ['excluded_code'],
            'Codes explicitly excluded from ValueSets via exception rules in the XML.')}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
