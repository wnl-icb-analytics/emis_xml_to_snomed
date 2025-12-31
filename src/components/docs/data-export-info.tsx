import { Database, FileText, Table } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function DataExportInfo() {
  return (
    <>
      {/* Overview */}
      <section>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Database className="h-5 w-5" />
          Overview
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-3">
          Both explore mode and extract mode generate normalised relational data tables that can be exported as CSV files.
          These tables are designed for easy import into data warehouses, SQL databases, or analytical tools.
        </p>
      </section>

      {/* Table Descriptions */}
      <section>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Table className="h-5 w-5" />
          Normalised Tables
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          The system generates six relational tables with proper foreign key relationships:
        </p>

        <div className="space-y-4">
          {/* Reports Table */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline">reports</Badge>
              <span className="text-xs text-muted-foreground">Parent table</span>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Contains metadata about each search report from the XML file.
            </p>
            <div className="text-xs font-mono bg-muted/50 p-2 rounded space-y-0.5">
              <div>• <strong>report_id</strong> - Unique identifier (deterministic hash)</div>
              <div>• <strong>report_xml_id</strong> - Original GUID from XML</div>
              <div>• <strong>report_name</strong> - Full report title</div>
              <div>• <strong>search_name</strong> - Short name from brackets</div>
              <div>• <strong>description</strong> - Optional report description</div>
              <div>• <strong>parent_type</strong> - Population type (ACTIVE/ALL/POP)</div>
              <div>• <strong>parent_report_id</strong> - XML ID of parent search (for POP type)</div>
              <div>• <strong>folder_path</strong> - Folder hierarchy from XML</div>
              <div>• <strong>xml_file_name</strong> - Source XML filename</div>
              <div>• <strong>parsed_at</strong> - Timestamp of parsing/expansion</div>
            </div>
          </div>

          {/* ValueSets Table */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline">valuesets</Badge>
              <span className="text-xs text-muted-foreground">Child of reports</span>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Contains metadata about each value set within a report.
            </p>
            <div className="text-xs font-mono bg-muted/50 p-2 rounded space-y-0.5">
              <div>• <strong>valueset_id</strong> - Unique identifier (hash of contents)</div>
              <div>• <strong>report_id</strong> - Foreign key to reports table</div>
              <div>• <strong>valueset_index</strong> - Position within report (0-based)</div>
              <div>• <strong>valueset_hash</strong> - Content hash for deduplication</div>
              <div>• <strong>valueset_friendly_name</strong> - Human-readable name</div>
              <div>• <strong>code_system</strong> - Primary code system used</div>
              <div>• <strong>expansion_error</strong> - Error message if expansion failed</div>
              <div>• <strong>expanded_at</strong> - Timestamp of expansion</div>
            </div>
          </div>

          {/* Original Codes Table */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline">original_codes</Badge>
              <span className="text-xs text-muted-foreground">Child of valuesets</span>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              The original codes from the XML, with translation results.
            </p>
            <div className="text-xs font-mono bg-muted/50 p-2 rounded space-y-0.5">
              <div>• <strong>original_code_id</strong> - Unique identifier</div>
              <div>• <strong>valueset_id</strong> - Foreign key to valuesets table</div>
              <div>• <strong>original_code</strong> - Code from XML (EMIS or SNOMED)</div>
              <div>• <strong>display_name</strong> - Display name from XML</div>
              <div>• <strong>code_system</strong> - Code system identifier</div>
              <div>• <strong>include_children</strong> - Whether to expand child concepts</div>
              <div>• <strong>is_refset</strong> - Whether code is a refset ID</div>
              <div>• <strong>translated_to_snomed_code</strong> - SNOMED code after translation</div>
              <div>• <strong>translated_to_display</strong> - Display name after translation</div>
            </div>
          </div>

          {/* Expanded Concepts Table */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline">expanded_concepts</Badge>
              <span className="text-xs text-muted-foreground">Child of valuesets</span>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              All SNOMED CT concepts resulting from expansion (the final usable concept list).
            </p>
            <div className="text-xs font-mono bg-muted/50 p-2 rounded space-y-0.5">
              <div>• <strong>concept_id</strong> - Unique identifier</div>
              <div>• <strong>valueset_id</strong> - Foreign key to valuesets table</div>
              <div>• <strong>snomed_code</strong> - SNOMED CT concept code</div>
              <div>• <strong>display</strong> - Preferred term for concept</div>
              <div>• <strong>source</strong> - Source of concept (rf2_file or terminology_server)</div>
              <div>• <strong>exclude_children</strong> - Whether child expansion is disabled for this concept</div>
              <div>• <strong>is_descendant</strong> - Whether concept is a descendant of parent codes</div>
            </div>
          </div>

          {/* Failed Codes Table */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline">failed_codes</Badge>
              <span className="text-xs text-muted-foreground">Child of valuesets</span>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Codes that couldn't be translated or expanded.
            </p>
            <div className="text-xs font-mono bg-muted/50 p-2 rounded space-y-0.5">
              <div>• <strong>failed_code_id</strong> - Unique identifier</div>
              <div>• <strong>valueset_id</strong> - Foreign key to valuesets table</div>
              <div>• <strong>original_code</strong> - Code that failed</div>
              <div>• <strong>display_name</strong> - Display name from XML</div>
              <div>• <strong>code_system</strong> - Code system identifier</div>
              <div>• <strong>reason</strong> - Failure reason</div>
            </div>
          </div>

          {/* Exceptions Table */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline">exceptions</Badge>
              <span className="text-xs text-muted-foreground">Child of valuesets</span>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Codes explicitly excluded from value sets (used with MINUS operator in ECL).
            </p>
            <div className="text-xs font-mono bg-muted/50 p-2 rounded space-y-0.5">
              <div>• <strong>exception_id</strong> - Unique identifier</div>
              <div>• <strong>valueset_id</strong> - Foreign key to valuesets table</div>
              <div>• <strong>excluded_code</strong> - SNOMED code to exclude</div>
            </div>
          </div>
        </div>
      </section>

      {/* Export Formats */}
      <section>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Export Options
        </h3>
        <div className="space-y-3">
          <div className="border-l-2 border-blue-500 pl-3">
            <p className="text-sm font-medium mb-1">Explore Mode</p>
            <p className="text-xs text-muted-foreground">
              Exports data for a single report as a ZIP file containing all six CSV tables. Each CSV includes
              proper headers and is ready for import into analytical tools.
            </p>
          </div>
          <div className="border-l-2 border-green-500 pl-3">
            <p className="text-sm font-medium mb-1">Extract Mode</p>
            <p className="text-xs text-muted-foreground">
              Exports data for multiple selected reports as a ZIP file. All reports are combined into the same
              six CSV tables, allowing batch analysis of many searches at once.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
