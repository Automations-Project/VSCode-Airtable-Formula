import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App.js';
import { IdeIcon, hasIdeIcon } from '../components/IdeIcon.js';
import { useStore } from '../store.js';
import { makeDashboardState } from './dashboard-state.fixture.js';

const ICONS = import.meta.glob('../assets/icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('rendered tabs carry no inline style attributes', () => {
  it.each(['overview', 'setup', 'prompts', 'settings'] as const)(
    '%s renders no inline style attributes',
    activeTab => {
      useStore.setState({
        ...makeDashboardState(),
        activeTab,
        loading: false,
      });
      const { container } = render(<App />);

      expect(container.querySelectorAll('[style]')).toHaveLength(0);
    },
  );

  it('renders no inline style on the Prompt editor or expanded Settings disclosures', async () => {
    const user = userEvent.setup();
    useStore.setState({ ...makeDashboardState(), activeTab: 'prompts', loading: false });
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: 'New prompt' }));
    expect(container.querySelectorAll('[style]')).toHaveLength(0);

    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    for (const name of ['Diagnostics', 'Advanced runtime']) {
      await user.click(await screen.findByRole('button', { name }));
    }
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});

describe('vendored SVG assets are CSP-safe as shipped', () => {
  const entries = Object.entries(ICONS);

  it('finds the icon set', () => {
    expect(entries.length).toBeGreaterThanOrEqual(12);
  });

  // dangerouslySetInnerHTML injects these verbatim. A strict style-src blocks
  // style="" attributes and <style> blocks, and any script/handler/external
  // reference would be an injection or exfiltration vector.
  it.each(entries)('%s has no style, script, handler or external reference', (_path, svg) => {
    expect(svg).not.toMatch(/\sstyle\s*=/i);
    expect(svg).not.toMatch(/<style[\s>]/i);
    expect(svg).not.toMatch(/<script[\s>]/i);
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
    expect(svg).not.toMatch(/foreignObject/i);
    expect(svg).not.toMatch(/(?:xlink:)?href\s*=/i);
    expect(svg).not.toMatch(/<image[\s>]/i);
    expect(svg).not.toMatch(/url\(\s*['"]?(?!#)/i);
  });

  it('IdeIcon injects the asset without rewriting it', () => {
    const { container } = render(<IdeIcon ideId="cursor" size={20} />);

    expect(container.querySelector('svg')).toHaveAttribute('width', '20');
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('ships logos for the twelve vendored ids only', () => {
    expect(['cursor', 'windsurf', 'windsurf-next', 'claude-code', 'claude-desktop', 'cline', 'amp', 'opencode', 'codex-cli', 'zed', 'helix', 'neovim', 'mcp'].every(id => hasIdeIcon(id as never))).toBe(true);
    expect(hasIdeIcon('gemini-cli')).toBe(false);
    expect(render(<IdeIcon ideId="gemini-cli" />).container.innerHTML).toBe('');
  });
});
