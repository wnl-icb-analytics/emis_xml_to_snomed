import { Network, ArrowRight, Database, CheckCircle2, FileText, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function RequestArchitecture() {
  return (
    <>
      {/* Request Architecture */}
      <section>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Network className="h-5 w-5" />
          Request Architecture
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          Each value set is expanded via a separate API request. This architecture is crucial for handling
          large XML files with many reports and value sets without hitting server-side timeouts.
        </p>

        <div className="space-y-3 ml-4">
          <div className="flex items-start gap-2">
            <ArrowRight className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Individual Value Set Requests</p>
              <p className="text-xs text-muted-foreground">
                When expanding a report, each value set within that report is expanded via a separate API call.
                The client makes sequential requests, waiting for each to complete before starting the next.
                This allows the application to handle very long-running extractions without server timeouts.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Database className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Client-Side Result Storage</p>
              <p className="text-xs text-muted-foreground">
                Results are stored in React state for immediate display during the extraction session. Each completed
                value set expansion is immediately available in the UI, providing progressive feedback as extraction
                proceeds. Note: Extraction results are not currently persisted to IndexedDB—only the parsed XML structure
                is saved locally.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">No Server-Side Timeouts</p>
              <p className="text-xs text-muted-foreground">
                Because each value set expansion is a separate, relatively quick request (typically a few seconds),
                the application can process hundreds of value sets across many reports without encountering
                server-side timeout limits that would occur with a single long-running request.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Extract Process */}
      <section>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Extract Process & Data Models
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          In extract mode, the system processes multiple reports and creates normalised data models suitable
          for export and analysis. Each report's value sets are expanded individually, and results are structured
          into relational tables.
        </p>

        <div className="space-y-3 ml-4">
          <div className="flex items-start gap-2">
            <Badge variant="outline" className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-0.5">
              1
            </Badge>
            <div>
              <p className="text-sm font-medium">Report Selection</p>
              <p className="text-xs text-muted-foreground">
                Users select one or more reports from the parsed XML. Each report contains multiple value sets
                that need expansion.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Badge variant="outline" className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-0.5">
              2
            </Badge>
            <div>
              <p className="text-sm font-medium">Sequential Value Set Expansion</p>
              <p className="text-xs text-muted-foreground">
                For each selected report, value sets are expanded one at a time via separate API requests.
                Each expansion follows the routing process described above (ConceptMap translation, refset detection,
                historical resolution, expansion).
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Badge variant="outline" className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-0.5">
              3
            </Badge>
            <div>
              <p className="text-sm font-medium">Normalised Data Model Creation</p>
              <p className="text-xs text-muted-foreground mb-2">
                Results are structured into six relational tables:
              </p>
              <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5 ml-2">
                <li><strong>Reports:</strong> Report metadata (ID, XML ID, name, search name, description, parent type, parent report ID, folder path)</li>
                <li><strong>ValueSets:</strong> Metadata for each value set (ID, hash, friendly name, code system, errors)</li>
                <li><strong>Original Codes:</strong> The original codes from XML with translation results</li>
                <li><strong>Expanded Concepts:</strong> All SNOMED concepts resulting from expansion</li>
                <li><strong>Failed Codes:</strong> Codes that couldn't be translated or expanded</li>
                <li><strong>Exceptions:</strong> Codes explicitly excluded from value sets</li>
              </ul>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Badge variant="outline" className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-0.5">
              4
            </Badge>
            <div>
              <p className="text-sm font-medium">Progressive Display & Export</p>
              <p className="text-xs text-muted-foreground">
                As each value set completes, results are immediately added to the normalised data tables.
                Users can view progress in real-time and export the complete dataset once all value sets are processed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Summary Flow */}
      <section>
        <h3 className="text-lg font-semibold mb-3">Summary Flow</h3>
        <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="shrink-0">EMIS Code</Badge>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground text-xs">ConceptMap</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground text-xs">Historical</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Badge variant="outline" className="shrink-0">Resolved Code</Badge>
          </div>
          <div className="flex items-center gap-2 ml-8">
            <ArrowRight className="h-4 w-4 text-muted-foreground rotate-90" />
          </div>
          <div className="flex items-center gap-2 ml-8">
            <span className="text-xs text-muted-foreground">Refset Detection (XML + RF2)</span>
          </div>
          <div className="flex items-center gap-2 ml-8">
            <ArrowRight className="h-4 w-4 text-muted-foreground rotate-90" />
          </div>
          <div className="flex items-center gap-2 ml-8">
            <Badge variant="secondary" className="shrink-0 text-xs">Is Refset?</Badge>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground text-xs">RF2 File OR ECL</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Badge variant="outline" className="shrink-0">Expanded Concepts</Badge>
          </div>
          <div className="flex items-center gap-2 ml-8 mt-2 pt-2 border-t border-border">
            <XCircle className="h-4 w-4 text-destructive" />
            <span className="text-xs text-muted-foreground">
              Codes not in final expansion → <strong>Failed Codes</strong>
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
