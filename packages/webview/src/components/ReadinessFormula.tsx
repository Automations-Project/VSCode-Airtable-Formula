import React from 'react';
import type { ReadinessModel, ReadinessTerm } from '../selectors/readiness.js';

const SENTENCE = 'Session plus service plus clients equals ready';

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
 * replaced by one sentence; per-term state is announced by the Status list.
 */
export function ReadinessFormula({ model }: { model: ReadinessModel }) {
  const { terms } = model;

  return (
    <div className="readiness-formula" data-state={model.state}>
      <span className="visually-hidden">{SENTENCE}</span>
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
