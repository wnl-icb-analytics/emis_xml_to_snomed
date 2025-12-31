import { FileCode, ArrowRight } from 'lucide-react';
import Editor from '@monaco-editor/react';

export function XmlStructureExample() {
  return (
    <section>
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <FileCode className="h-5 w-5" />
        XML Structure Example
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        A simplified example of how a report appears in the EMIS XML and the metadata we extract:
      </p>

      <div className="bg-muted/50 rounded-lg p-4 space-y-4">
        <div>
          <p className="text-xs font-medium mb-2">XML Structure:</p>
          <div className="border rounded overflow-hidden">
            <Editor
              height="400px"
              defaultLanguage="xml"
              value={`<enquiryDocument>
  <reportFolder id="folder1" name="Clinical Searches">
    <report>
      <id>d701ac73-7207-4701-8711-8b786bf8c446</id>
      <name>[Search Name] Report Title</name>
      <description>Patients with condition X</description>
      <parent parentType="ACTIVE" />
      <population>
        <criteriaGroup>
          <definition>
            <criteria>
              <criterion>
                <filterAttribute>
                  <columnValue>
                    <valueSet codeSystem="SNOMED_CONCEPT">
                      <values>
                        <value>239887007</value>
                        <displayName>Beta blocker</displayName>
                        <includeChildren>true</includeChildren>
                        <isRefset>false</isRefset>
                      </values>
                      <values>
                        <value>14405791000006110</value>
                        <displayName>UK Primary Care refset</displayName>
                        <includeChildren>false</includeChildren>
                        <isRefset>true</isRefset>
                      </values>
                    </valueSet>
                  </columnValue>
                </filterAttribute>
              </criterion>
            </criteria>
          </definition>
        </criteriaGroup>
      </population>
    </report>
  </reportFolder>
</enquiryDocument>`}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
                lineNumbers: 'on',
                wordWrap: 'on',
                automaticLayout: true,
                theme: 'vs',
                stickyScroll: { enabled: false },
              }}
            />
          </div>
        </div>

        <div className="flex items-start gap-2">
          <ArrowRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium mb-1">How We Parse It:</p>
            <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1 ml-2">
              <li><strong>XML ID:</strong> Original GUID from <code className="text-xs bg-muted px-1 py-0.5 rounded">id</code> element (used for parent resolution)</li>
              <li><strong>Report name:</strong> Extracted from <code className="text-xs bg-muted px-1 py-0.5 rounded">name</code> element</li>
              <li><strong>Search name:</strong> Extracted from brackets in name: <code className="text-xs bg-muted px-1 py-0.5 rounded">[Search Name]</code></li>
              <li><strong>Description:</strong> Extracted from <code className="text-xs bg-muted px-1 py-0.5 rounded">description</code> element (optional)</li>
              <li><strong>Parent metadata:</strong> From <code className="text-xs bg-muted px-1 py-0.5 rounded">parent</code> element (parentType: ACTIVE/ALL/POP, parentReportId for POP)</li>
              <li><strong>Folder path:</strong> Built from <code className="text-xs bg-muted px-1 py-0.5 rounded">reportFolder</code> hierarchy</li>
              <li><strong>Value sets:</strong> Extracted from nested <code className="text-xs bg-muted px-1 py-0.5 rounded">valueSet</code> elements in criteria</li>
              <li><strong>Codes:</strong> Each <code className="text-xs bg-muted px-1 py-0.5 rounded">values</code> element contains code, displayName, includeChildren, isRefset</li>
              <li><strong>Code system:</strong> From <code className="text-xs bg-muted px-1 py-0.5 rounded">codeSystem</code> attribute (SNOMED_CONCEPT, SCT_CONST, EMISINTERNAL, etc.)</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
