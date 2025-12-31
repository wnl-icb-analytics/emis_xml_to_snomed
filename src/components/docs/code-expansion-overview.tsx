import { Network } from 'lucide-react';

export function CodeExpansionOverview() {
  return (
    <section>
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <Network className="h-5 w-5" />
        Overview
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed mb-3">
        Each code goes through a routing process to translate it from EMIS to SNOMED CT and expand it into
        a complete set of concepts. The system tries multiple approaches in sequence, using fallbacks when
        primary methods don't work.
      </p>
      <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
        <p className="text-xs font-medium text-green-900 mb-1">Server-Side Processing</p>
        <p className="text-xs text-green-800">
          Code expansion happens on the server to securely access terminology servers and RF2 files stored on the server.
          The server handles translation, refset lookups, and concept expansion, then returns the results to your browser.
        </p>
      </div>
    </section>
  );
}
