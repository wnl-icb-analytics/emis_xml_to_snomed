// Diffs two EMIS XML exports and writes JSON + Markdown.
// Usage: npx tsx scripts/diff-xml.ts <base.xml> <target.xml> <outPrefix> [scope.json] [scopeLabel]
// Scope accepts [{folder, name}] or the dbt mapping JSON ({ searches: [{folder, name, models}] }).
import fs from 'fs';
import path from 'path';
import { parseEmisXml } from '../src/lib/xml-parser';
import { diffXmlDocuments, parseDiffScope, renderXmlDiffMarkdown } from '../src/lib/xml-diff';

async function main() {
  const [basePath, targetPath, outPrefix, scopePath, scopeLabel] = process.argv.slice(2);
  if (!basePath || !targetPath || !outPrefix) {
    console.error('Usage: npx tsx scripts/diff-xml.ts <base.xml> <target.xml> <outPrefix> [scope.json] [scopeLabel]');
    process.exit(1);
  }
  const [base, target] = await Promise.all([basePath, targetPath].map((p) => parseEmisXml(fs.readFileSync(p, 'utf-8'))));
  const scope = scopePath ? parseDiffScope(JSON.parse(fs.readFileSync(scopePath, 'utf-8')), scopeLabel ?? path.basename(scopePath)) : undefined;
  const result = diffXmlDocuments(
    { doc: base, fileName: path.basename(basePath) },
    { doc: target, fileName: path.basename(targetPath) },
    { scope }
  );

  fs.writeFileSync(`${outPrefix}.json`, JSON.stringify(result, null, 2));
  fs.writeFileSync(`${outPrefix}.md`, renderXmlDiffMarkdown(result));
  if (scope) fs.writeFileSync(`${outPrefix}.scope.md`, renderXmlDiffMarkdown(result, { scopeOnly: true }));
  console.log(JSON.stringify({ summary: result.summary, scope: result.scope, folderMoves: result.folderMoves.length }, null, 2));
}

main();
