import React from 'react';
import { useFlash } from '../lib/useFlash.js';
import { ActionButton } from './ActionButton.js';

interface SnippetCardProps {
  /** Plain snippet text. */
  text: string;
  /** Format label, e.g. "JSON" — names the code region for assistive tech. */
  language: string;
  /** Perform the copy. Resolve `false` to report failure instead of success. */
  onCopy: (text: string) => Promise<boolean> | boolean | void;
}

/** One code block with its Copy action. Selection between snippets is the caller's native select. */
export function SnippetCard({ text, language, onCopy }: SnippetCardProps) {
  const [copied, flashCopied] = useFlash(2000);
  const [failed, flashFailed] = useFlash(3000);

  const copy = async () => {
    const ok = await onCopy(text);
    if (ok === false) flashFailed(); else flashCopied();
  };

  return (
    <div className="snippet-card">
      {/* Focusable so keyboard users can scroll a code line that overflows the sidebar. */}
      <pre className="snippet-card__code" role="group" aria-label={`${language} snippet`} tabIndex={0}>
        <code>{text}</code>
      </pre>
      <div className="snippet-card__actions">
        <ActionButton onClick={copy}>
          Copy configuration
        </ActionButton>
        {/* Always mounted so assistive tech registers the live region before it speaks. */}
        <span className="snippet-card__flash" role="status">
          {failed ? 'Copy failed' : copied ? 'Configuration copied' : ''}
        </span>
      </div>
    </div>
  );
}
