'use client';

import { Database, Key } from 'lucide-react';

interface TableInfo {
  name: string;
  primaryKey: string;
  foreignKeys: { column: string; references: string }[];
  columns: string[];
}

export function ExtractionDataModel({ className }: { className?: string }) {

  const tables: TableInfo[] = [
    {
      name: 'reports',
      primaryKey: 'report_id',
      foreignKeys: [],
      columns: ['report_id', 'report_xml_id', 'report_name', 'search_name', 'description', 'parent_type', 'parent_report_id', 'folder_path', 'xml_file_name', 'equivalence_filter_setting', 'parsed_at'],
    },
    {
      name: 'valuesets',
      primaryKey: 'valueset_id',
      foreignKeys: [{ column: 'report_id', references: 'reports.report_id' }],
      columns: ['valueset_id', 'report_id', 'valueset_index', 'valueset_hash', 'valueset_friendly_name', 'code_system', 'ecl_expression', 'expansion_error', 'expanded_at'],
    },
    {
      name: 'original_codes',
      primaryKey: 'original_code_id',
      foreignKeys: [{ column: 'valueset_id', references: 'valuesets.valueset_id' }],
      columns: ['original_code_id', 'valueset_id', 'original_code', 'display_name', 'code_system', 'include_children', 'is_refset', 'translated_to_snomed_code', 'translated_to_display'],
    },
    {
      name: 'expanded_concepts',
      primaryKey: 'concept_id',
      foreignKeys: [{ column: 'valueset_id', references: 'valuesets.valueset_id' }],
      columns: ['concept_id', 'valueset_id', 'snomed_code', 'display', 'source', 'exclude_children', 'is_descendant'],
    },
    {
      name: 'failed_codes',
      primaryKey: 'failed_code_id',
      foreignKeys: [{ column: 'valueset_id', references: 'valuesets.valueset_id' }],
      columns: ['failed_code_id', 'valueset_id', 'original_code', 'display_name', 'code_system', 'reason'],
    },
    {
      name: 'exceptions',
      primaryKey: 'exception_id',
      foreignKeys: [{ column: 'valueset_id', references: 'valuesets.valueset_id' }],
      columns: ['exception_id', 'valueset_id', 'original_excluded_code', 'original_excluded_display', 'translated_to_snomed_code', 'included_in_ecl', 'translation_error'],
    },
  ];


  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-4">
        <Database className="h-4 w-4" />
        <h3 className="font-semibold text-sm">Data Model & Relationships</h3>
      </div>
      
      {/* Visual ER Diagram with Columns */}
      <div className="p-4 bg-muted/20 rounded-lg border">
        <div className="space-y-6">
            {/* Row 1: reports */}
            <div className="flex justify-center">
              <div className="border-2 border-primary rounded-lg bg-background shadow-sm p-3 min-w-[280px]">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                  <Key className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">reports</span>
                </div>
                <div className="space-y-1">
                  {tables[0].columns.map((column) => {
                    const isPrimaryKey = column === tables[0].primaryKey;
                    return (
                      <div
                        key={column}
                        className={`text-xs font-mono px-2 py-1.5 rounded ${
                          isPrimaryKey
                            ? 'bg-primary/10 text-primary font-semibold'
                            : 'text-muted-foreground bg-muted/30'
                        }`}
                      >
                        {isPrimaryKey && <Key className="h-3 w-3 inline mr-1" />}
                        {column}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Row 2: valuesets */}
            <div className="flex justify-center">
              <div className="border-2 border-primary rounded-lg bg-background shadow-sm p-3 min-w-[280px]">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                  <Key className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">valuesets</span>
                </div>
                <div className="space-y-1">
                  {tables[1].columns.map((column) => {
                    const isPrimaryKey = column === tables[1].primaryKey;
                    const foreignKey = tables[1].foreignKeys.find(fk => fk.column === column);
                    return (
                      <div
                        key={column}
                        className={`text-xs font-mono px-2 py-1.5 rounded flex items-center gap-1.5 ${
                          isPrimaryKey
                            ? 'bg-primary/10 text-primary font-semibold'
                            : foreignKey
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                            : 'text-muted-foreground bg-muted/30'
                        }`}
                      >
                        {isPrimaryKey && <Key className="h-3 w-3 flex-shrink-0" />}
                        <span className="flex-1">{column}</span>
                        {foreignKey && (
                          <span className="text-[10px] opacity-70 ml-auto">
                            → {foreignKey.references.split('.')[0]}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Row 3: Child tables */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {tables.slice(2).map((table) => (
                <div
                  key={table.name}
                  className="border-2 border-primary rounded-lg bg-background shadow-sm p-3"
                >
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                    <Key className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">{table.name}</span>
                  </div>
                  <div className="space-y-1">
                    {table.columns.map((column) => {
                      const isPrimaryKey = column === table.primaryKey;
                      const foreignKey = table.foreignKeys.find(fk => fk.column === column);
                      return (
                        <div
                          key={column}
                          className={`text-xs font-mono px-2 py-1.5 rounded flex items-center gap-1.5 ${
                            isPrimaryKey
                              ? 'bg-primary/10 text-primary font-semibold'
                              : foreignKey
                              ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                              : 'text-muted-foreground bg-muted/30'
                          }`}
                        >
                          {isPrimaryKey && <Key className="h-3 w-3 flex-shrink-0" />}
                          <span className="flex-1">{column}</span>
                          {foreignKey && (
                            <span className="text-[10px] opacity-70 ml-auto">
                              → {foreignKey.references.split('.')[0]}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        
        {/* Relationship Legend */}
        <div className="mt-4 pt-4 border-t flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-2">
            <Key className="h-3 w-3 text-primary" />
            <span>Primary Key</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded bg-blue-50 border border-blue-200 dark:bg-blue-950 dark:border-blue-800"></div>
            <span>Foreign Key</span>
          </div>
        </div>
      </div>
    </div>
  );
}

