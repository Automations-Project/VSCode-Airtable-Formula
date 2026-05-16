type Language = 'formula' | 'script' | 'automation';

function getPrefix(lang: Language): string {
  if (lang === 'formula') return '# AT:';
  if (lang === 'script' || lang === 'automation') return '// AT:';
  throw new Error(`Unknown language: ${lang}`);
}

export function stripFormulaHeader(
  text: string,
  lang: Language = 'formula',
): { formula: string; offset: number } {
  const p = getPrefix(lang);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && lines[i].startsWith(p)) i++;
  return { formula: lines.slice(i).join('\n'), offset: i };
}

export function parseFormulaHeader(
  text: string,
  lang: Language = 'formula',
): Record<string, string> {
  const p = getPrefix(lang);
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line.startsWith(p)) break;
    const rest = line.slice(p.length).trim();
    for (const m of rest.matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)) {
      result[m[1]] = m[2] !== undefined ? m[2] : m[3];
    }
  }
  return result;
}
