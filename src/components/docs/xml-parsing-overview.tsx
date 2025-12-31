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
        <p className="text-xs font-medium text-blue-900 mb-1">Processing on Your Device</p>
        <p className="text-xs text-blue-800">
          All XML processing happens on your device—the file never leaves your computer or reaches our servers. This keeps
          your data private, protects against malicious file uploads, and allows the application to handle very large files
          without server-side limitations.
        </p>
      </div>
    </section>
  );
}
