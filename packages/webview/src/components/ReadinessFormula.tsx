import React from 'react';
import type { ReadinessModel, ReadinessTerm } from '../selectors/readiness.js';

/** Sentence case for a label used mid-sentence ("Signed in" -> "signed in"). */
function inSentence(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** What the visual formula says, in words: each term's own state, then the result. */
function formulaSentence({ terms, resultLabel }: ReadinessModel): string {
  return `Session: ${inSentence(terms.session.longLabel)}, `
    + `plus service: ${inSentence(terms.service.longLabel)}, `
    + `plus clients: ${inSentence(terms.clients.longLabel)}, `
    + `equals ${resultLabel.toLowerCase()}.`;
}

function Term({ term, name }: { term: ReadinessTerm; name: string }) {
  return (
    <span className="readiness-term" data-state={term.state} data-accent={term.accent}>
      <span className="readiness-term__name">{name}</span>
      <span className="readiness-term__value">{term.shortLabel}</span>
    </span>
  );
}

/**
 * The visual signature. Operators are real text so the expression survives
 * copy/paste, but the whole expression is hidden from assistive tech and
 * replaced by one sentence built from the same terms, so a blocked formula
 * is never read as "equals ready". It is read in place, not a live region:
 * the header status already announces changes once.
 */
export function ReadinessFormula({ model }: { model: ReadinessModel }) {
  const { terms } = model;

  return (
    <div className="readiness-formula" data-state={model.state}>
      <span className="visually-hidden">{formulaSentence(model)}</span>
      <div className="readiness-formula__visual" aria-hidden="true">
        <Term term={terms.session} name="SESSION" />
        <span className="readiness-formula__operator">+</span>
        <Term term={terms.service} name="SERVICE" />
        <span className="readiness-formula__operator">+</span>
        <Term term={terms.clients} name="CLIENTS" />
        <span className="readiness-formula__operator">=</span>
        <span className="readiness-formula__result" data-state={model.state}>{model.resultLabel}</span>
      </div>
    </div>
  );
}
