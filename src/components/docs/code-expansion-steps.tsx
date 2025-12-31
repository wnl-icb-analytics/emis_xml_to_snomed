import { ArrowRight, CheckCircle2, AlertCircle, Database, Code, FileText, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function CodeExpansionSteps() {
  return (
    <>
      {/* Step 1: ConceptMap Translation */}
      <section>
        <div className="flex items-start gap-3 mb-3">
          <Badge variant="outline" className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5">
            1
          </Badge>
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">ConceptMap Translation</h3>
            <p className="text-sm text-muted-foreground mb-3">
              All codes are first attempted to be translated from EMIS to SNOMED CT using FHIR ConceptMap resources.
              The system automatically queries the terminology server for the latest active version of each ConceptMap,
              then tries a primary map, and if that fails, falls back to a secondary map specifically for drug codes.
            </p>

            <div className="space-y-2 ml-4">
              <div className="flex items-start gap-2">
                <ArrowRight className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Primary ConceptMap</p>
                  <p className="text-xs text-muted-foreground">
                    Canonical URL: <code className="text-xs bg-muted px-1 py-0.5 rounded">http://LDS.nhs/EMIStoSNOMED/CodeID/cm</code>
                    <br />
                    EMIS to SNOMED CodeID mapping (latest active version automatically resolved)
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <ArrowRight className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Fallback ConceptMap</p>
                  <p className="text-xs text-muted-foreground">
                    Canonical URL: <code className="text-xs bg-muted px-1 py-0.5 rounded">http://LDS.nhs/EMIS_to_Snomed/DrugCodeID/cm</code>
                    <br />
                    DrugCodeID fallback for drug codes (latest active version automatically resolved)
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 mt-3">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Equivalence Filtering</p>
                  <p className="text-xs text-muted-foreground">
                    Only accepts mappings with equivalence <code className="text-xs bg-muted px-1 py-0.5 rounded">equivalent</code> or <code className="text-xs bg-muted px-1 py-0.5 rounded">narrower</code>.
                    Rejects <code className="text-xs bg-muted px-1 py-0.5 rounded">broader</code> or <code className="text-xs bg-muted px-1 py-0.5 rounded">related</code> mappings.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 mt-2">
                <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Translation Failure</p>
                  <p className="text-xs text-muted-foreground">
                    If both ConceptMaps fail (404 not found, wrong equivalence, or other error), the code proceeds to
                    refset detection and historical resolution. It may be a refset in RF2, or assumed to be an
                    already-valid SNOMED CT concept.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Step 2: Historical Resolution */}
      <section>
        <div className="flex items-start gap-3 mb-3">
          <Badge variant="outline" className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5">
            2
          </Badge>
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">Historical Concept Resolution</h3>
            <p className="text-sm text-muted-foreground mb-3">
              All SNOMED CT codes (whether translated, original, or detected as refsets) are checked against the
              terminology server to resolve historical/inactive concepts to their current active equivalents.
            </p>
            <div className="space-y-2 ml-4">
              <div className="flex items-start gap-2">
                <Database className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">FHIR $lookup Operation</p>
                  <p className="text-xs text-muted-foreground">
                    Uses FHIR <code className="text-xs bg-muted px-1 py-0.5 rounded">$lookup</code> operation to find
                    the current concept ID and display name for historical concepts.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Applied to All Codes</p>
                  <p className="text-xs text-muted-foreground">
                    This step happens for ALL codes regardless of whether they were translated by ConceptMap or not.
                    Even refset IDs detected from RF2 files go through historical resolution.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Step 3: Refset Detection */}
      <section>
        <div className="flex items-start gap-3 mb-3">
          <Badge variant="outline" className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5">
            3
          </Badge>
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">Refset Detection</h3>
            <p className="text-sm text-muted-foreground mb-3">
              The system identifies which codes are refsets that need special handling through two methods:
            </p>
            <div className="space-y-3 ml-4">
              <div className="border-l-2 border-blue-500 pl-3">
                <p className="text-sm font-medium mb-1">From XML Metadata</p>
                <p className="text-xs text-muted-foreground">
                  Codes marked with <code className="text-xs bg-muted px-1 py-0.5 rounded">isRefset=true</code> in the XML
                  are identified as refsets.
                </p>
              </div>
              <div className="border-l-2 border-orange-500 pl-3">
                <p className="text-sm font-medium mb-1">RF2 Fallback Detection</p>
                <p className="text-xs text-muted-foreground">
                  Codes that failed ConceptMap translation are checked against local RF2 refset files. If found,
                  they're marked as refsets and will be expanded from RF2 files.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Step 4: Refset Expansion */}
      <section>
        <div className="flex items-start gap-3 mb-3">
          <Badge variant="outline" className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5">
            4
          </Badge>
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">Refset Expansion</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Refsets are expanded to retrieve their member concepts using a prioritized approach.
            </p>

            <div className="space-y-3 ml-4">
              <div className="border-l-2 border-blue-500 pl-3">
                <p className="text-sm font-medium mb-1">Primary: RF2 File Expansion</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Refsets are first checked against local RF2 Simple Refset files on the server file system.
                  If found, members are loaded directly from the file for fast, reliable expansion.
                </p>
                <div className="space-y-1 mt-2">
                  <div className="flex items-start gap-2">
                    <FileText className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      Display names are loaded from RF2 Description files (UK Primary Care concepts)
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Database className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      Missing display names are fetched from terminology server (standard SNOMED concepts)
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-l-2 border-orange-500 pl-3">
                <p className="text-sm font-medium mb-1">Fallback: ECL Query</p>
                <p className="text-xs text-muted-foreground">
                  If a refset is not found in RF2 files, it falls back to ECL query expansion using the
                  terminology server with the <code className="text-xs bg-muted px-1 py-0.5 rounded">^</code> operator.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Step 5: Non-Refset Expansion */}
      <section>
        <div className="flex items-start gap-3 mb-3">
          <Badge variant="outline" className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5">
            5
          </Badge>
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">Expansion</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Codes that are not refsets are expanded using ECL (Expression Constraint Language) queries.
              Refsets are handled separately in the previous step.
            </p>

            <div className="space-y-2 ml-4">
              <div className="flex items-start gap-2">
                <Code className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">ECL Query Construction</p>
                  <p className="text-xs text-muted-foreground mb-1">
                    Codes are batched into efficient ECL queries to minimise server requests:
                  </p>
                  <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5 ml-2">
                    <li>Multiple codes combined with <code className="text-xs bg-muted px-1 py-0.5 rounded">OR</code></li>
                    <li>Excluded codes added with <code className="text-xs bg-muted px-1 py-0.5 rounded">MINUS</code></li>
                    <li>Child concepts included with <code className="text-xs bg-muted px-1 py-0.5 rounded">&lt;&lt;</code> when <code className="text-xs bg-muted px-1 py-0.5 rounded">includeChildren=true</code></li>
                  </ul>
                </div>
              </div>

              <div className="flex items-start gap-2 mt-3">
                <Database className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Terminology Server Expansion</p>
                  <p className="text-xs text-muted-foreground">
                    ECL queries are executed via FHIR <code className="text-xs bg-muted px-1 py-0.5 rounded">$expand</code> operation
                    on the terminology server to retrieve all matching concepts.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Step 6: SCT_CONST Handling */}
      <section>
        <div className="flex items-start gap-3 mb-3">
          <Badge variant="outline" className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5">
            6
          </Badge>
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">SCT_CONST (UK Products)</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Codes with <code className="text-xs bg-muted px-1 py-0.5 rounded">codeSystem="SCT_CONST"</code> represent
              substance codes that need to be expanded to UK Product concepts.
            </p>

            <div className="space-y-2 ml-4">
              <div className="flex items-start gap-2">
                <ArrowRight className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Special ECL Query</p>
                  <p className="text-xs text-muted-foreground mb-1">
                    Uses a specialised ECL query to find all UK Products containing the substance:
                  </p>
                  <code className="text-xs bg-muted px-2 py-1.5 rounded-md block mt-1 font-mono break-all">
                    {'<< (< 10363601000001109 |UK Product| : 762949000 |Has precise active ingredient| = << <SUBSTANCE_CODE>)'}
                  </code>
                  <p className="text-xs text-muted-foreground mt-2">
                    This query finds all descendants of UK Products that have the specified substance as a precise active ingredient.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Failed Codes */}
      <section>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <XCircle className="h-5 w-5 text-destructive" />
          Failed Codes
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          A code is marked as "failed" if it doesn't appear in the final expanded concept set after all expansion attempts.
        </p>

        <div className="space-y-3 ml-4">
          <div className="border-l-2 border-destructive pl-3">
            <p className="text-sm font-medium mb-1">Failure Reasons</p>
            <div className="space-y-2 mt-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">No ConceptMap Translation</p>
                <p className="text-xs text-muted-foreground">
                  Code wasn't found in either ConceptMap, wasn't detected as a refset in RF2, and doesn't appear
                  in the expanded concepts. Reason: <code className="text-xs bg-muted px-1 py-0.5 rounded">"No translation found from ConceptMap"</code>
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Not Found in Expansion</p>
                <p className="text-xs text-muted-foreground">
                  Code was translated by ConceptMap but doesn't appear in the final expanded concept set.
                  Reason: <code className="text-xs bg-muted px-1 py-0.5 rounded">"Not found in terminology server expansion"</code>
                </p>
              </div>
            </div>
          </div>

          <div className="border-l-2 border-green-500 pl-3">
            <p className="text-sm font-medium mb-1">Exclusions from Failed Codes</p>
            <div className="space-y-1 mt-2">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-3 w-3 text-green-600 mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  <strong>SCT_CONST codes</strong> that successfully expanded to UK Products (substance code itself won't appear, only products)
                </p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-3 w-3 text-green-600 mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  <strong>Refsets</strong> that successfully expanded from RF2 (refset ID itself isn't a concept, only members are)
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
