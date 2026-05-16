/** @param {'formula'|'script'|'automation'} language */
function prefix(language) {
  if (language === 'formula') return '# AT:';
  if (language === 'script' || language === 'automation') return '// AT:';
  throw new Error(`Unknown language: ${language}`);
}

/**
 * Strips leading AT: header lines from raw file content.
 * @returns {{ text: string, offset: number }}
 */
export function stripHeader(raw, language = 'formula') {
  const p = prefix(language);
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && lines[i].startsWith(p)) i++;
  return { text: lines.slice(i).join('\n'), offset: i };
}

/**
 * Extracts key=value pairs from AT: header lines.
 * Values with spaces must be quoted: fieldName="My Field"
 * @returns {Record<string, string>}
 */
export function parseHeader(raw, language = 'formula') {
  const p = prefix(language);
  const result = {};
  for (const line of raw.split('\n')) {
    if (!line.startsWith(p)) break;
    const rest = line.slice(p.length).trim();
    for (const m of rest.matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)) {
      result[m[1]] = m[2] !== undefined ? m[2] : m[3];
    }
  }
  return result;
}
