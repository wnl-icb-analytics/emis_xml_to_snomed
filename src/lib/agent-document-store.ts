import crypto from 'crypto';
import { get, put } from '@vercel/blob';
import type { EmisXmlDocument } from '@/lib/types';

export interface AgentStoredDocument {
  id: string;
  fileName: string;
  createdAt: string;
  xmlSha256: string;
  data: EmisXmlDocument;
}

const AGENT_DOCUMENT_PREFIX = 'agent-documents/';

function buildAgentDocumentPath(documentId: string): string {
  return `${AGENT_DOCUMENT_PREFIX}${documentId}.json`;
}

export function hashXmlContent(xmlContent: string): string {
  return crypto.createHash('sha256').update(xmlContent).digest('hex');
}

export async function saveAgentDocument(fileName: string, xmlContent: string, data: EmisXmlDocument): Promise<AgentStoredDocument> {
  const xmlSha256 = hashXmlContent(xmlContent);
  const documentId = crypto.randomUUID();
  const stored: AgentStoredDocument = {
    id: documentId,
    fileName,
    createdAt: new Date().toISOString(),
    xmlSha256,
    data,
  };

  await put(buildAgentDocumentPath(documentId), JSON.stringify(stored), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });

  return stored;
}

export async function loadAgentDocument(documentId: string): Promise<AgentStoredDocument | null> {
  const blob = await get(buildAgentDocumentPath(documentId), {
    access: 'private',
    useCache: false,
  });

  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    return null;
  }

  const raw = await new Response(blob.stream).text();
  return JSON.parse(raw) as AgentStoredDocument;
}
