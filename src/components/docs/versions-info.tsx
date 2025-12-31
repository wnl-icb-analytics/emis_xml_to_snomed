'use client';

import { Package, Database, FileCode } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useEffect, useState } from 'react';

interface ConceptMapVersions {
  primary: string | null;
  fallback: string | null;
}

interface RF2VersionInfo {
  releaseDate: string;
  releaseId: string;
  folderName: string;
  module: string;
  edition: string;
  refsets?: string[];
}

interface RF2UpdateInfo {
  available: boolean;
  releaseName: string;
  releaseDate: string;
  downloadUrl: string;
}

interface VersionsResponse {
  conceptMaps: ConceptMapVersions;
  rf2: RF2VersionInfo | null;
  rf2Update: RF2UpdateInfo | null;
}

export function VersionsInfo() {
  const [conceptMapVersions, setConceptMapVersions] = useState<ConceptMapVersions>({
    primary: null,
    fallback: null,
  });
  const [rf2Version, setRf2Version] = useState<RF2VersionInfo | null>(null);
  const [rf2Update, setRf2Update] = useState<RF2UpdateInfo | null>(null);

  useEffect(() => {
    // Fetch current versions from the API
    fetch('/api/terminology/versions')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch versions: ${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .then((data: VersionsResponse) => {
        // Ensure conceptMaps exists before setting state
        if (data.conceptMaps) {
          setConceptMapVersions(data.conceptMaps);
        }
        setRf2Version(data.rf2 || null);
        setRf2Update(data.rf2Update || null);
      })
      .catch((err) => {
        console.error('Failed to fetch versions:', err);
        // Keep default state (primary: null, fallback: null) on error
      });
  }, []);

  return (
    <>
      {/* Overview */}
      <section>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Package className="h-5 w-5" />
          Component Versions
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-3">
          The system uses several versioned components for code translation and expansion. This section shows the
          current versions in use.
        </p>
      </section>

      {/* FHIR Terminology Server */}
      <section>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Database className="h-5 w-5" />
          FHIR Terminology Server
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          The system connects to the One London FHIR Terminology Server, which provides SNOMED CT concept lookups,
          ValueSet expansions, and ConceptMap translations.
        </p>

        <div className="space-y-4">
          {/* ConceptMaps */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline">ConceptMaps</Badge>
              <span className="text-xs text-muted-foreground">EMIS → SNOMED Translation</span>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              ConceptMaps are used to translate EMIS codes to SNOMED CT codes. The system automatically queries
              the terminology server for the latest active version on first use.
            </p>
            <div className="text-xs font-mono bg-muted/50 p-3 rounded space-y-2">
              <div>
                <strong>Primary ConceptMap:</strong> EMIS to SNOMED CodeID
                <br />
                <span className="text-muted-foreground">Canonical URL:</span>{' '}
                <code className="text-xs">http://LDS.nhs/EMIStoSNOMED/CodeID/cm</code>
                <br />
                {conceptMapVersions.primary ? (
                  <>
                    <span className="text-green-600">✓ Version {conceptMapVersions.primary}</span>
                    <span className="text-muted-foreground ml-2">(latest active)</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Version not yet resolved</span>
                )}
              </div>
              <div className="border-t border-border pt-2">
                <strong>Fallback ConceptMap:</strong> EMIS to SNOMED DrugCodeID
                <br />
                <span className="text-muted-foreground">Canonical URL:</span>{' '}
                <code className="text-xs">http://LDS.nhs/EMIS_to_Snomed/DrugCodeID/cm</code>
                <br />
                {conceptMapVersions.fallback ? (
                  <>
                    <span className="text-green-600">✓ Version {conceptMapVersions.fallback}</span>
                    <span className="text-muted-foreground ml-2">(latest active)</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Version not yet resolved</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* RF2 Files */}
      <section>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <FileCode className="h-5 w-5" />
          SNOMED CT UK Primary Care RF2 Files
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          The system includes bundled SNOMED CT RF2 (Release Format 2) files for UK Primary Care refset expansion
          and concept descriptions. These files are required because the terminology server does not include UK
          Primary Care domain refsets. These are static assets that are updated periodically.
        </p>

        <div className="border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline">RF2 Release</Badge>
            {rf2Version && (
              <span className="text-xs text-muted-foreground">{rf2Version.edition} Edition</span>
            )}
          </div>
          {rf2Version ? (
            <div className="text-xs font-mono bg-muted/50 p-3 rounded space-y-2">
              <div>
                <strong>Release Date:</strong> {rf2Version.releaseDate}
                <br />
                <span className="text-muted-foreground">Release ID:</span>{' '}
                <code className="text-xs">{rf2Version.releaseId}</code>
                <br />
                {rf2Update ? (
                  <>
                    <span className="text-orange-600">⚠ Update available: {rf2Update.releaseName}</span>
                    <span className="text-muted-foreground ml-2">
                      (
                      <a
                        href={rf2Update.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-600 underline hover:no-underline"
                      >
                        download from TRUD
                      </a>
                      )
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-green-600">✓ Up to date</span>
                    <span className="text-muted-foreground ml-2">(latest release from TRUD)</span>
                  </>
                )}
              </div>
              <div className="border-t border-border pt-2">
                <strong>Module:</strong> {rf2Version.module}
                <br />
                <strong>Formats Included:</strong> Snapshot, Full, Delta
              </div>
              <div className="border-t border-border pt-2">
                <strong>Folder:</strong> <code className="text-xs">{rf2Version.folderName}</code>
              </div>
              {rf2Version.refsets && rf2Version.refsets.length > 0 && (
                <div className="border-t border-border pt-2">
                  <strong>Included Refsets:</strong>
                  <ul className="list-disc list-inside ml-2 mt-1 space-y-0.5">
                    {rf2Version.refsets.map((refset, idx) => (
                      <li key={idx}>{refset}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded">
              No RF2 folder detected in project root. Looking for folders matching:{' '}
              <code className="text-xs">SnomedCT_*_PRODUCTION_*</code>
            </div>
          )}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
          <p className="text-xs font-medium text-blue-900 mb-1">Updating RF2 Files</p>
          <p className="text-xs text-blue-800">
            RF2 files are bundled with the application and are not automatically updated. If an update is available,
            please contact the developer at{' '}
            <a
              href="mailto:eddie.davison@nhs.net"
              className="text-blue-900 underline hover:no-underline"
            >
              eddie.davison@nhs.net
            </a>{' '}
            to request an update. For the most current data, the system primarily relies on the FHIR terminology
            server for concept lookups and expansions.
          </p>
        </div>
      </section>

      {/* Version Update Strategy */}
      <section>
        <h3 className="text-lg font-semibold mb-3">Version Update Strategy</h3>
        <div className="space-y-3">
          <div className="border-l-2 border-green-500 pl-3">
            <p className="text-sm font-medium mb-1">ConceptMaps (Automatic)</p>
            <p className="text-xs text-muted-foreground">
              ConceptMap versions are resolved automatically on first use by querying the terminology server for the
              latest active version. No code changes or redeployment required to pick up new mapping versions.
            </p>
          </div>
          <div className="border-l-2 border-orange-500 pl-3">
            <p className="text-sm font-medium mb-1">RF2 Files (Manual)</p>
            <p className="text-xs text-muted-foreground">
              RF2 files are static assets that must be manually updated in the codebase and redeployed to use newer
              releases. These files are required because the terminology server does not include UK Primary Care domain
              refsets, so refset expansion must be performed locally using the bundled RF2 files.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
