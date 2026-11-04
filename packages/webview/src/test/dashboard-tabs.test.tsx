import React, { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DashboardTabs } from '../components/DashboardTabs.js';

const tabs = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'setup' as const, label: 'Setup' },
  { id: 'prompts' as const, label: 'Prompts' },
  { id: 'settings' as const, label: 'Settings' },
];

describe('DashboardTabs', () => {
  it('uses one roving tab stop', () => {
    render(
      <DashboardTabs
        tabs={tabs}
        activeTab="setup"
        onRequestSelect={() => true}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Setup' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Prompts' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('tabindex', '-1');
  });

  it('automatically activates arrows, Home, End, and wrapping', async () => {
    const user = userEvent.setup();
    const onRequestSelect = vi.fn().mockResolvedValue(true);

    function Harness() {
      const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['id']>('overview');
      return (
        <DashboardTabs
          tabs={tabs}
          activeTab={activeTab}
          onRequestSelect={async id => {
            const accepted = await onRequestSelect(id);
            if (accepted) setActiveTab(id);
            return accepted;
          }}
        />
      );
    }

    render(<Harness />);

    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    await user.keyboard('{ArrowRight}');
    expect(onRequestSelect).toHaveBeenLastCalledWith('setup');
    expect(screen.getByRole('tab', { name: 'Setup' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Setup' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Setup' })).toHaveAttribute('tabindex', '0');
    expect(overview).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{End}');
    expect(onRequestSelect).toHaveBeenLastCalledWith('settings');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(onRequestSelect).toHaveBeenLastCalledWith('overview');
    expect(overview).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(onRequestSelect).toHaveBeenLastCalledWith('settings');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(onRequestSelect).toHaveBeenLastCalledWith('overview');
    expect(overview).toHaveFocus();
  });

  it('restores focus to the selected tab when async selection is rejected', async () => {
    const user = userEvent.setup();
    const onRequestSelect = vi.fn().mockResolvedValue(false);
    render(
      <DashboardTabs
        tabs={tabs}
        activeTab="overview"
        onRequestSelect={onRequestSelect}
      />,
    );

    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    await user.keyboard('{ArrowRight}');

    await waitFor(() => expect(overview).toHaveFocus());
    expect(onRequestSelect).toHaveBeenCalledWith('setup');
  });

  it('restores a late denial to the latest selected tab after rerender', async () => {
    let resolveSelection!: (accepted: boolean) => void;
    const onRequestSelect = vi.fn(() => new Promise<boolean>(resolve => {
      resolveSelection = resolve;
    }));
    const { rerender } = render(
      <DashboardTabs
        tabs={tabs}
        activeTab="overview"
        onRequestSelect={onRequestSelect}
      />,
    );

    screen.getByRole('tab', { name: 'Overview' }).focus();
    screen.getByRole('tab', { name: 'Overview' }).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    rerender(
      <DashboardTabs
        tabs={tabs}
        activeTab="settings"
        onRequestSelect={onRequestSelect}
      />,
    );
    screen.getByRole('tab', { name: 'Setup' }).focus();

    await act(async () => resolveSelection(false));

    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();
  });

  it('treats a thrown selection promise as a denial', async () => {
    const user = userEvent.setup();
    const onRequestSelect = vi.fn().mockRejectedValue(new Error('navigation unavailable'));
    render(
      <DashboardTabs
        tabs={tabs}
        activeTab="overview"
        onRequestSelect={onRequestSelect}
      />,
    );

    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    await user.keyboard('{ArrowRight}');

    await waitFor(() => expect(overview).toHaveFocus());
  });
});
