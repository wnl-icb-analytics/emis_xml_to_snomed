import { FileText, Code, Database, CheckCircle2, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function XmlParsingSteps() {
  return (
    <>
      {/* Step 1: Reading the XML Structure */}
      <section>
        <div className="flex items-start gap-3 mb-3">
          <Badge variant="outline" className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5">
            1
          </Badge>
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">Reading the XML Structure</h3>
            <p className="text-sm text-muted-foreground mb-3">
              We navigate through the XML hierarchy to extract the key components. The system reads the structure
              starting from the root <code className="text-xs bg-muted px-1 py-0.5 rounded">enquiryDocument</code> element
              and traverses down through folders, reports, and value sets.
            </p>
            <div className="space-y-2 ml-4">
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Report Folders</p>
                  <p className="text-xs text-muted-foreground">
                    We read the <code className="text-xs bg-muted px-1 py-0.5 rounded">reportFolder</code> hierarchy
                    to build the folder tree structure. Each folder can contain nested folders and reports.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Search Reports</p>
                  <p className="text-xs text-muted-foreground">
                    For each <code className="text-xs bg-muted px-1 py-0.5 rounded">report</code> element, we extract:
                    the XML ID (original GUID from <code className="text-xs bg-muted px-1 py-0.5 rounded">id</code>),
                    report name (from <code className="text-xs bg-muted px-1 py-0.5 rounded">name</code>),
                    search name (from brackets like <code className="text-xs bg-muted px-1 py-0.5 rounded">[Search Name]</code>),
                    description (optional), parent metadata (parentType and parentReportId for population tracking),
                    and navigate into the <code className="text-xs bg-muted px-1 py-0.5 rounded">population</code> structure
                    to find value sets.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Value Sets</p>
                  <p className="text-xs text-muted-foreground">
                    We traverse through <code className="text-xs bg-muted px-1 py-0.5 rounded">criteriaGroup</code> →
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">criteria</code> →
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">criterion</code> →
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">filterAttribute</code> →
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">columnValue</code> to find
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">valueSet</code> elements. Each value set
                    contains multiple <code className="text-xs bg-muted px-1 py-0.5 rounded">values</code> entries.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Step 2: Extracting Codes from Value Sets */}
      <section>
        <div className="flex items-start gap-3 mb-3">
          <Badge variant="outline" className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5">
            2
          </Badge>
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">Extracting Codes from Value Sets</h3>
            <p className="text-sm text-muted-foreground mb-3">
              For each <code className="text-xs bg-muted px-1 py-0.5 rounded">values</code> element within a value set,
              we read the code and its associated metadata.
            </p>
            <div className="space-y-2 ml-4">
              <div className="flex items-start gap-2">
                <Code className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Reading Code Values</p>
                  <p className="text-xs text-muted-foreground">
                    The code itself is read from the <code className="text-xs bg-muted px-1 py-0.5 rounded">value</code> element.
                    This is the SNOMED CT concept code or EMIS code that will be used for expansion.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Reading Metadata</p>
                  <p className="text-xs text-muted-foreground">
                    We also read the <code className="text-xs bg-muted px-1 py-0.5 rounded">displayName</code>,
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">includeChildren</code> flag (whether to expand
                    child concepts), and <code className="text-xs bg-muted px-1 py-0.5 rounded">isRefset</code> flag
                    (whether this is a refset ID that needs expansion).
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Filtering Values</p>
                  <p className="text-xs text-muted-foreground">
                    We skip certain placeholder values like status codes (ACTIVE, REVIEW, ENDED), empty values (N/A, None),
                    and specific SNOMED placeholder codes that aren't real concepts.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Step 3: Fast Client-Side Storage */}
      <section>
        <div className="flex items-start gap-3 mb-3">
          <Badge variant="outline" className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5">
            3
          </Badge>
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">Fast Client-Side Storage</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Once we've read and structured the XML data, we store it locally in your browser using IndexedDB.
              This allows for fast retrieval without re-parsing, and keeps all data secure on your device.
            </p>
            <div className="space-y-2 ml-4">
              <div className="flex items-start gap-2">
                <Database className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">IndexedDB for Large Files</p>
                  <p className="text-xs text-muted-foreground">
                    IndexedDB can handle very large files (50MB+) efficiently. Once parsed, the structured data
                    is stored here so it can be quickly retrieved when you switch between explore and extract modes,
                    or refresh the page. Since files are processed client-side, malicious content never reaches the server,
                    keeping the application secure from potential file upload attacks.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Deterministic IDs</p>
                  <p className="text-xs text-muted-foreground">
                    Each report gets a unique ID generated from its content (name, search name, folder path, value sets).
                    This ensures the same report always gets the same ID, making it easy to track and reference reports
                    across sessions.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Minimal Data Format</p>
                  <p className="text-xs text-muted-foreground">
                    Only essential data is stored: report IDs, names, descriptions, parent metadata, value set structures, and code metadata.
                    Full display names are preserved only when different from codes. This minimises storage size
                    while preserving all necessary information for code expansion.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
