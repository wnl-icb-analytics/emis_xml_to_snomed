import { NextRequest, NextResponse } from 'next/server';
import { loadXmlBlobContent, XML_BLOB_PREFIX } from '@/lib/blob-xml';
import { parseEmisXml } from '@/lib/xml-parser';
import { diffXmlDocuments, parseDiffScope } from '@/lib/xml-diff';

const badRequest = (error: string) => NextResponse.json({ success: false, error }, { status: 400 });

/** Diffs two shared (blob) XML files. Body: { basePathname, targetPathname, scope?, scopeLabel? } */
export async function POST(request: NextRequest) {
  let body: { basePathname?: unknown; targetPathname?: unknown; scope?: unknown; scopeLabel?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body must be JSON');
  }
  const { basePathname, targetPathname, scopeLabel } = body;
  const isXmlPath = (p: unknown): p is string => typeof p === 'string' && p.startsWith(XML_BLOB_PREFIX) && p.endsWith('.xml');
  if (!isXmlPath(basePathname) || !isXmlPath(targetPathname)) {
    return badRequest(`basePathname and targetPathname must be ${XML_BLOB_PREFIX}*.xml paths`);
  }
  let scope;
  try {
    scope = body.scope ? parseDiffScope(body.scope, typeof scopeLabel === 'string' && scopeLabel ? scopeLabel : 'Scope') : undefined;
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : 'Invalid scope');
  }

  try {
    const [base, target] = await Promise.all(
      [basePathname, targetPathname].map(async (p) => {
        const { fileName, xmlContent } = await loadXmlBlobContent(p);
        return { fileName, doc: await parseEmisXml(xmlContent) };
      })
    );
    return NextResponse.json({ success: true, data: diffXmlDocuments(base, target, { scope }) });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to diff XML files' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
