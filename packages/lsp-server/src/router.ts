import { extname } from 'node:path';

type Engine = 'formula' | 'script' | 'automation';

const LANG_TO_ENGINE: Record<string, Engine> = {
  'airtable-formula': 'formula',
  'airtable-script': 'script',
  'airtable-automation': 'automation',
};

const EXT_TO_ENGINE: Record<string, Engine> = {
  '.formula': 'formula',
  '.fx': 'formula',
  '.ats': 'script',
  '.script': 'script',
  '.ata': 'automation',
  '.automation': 'automation',
};

/**
 * Route a document to an engine by language ID first, falling back to file extension.
 * Returns null if the document is not an Airtable language file.
 * Implements D-07 routing priority.
 */
export function routeDocument(uri: string, languageId?: string): Engine | null {
  // Priority 1: language ID from textDocument/didOpen (D-07)
  if (languageId && LANG_TO_ENGINE[languageId]) {
    return LANG_TO_ENGINE[languageId];
  }

  // Priority 2: file extension fallback
  try {
    const pathname = new URL(uri).pathname;
    const ext = extname(pathname);
    return EXT_TO_ENGINE[ext] ?? null;
  } catch {
    // Malformed URI — not a recognized file
    return null;
  }
}
