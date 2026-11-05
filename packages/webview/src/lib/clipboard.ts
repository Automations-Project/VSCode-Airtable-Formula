/** Write text to the clipboard. Resolves false (never throws) when it is refused. */
export function copyText(text: string): Promise<boolean> {
  return navigator.clipboard.writeText(text).then(() => true, () => false);
}
