import { NextRequest, NextResponse } from 'next/server';
import { loadXmlBlobContent } from '@/lib/blob-xml';
import { parseEmisXml } from '@/lib/xml-parser';
import { diffXmlDocuments, parseDiffScope } from '@/lib/xml-diff';

/** Diffs two shared (blob) XML files. Body: { basePathname, targetPathname, scope?, scopeLabel? } */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      basePathname?: string;
      targetPathname?: string;
      scope?: unknown;
      scopeLabel?: string;
    };
    if (!body.basePathname || !body.targetPathname) {
      return NextResponse.json({ success: false, error: 'Missing basePathname or targetPathname' }, { status: 400 });
    }

    const [base, target] = await Promise.all(
      [body.basePathname, body.targetPathname].map(async (p) => {
        const { fileName, xmlContent } = await loadXmlBlobContent(p);
        return { fileName, doc: await parseEmisXml(xmlContent) };
      })
    );
    const scope = body.scope ? parseDiffScope(body.scope, body.scopeLabel || 'Scope') : undefined;

    return NextResponse.json({ success: true, data: diffXmlDocuments(base, target, { scope }) });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to diff XML files' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
