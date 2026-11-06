import React from 'react';
import type { ReadinessModel } from '../../selectors/readiness.js';
import { NextAction, type NavigateFn } from '../../components/NextAction.js';
import { ReadinessFormula } from '../../components/ReadinessFormula.js';

interface OverviewHeroProps {
  readiness: ReadinessModel;
  navigate: NavigateFn;
}

export function OverviewHero({ readiness, navigate }: OverviewHeroProps) {
  return (
    <div className="overview-hero" data-state={readiness.state}>
      <h1 id="overview-heading" className="tab-heading" tabIndex={-1}>Overview</h1>
      <ReadinessFormula model={readiness} />
      <h2 className="overview-hero__headline">{readiness.headline}</h2>
      <p className="overview-hero__detail">{readiness.detail}</p>
      <NextAction action={readiness.nextAction} navigate={navigate} />
    </div>
  );
}
