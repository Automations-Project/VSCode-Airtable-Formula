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

describe('empty live regions', () => {
  const selectors = ['.outcome-status:empty', '.prompt-status:empty', '.snippet-card__flash:empty'];

  // display:none removes the node from the accessibility tree, so a screen
  // reader only meets the region when its text arrives and often misses it.
  it.each(selectors)('%s stays rendered while empty', selector => {
    const rule = layerRules('components').find(
      r => r.selectorText?.split(',').map(s => s.trim()).includes(selector),
    );

    expect(rule, selector).toBeDefined();
    expect(rule!.style.display).not.toBe('none');
    // Out of flow, so an empty region adds no gap row inside a flex or grid parent.
    expect(rule!.style.position).toBe('absolute');
  });
});
