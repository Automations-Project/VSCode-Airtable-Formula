import { describe, expect, it } from 'vitest';
// The real stylesheet entry, so the layered @import wiring is what is tested.
import '../styles.css';

// jsdom has no user-agent stylesheet (every margin/padding computes to "0"),
// so getComputedStyle cannot go red without the reset. The parsed CSSOM of the
// shipped entry can: jsdom understands @layer blocks and keeps their rules.
function layerRules(name: string): CSSStyleRule[] {
  const rules: CSSStyleRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      const layer = rule as CSSLayerBlockRule;
      if (rule.constructor.name === 'CSSLayerBlockRule' && layer.name === name) {
        rules.push(...(Array.from(layer.cssRules) as CSSStyleRule[]));
      }
    }
  }
  return rules;
}

describe('global CSS reset', () => {
  it('resets box sizing, margin and padding for every element in the base layer', () => {
    const universal = layerRules('base').find(
      rule => rule.selectorText?.split(',').map(s => s.trim()).includes('*'),
    );

    expect(universal, 'universal reset rule in @layer base').toBeDefined();
    expect(universal!.style.boxSizing).toBe('border-box');
    expect(universal!.style.margin).toBe('0px');
    expect(universal!.style.padding).toBe('0px');
  });
});
