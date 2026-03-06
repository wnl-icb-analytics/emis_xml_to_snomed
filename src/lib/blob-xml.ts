import { get, list } from '@vercel/blob';
import type { ListBlobResultBlob } from '@vercel/blob';
import { parseEmisXml } from '@/lib/xml-parser';
import { buildMinimalParsedXmlData } from '@/lib/parsed-xml-session';

export const XML_BLOB_PREFIX = 'xml-files/';

export interface XmlBlobFileSummary {
  pathname: string;
  fileName: string;
  size: number;
  uploadedAt: string;
  url: string;
  downloadUrl: string;
}

export function normalizeXmlFileName(fileName: string): string {
  const trimmed = fileName.trim().replace(/[\\/]/g, '-');
  return trimmed.endsWith('.xml') ? trimmed : `${trimmed}.xml`;
}

export function buildXmlBlobPath(fileName: string): string {
  return `${XML_BLOB_PREFIX}${normalizeXmlFileName(fileName)}`;
}

export function getFileNameFromPathname(pathname: string): string {
  const parts = pathname.split('/');
  return parts[parts.length - 1] || pathname;
}

function toSummary(blob: ListBlobResultBlob): XmlBlobFileSummary {
  return {
    pathname: blob.pathname,
    fileName: getFileNameFromPathname(blob.pathname),
    size: blob.size,
    uploadedAt: blob.uploadedAt.toISOString(),
    url: blob.url,
    downloadUrl: blob.downloadUrl,
  };
}

export async function listXmlBlobFiles(): Promise<XmlBlobFileSummary[]> {
  let cursor: string | undefined;
  const files: ListBlobResultBlob[] = [];

  do {
    const page = await list({
      prefix: XML_BLOB_PREFIX,
      cursor,
      limit: 1000,
    });
    files.push(...page.blobs.filter((blob) => blob.pathname.endsWith('.xml')));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return files
    .map(toSummary)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function loadXmlBlobContent(pathname: string): Promise<{ fileName: string; xmlContent: string }> {
  const blob = await get(pathname, { access: 'private' });
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    throw new Error(`Blob not found: ${pathname}`);
  }

  const xmlContent = await new Response(blob.stream).text();
  return {
    fileName: getFileNameFromPathname(pathname),
    xmlContent,
  };
}

export async function parseXmlBlobToSession(pathname: string) {
  const { fileName, xmlContent } = await loadXmlBlobContent(pathname);
  const parsedData = await parseEmisXml(xmlContent);
  return {
    fileName,
    xmlContent,
    parsedData,
    minimalData: buildMinimalParsedXmlData(parsedData, fileName),
  };
}
