import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardTabId } from '@shared/types.js';
import { App } from '../App.js';
import { READINESS_FOCUS_TARGET_IDS, selectReadiness } from '../selectors/readiness.js';
import { useStore } from '../store.js';
import { makeDashboardState, type DashboardStateOverrides } from './dashboard-state.fixture.js';
// The real stylesheet entry, so the layered @import wiring is what is tested.
import '../styles.css';

const CSS_SOURCES = import.meta.glob('../styles/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function seed(overrides: DashboardStateOverrides = {}, activeTab: DashboardTabId = 'overview'): void {
  useStore.setState({ ...makeDashboardState(overrides), activeTab, loading: false });
}

async function expectNoSeriousOrCriticalViolations(container: HTMLElement) {
  const result = await axe.run(container, { resultTypes: ['violations'] });
  const blockers = result.violations.filter(violation =>
    violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blockers).toEqual([]);
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // axe's colour rules probe a 2D canvas; jsdom has none and logs "not implemented".
  // Answering null keeps every rule enabled and the output clean.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe('axe: serious and critical violations in required states', () => {
  it('can go red: the gate reports an unnamed button', async () => {
    const { container } = render(<button type="button" />);

    await expect(expectNoSeriousOrCriticalViolations(container)).rejects.toThrow();
  });

  it('has none in ready Overview', async () => {
    seed();
    const { container } = render(<App />);

    await expectNoSeriousOrCriticalViolations(container);
  });

  it('has none in blocked Overview', async () => {
    seed({
      auth: { status: 'expired', hasCredentials: true },
      daemon: { running: false, healthy: false, port: null, port_lsp: null, uptime: null },
      ideStatuses: [],
    });
    const { container } = render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    await expectNoSeriousOrCriticalViolations(container);
  });

  it('has none in Setup with a tunnel and service error', async () => {
    seed({
      daemon: { running: true, healthy: false },
      tunnel: { status: 'error', url: null, provider: 'ngrok', ngrokAuthtokenSet: false, autoDisabledReason: null },
    }, 'setup');
    const { container } = render(<App />);

    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    await expectNoSeriousOrCriticalViolations(container);
  });

  it('has none in the Prompt list', async () => {
    seed({
      prompts: {
        prompts: [{
          name: 'my-prompt', description: 'Mine', arguments: [], template: 'T', isBuiltin: false, isModified: false,
        }, {
          name: 'built-in', description: 'Shipped', arguments: [], template: 'T', isBuiltin: true, isModified: true,
        }],
      },
    }, 'prompts');
    const { container } = render(<App />);

    expect(screen.getByRole('button', { name: /\/my-prompt/ })).toBeInTheDocument();
    await expectNoSeriousOrCriticalViolations(container);
  });

  it('has none in an open new Prompt editor with an argument', async () => {
    const user = userEvent.setup();
    seed({}, 'prompts');
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: 'New prompt' }));
    await user.click(screen.getByRole('button', { name: /Add argument/ }));

    expect(screen.getByRole('textbox', { name: 'Template' })).toBeInTheDocument();
    await expectNoSeriousOrCriticalViolations(container);
  });

  it('has none in Settings with Diagnostics and Advanced runtime expanded', async () => {
    const user = userEvent.setup();
    seed({ settings: { mcp: { toolProfile: { profile: 'custom' } } } }, 'settings');
    const { container } = render(<App />);
    for (const name of ['Diagnostics', 'Advanced runtime']) {
      await user.click(screen.getByRole('button', { name }));
    }

    expect(screen.getByRole('button', { name: 'Diagnostics' })).toHaveAttribute('aria-expanded', 'true');
    await expectNoSeriousOrCriticalViolations(container);
  });
});

describe('navigation focus targets', () => {
  // Every id the readiness model can emit, collected two ways so neither a new
  // constant nor a new state can drift past this gate: the exported set, and what
  // the model really emits across a matrix of states.
  function emittedTargets(): Set<string> {
    const base = makeDashboardState();
    const ids = new Set<string>();
    const states: DashboardStateOverrides[] = [
      {},
      { auth: { status: 'chrome-missing' } },
      { auth: { status: 'expired' } },
      { auth: { status: 'error' } },
      { auth: { status: 'unknown' } },
      { auth: { status: 'expired', hasCredentials: false } },
      { daemon: { running: false, healthy: false } },
      { daemon: { running: true, healthy: false } },
      { ideStatuses: [] },
      { tunnel: { status: 'error' } },
      { tunnel: { status: 'auto-disabled' } },
      { ideStatuses: [{ ...base.ideStatuses[0], mcpConfigured: false }] },
      { ideStatuses: [{ ...base.ideStatuses[0], mcpServerHealthy: false }] },
    ];
    for (const override of states) {
      const state = makeDashboardState(override);
      const model = selectReadiness({
        loading: false,
        auth: state.auth,
        settings: state.settings,
        daemon: state.daemon,
        tunnel: state.tunnel,
        ideStatuses: state.ideStatuses,
      });
      if (model.nextAction?.focusTargetId) ids.add(model.nextAction.focusTargetId);
      for (const issue of model.issues) if (issue.focusTargetId) ids.add(issue.focusTargetId);
    }
    return ids;
  }

  it('only emits targets that the exported readiness set declares', () => {
    const emitted = emittedTargets();

    expect(emitted.size).toBeGreaterThan(0);
    for (const id of emitted) expect(READINESS_FOCUS_TARGET_IDS, id).toContain(id);
  });

  // Destination tab for every target, including the per-tab h1 fallbacks that
  // navigate() uses when a target is absent.
  const TAB_OF: Array<[string, DashboardTabId]> = [
    ['account-settings-heading', 'settings'],
    ['browser-settings-heading', 'settings'],
    ['tool-safety-heading', 'settings'],
    ['editors-heading', 'setup'],
    ['local-service-heading', 'setup'],
    ['remote-access-heading', 'setup'],
    ['overview-heading', 'overview'],
    ['setup-heading', 'setup'],
    ['prompts-heading', 'prompts'],
    ['settings-heading', 'settings'],
  ];

  it('lists a destination tab for every declared readiness target', () => {
    for (const id of READINESS_FOCUS_TARGET_IDS) {
      expect(TAB_OF.map(([target]) => target), id).toContain(id);
    }
  });

  it.each(TAB_OF)('%s resolves to a programmatically focusable heading on %s', (id, tab) => {
    seed({ auth: { status: 'chrome-missing' } }, tab);
    render(<App />);

    const target = document.getElementById(id);
    expect(target, id).not.toBeNull();
    expect(target).toHaveAttribute('tabindex', '-1');
    expect(target!.tagName).toMatch(/^H[12]$/);
    act(() => target!.focus());
    expect(document.activeElement).toBe(target);
  });
});

describe('structural gates across all four tabs', () => {
  it.each(['overview', 'setup', 'prompts', 'settings'] as const)(
    '%s renders no positive tabindex, footer landmark, second h1 or external link',
    tab => {
      seed({}, tab);
      const { container } = render(<App />);

      const positive = Array.from(container.querySelectorAll('[tabindex]'))
        .filter(element => Number(element.getAttribute('tabindex')) > 0);
      expect(positive).toEqual([]);
      expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
      expect(container.querySelectorAll('h1')).toHaveLength(1);
      expect(container.querySelectorAll('a[href]')).toHaveLength(0);
    },
  );

  it('renders every id exactly once', () => {
    seed({ settings: { mcp: { toolProfile: { profile: 'custom' } } } }, 'settings');
    const { container } = render(<App />);

    const ids = Array.from(container.querySelectorAll('[id]')).map(element => element.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });
});

describe('no ambient animation in shipped CSS', () => {
  const sources = Object.entries(CSS_SOURCES);

  it('reads every stylesheet', () => {
    expect(sources.length).toBeGreaterThanOrEqual(10);
  });

  it.each(sources)('%s has no keyframes, infinite loop, or transition: all', (_path, css) => {
    expect(css).not.toMatch(/@keyframes/);
    expect(css).not.toMatch(/animation-iteration-count\s*:\s*infinite/);
    expect(css).not.toMatch(/animation\s*:[^;]*\binfinite\b/);
    expect(css).not.toMatch(/transition\s*:\s*all\b/);
    expect(css).not.toMatch(/transition-property\s*:\s*all\b/);
  });
});

function allStyleRules(): CSSStyleRule[] {
  const out: CSSStyleRule[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      const nested = (rule as CSSGroupingRule).cssRules;
      if ((rule as CSSStyleRule).selectorText !== undefined) out.push(rule as CSSStyleRule);
      // Layers are walked; media blocks are not, so only unconditional rules count.
      else if (nested && rule.constructor.name === 'CSSLayerBlockRule') walk(nested);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
  return out;
}

function rulesFor(selector: string): CSSStyleRule[] {
  return allStyleRules().filter(
    rule => rule.selectorText.split(',').map(part => part.trim()).includes(selector),
  );
}

describe('focus, hit-area and layout contracts (CSSOM)', () => {
  it('draws a themed focus ring on the programmatically focused panel', () => {
    const rules = rulesFor('.app-panel:focus-visible');

    expect(rules.length).toBeGreaterThan(0);
    const text = rules.map(rule => rule.cssText).join(' ');
    expect(text).toContain('var(--focus-ring)');
    expect(text).not.toMatch(/outline(-style)?\s*:\s*(none|0)/);
    // The panel scrolls and clips, so the ring must sit inside it.
    expect(text).toMatch(/outline-offset\s*:\s*-/);
  });

  it('keeps the tab panel the scroll container inside the main landmark', () => {
    const [host] = rulesFor('.app-panel-host');

    expect(host, '.app-panel-host').toBeDefined();
    expect(host!.style.display).toBe('flex');
    expect(host!.style.flexDirection).toBe('column');
    // Without it the flex item grows to its content and the panel never scrolls.
    expect(host!.style.minHeight).toMatch(/^0(px)?$/);
  });

  it('never removes an outline except for a non-focus-visible state', () => {
    for (const rule of allStyleRules()) {
      if (/outline(-style)?\s*:\s*(none|0)\b/.test(rule.cssText)) {
        expect(rule.selectorText, rule.cssText).toMatch(/:focus:not\(:focus-visible\)/);
      }
    }
  });

  it('does not force a 28px minimum onto checkboxes and radios', () => {
    const forced = allStyleRules().filter(rule => rule.style.minHeight === '28px');
    expect(forced.length).toBeGreaterThan(0);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const radio = document.createElement('input');
    radio.type = 'radio';
    const text = document.createElement('input');
    text.type = 'text';
    document.body.append(checkbox, radio, text);
    const hits = (element: Element) => forced.filter(rule => element.matches(rule.selectorText));

    expect(hits(checkbox).map(rule => rule.selectorText)).toEqual([]);
    expect(hits(radio).map(rule => rule.selectorText)).toEqual([]);
    expect(hits(text).length).toBeGreaterThan(0);
    for (const element of [checkbox, radio, text]) element.remove();
  });

  it('keeps a 24px hit area for the Prompts checkbox label and the settings switch', () => {
    const [label] = rulesFor('.prompt-check');
    expect(Number.parseFloat(label.style.minHeight)).toBeGreaterThanOrEqual(24);

    // The 18px track is extended by an invisible pseudo-element on each side.
    const [track] = rulesFor('.setting-switch');
    const [halo] = rulesFor('.setting-switch::after');
    const reach = Math.abs(Number.parseFloat(halo.style.top)) + Math.abs(Number.parseFloat(halo.style.bottom));
    expect(Number.parseFloat(track.style.height) + reach).toBeGreaterThanOrEqual(24);
  });

  it('sizes the tab strip from the tab count, not a hardcoded column count', () => {
    const [tabs] = rulesFor('.app-tabs');

    expect(tabs.cssText).not.toMatch(/repeat\(\s*\d/);
    expect(tabs.style.gridAutoFlow).toBe('column');
    expect(tabs.style.gridAutoColumns).toMatch(/1fr/);
  });
});
