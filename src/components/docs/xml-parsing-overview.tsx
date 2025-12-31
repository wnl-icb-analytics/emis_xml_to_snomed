import { FileCode } from 'lucide-react';

export function XmlParsingOverview() {
  return (
    <section>
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <FileCode className="h-5 w-5" />
        Overview
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed mb-3">
        The system reads EMIS XML export files directly in your browser to extract search reports, value sets, and codes.
        The XML structure is navigated hierarchically to build a structured representation of the data.
      </p>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
        <p className="text-xs font-medium text-blue-900 mb-1">Client-Side Processing for Security</p>
        <p className="text-xs text-blue-800">
          All XML processing happens entirely in your browser—the file never reaches our servers. This protects the
          application from malicious file uploads and potential security threats. Parsed data is stored locally in IndexedDB
          for fast access and to handle large files (50MB+) efficiently.
        </p>
      </div>
    </section>
  );
}
