'use client';

interface ExtractionFileListProps {
  className?: string;
}

export function ExtractionFileList({ className }: ExtractionFileListProps) {
  const files = [
    { name: 'reports.csv', description: 'Report metadata with deterministic IDs' },
    { name: 'valuesets.csv', description: 'ValueSets with hash for deduplication and ECL expressions' },
    { name: 'original_codes.csv', description: 'Original EMIS codes from XML with ConceptMap translations' },
    { name: 'expanded_concepts.csv', description: 'Expanded SNOMED concepts from terminology server and RF2' },
    { name: 'failed_codes.csv', description: 'Codes that failed to translate or expand with error reasons' },
    { name: 'exceptions.csv', description: 'Excluded codes with translation status and ECL inclusion tracking' },
  ];

  return (
    <div className={className}>
      <h3 className="font-semibold text-sm mb-3">Files in ZIP Bundle</h3>
      <ul className="text-sm text-muted-foreground space-y-1.5">
        {files.map((file) => (
          <li key={file.name} className="flex items-start gap-2">
            <span className="text-muted-foreground">•</span>
            <div>
              <span className="font-medium">{file.name}</span>
              <span className="ml-1.5">— {file.description}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

