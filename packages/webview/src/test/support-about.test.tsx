import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '../tabs/Settings.js';
import { useStore } from '../store.js';
import { makeDashboardState } from './dashboard-state.fixture.js';

describe('Settings Support and About', () => {
  const openLink = vi.fn(() => '0123456789abcdef01234567');

  beforeEach(() => {
    openLink.mockClear();
    useStore.setState({
      ...makeDashboardState(),
      openLink,
    });
  });

  it('shows the extension and bundled MCP server versions', () => {
    render(<Settings />);

    expect(screen.getByText('2.1.32')).toBeVisible();
    expect(screen.getByText('2.4.15')).toBeVisible();
  });

  it.each([
    ['Open documentation', 'docs'],
    ['Open changelog', 'changelog'],
    ['Open GitHub repository', 'github'],
    ['Open Chrome website', 'chrome'],
  ] as const)('routes %s through the opaque %s link id', async (name, link) => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole('button', { name }));

    expect(openLink).toHaveBeenCalledWith(link);
  });
});
