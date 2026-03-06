import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { EmisXmlDocument } from '@/lib/types';

export interface AgentStoredDocument {
  id: string;
  fileName: string;
  createdAt: string;
  xmlSha256: string;
  data: EmisXmlDocument;
}

const STORE_DIR = path.join(os.tmpdir(), 'emis-xml-to-snomed-agent-docs');

async function ensureStoreDir() {
  await fs.mkdir(STORE_DIR, { recursive: true });
}

function getDocumentPath(documentId: string) {
  return path.join(STORE_DIR, `${documentId}.json`);
}

export function hashXmlContent(xmlContent: string): string {
  return crypto.createHash('sha256').update(xmlContent).digest('hex');
}

export async function saveAgentDocument(fileName: string, xmlContent: string, data: EmisXmlDocument): Promise<AgentStoredDocument> {
  await ensureStoreDir();
  const xmlSha256 = hashXmlContent(xmlContent);
  const documentId = crypto.randomUUID();
  const stored: AgentStoredDocument = {
    id: documentId,
    fileName,
    createdAt: new Date().toISOString(),
    xmlSha256,
    data,
  };
  await fs.writeFile(getDocumentPath(documentId), JSON.stringify(stored), 'utf8');
  return stored;
}

export async function loadAgentDocument(documentId: string): Promise<AgentStoredDocument | null> {
  await ensureStoreDir();
  try {
    const raw = await fs.readFile(getDocumentPath(documentId), 'utf8');
    return JSON.parse(raw) as AgentStoredDocument;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
