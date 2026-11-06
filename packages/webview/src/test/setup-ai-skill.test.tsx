import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiSkillClient } from '@shared/types.js';
import { App } from '../App.js';
import type { ActionOutcome } from '../store.js';
import { useStore } from '../store.js';
import { Setup } from '../tabs/Setup.js';
import { CLIENTS, makeDashboardState, type DashboardStateOverrides } from './dashboard-state.fixture.js';
import { vscodeApiMock } from './test-setup.js';

const postMessage = vscodeApiMock.postMessage;

function seed(overrides: DashboardStateOverrides = {}): void {
  useStore.setState({
    ...makeDashboardState({ aiSkillClients: CLIENTS, versions: { extension: '2.3.0' }, ...overrides }),
    activeTab: 'setup',
    loading: false,
  });
}

/** CLIENTS with the Gemini CLI row in another state. */
function withGemini(status: AiSkillClient['status']): AiSkillClient[] {
  return CLIENTS.map(client => (client.id === 'gemini-cli' ? { ...client, status } : client));
}

function section(): HTMLElement {
  return screen.getByRole('region', { name: 'AI skill' });
}

/** The skill's own state line (the section also holds the action's result region). */
function statusLine(): HTMLElement {
  return within(section()).getAllByRole('status').find(node => node.classList.contains('service-status')) as HTMLElement;
}

/** The host answers the last skill action and pushes the state it produced, as one update. */
function hostAnswers(outcome: ActionOutcome, clients: AiSkillClient[]): void {
  const message = postMessage.mock.calls
    .map(([m]) => m as { type: string; id: string })
    .filter(m => m.type === 'action:installSkill')
    .at(-1);
  if (!message) throw new Error('no action:installSkill was posted');
  act(() => {
    useStore.setState({ aiSkillClients: clients });
    useStore.getState().markActionDone(message.id, outcome);
  });
}

describe('AI skill section', () => {
  const navigate = vi.fn();
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    seed();
  });

  it('lists the clients found on this machine with mark, directory and status, standard folder first', () => {
    render(<Setup navigate={navigate} />);

    const rows = within(screen.getByRole('list', { name: 'AI clients' })).getAllByRole('listitem');
    // The vendored Cursor logo carries its own <title>; the mark is aria-hidden, so it is not the name.
    expect(rows.map(r => within(r).getByText(/Standard skills folder|Cursor|Gemini CLI/, { ignore: 'script, style, title' }).textContent))
      .toEqual(['Standard skills folder', 'Cursor', 'Gemini CLI']);
    expect(rows[1].querySelector('.ide-icon')).not.toBeNull();
    expect(rows[2].querySelector('.monogram')?.textContent).toBe('G');
    expect(rows[2]).toHaveTextContent('~/.gemini/skills');
    expect(rows[2]).toHaveTextContent('Not installed');
    expect(rows[0].querySelector('.monogram')).toBeNull();          // folder icon, not a letter
    expect(rows[0]).toHaveTextContent('~/.agents/skills');
    expect(rows[0]).toHaveTextContent('Installed');
    for (const row of rows) {
      expect(row.querySelector('.monogram, .ide-icon, svg')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(within(section()).getByText('One folder, installed wherever the AI clients on this machine read skills.')).toBeInTheDocument();
  });

  it('offers Install skill while a client is missing and posts action:installSkill', async () => {
    render(<Setup navigate={navigate} />);

    const install = screen.getByRole('button', { name: 'Install skill' });
    expect(install).toHaveAttribute('data-variant', 'primary');
    await user.click(install);

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'action:installSkill' }));
    expect(install).toHaveAttribute('aria-busy', 'true');
  });

  it('offers Update skill when the only problem is an outdated folder, and no button when all are installed', () => {
    seed({ aiSkillClients: withGemini('outdated') });
    const { unmount } = render(<Setup navigate={navigate} />);

    expect(screen.getByRole('button', { name: 'Update skill' })).toHaveAttribute('data-variant', 'secondary');
    expect(screen.queryByRole('button', { name: 'Install skill' })).not.toBeInTheDocument();
    unmount();

    seed({ aiSkillClients: withGemini('installed') });
    render(<Setup navigate={navigate} />);

    expect(screen.queryByRole('button', { name: 'Install skill' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update skill' })).not.toBeInTheDocument();
  });

  it('summarises the install in one line', () => {
    render(<Setup navigate={navigate} />);

    expect(statusLine().textContent).toBe('Installed in 2 of 3 folders');
    expect(statusLine().querySelector('.status-dot')).toHaveAttribute('data-variant', 'warn');

    act(() => useStore.setState({ aiSkillClients: withGemini('installed') }));
    expect(statusLine().textContent).toBe('Installed in 3 folders at version 2.3.0');
    expect(statusLine().querySelector('.status-dot')).toHaveAttribute('data-variant', 'ok');

    act(() => useStore.setState({
      aiSkillClients: CLIENTS.map(client => (client.status === 'absent' ? client : { ...client, status: 'missing' })),
    }));
    expect(statusLine().textContent).toBe('Not installed');
    expect(statusLine().querySelector('.status-dot')).toHaveAttribute('data-variant', 'err');

    act(() => useStore.setState({ aiSkillClients: CLIENTS.filter(client => client.id === 'agents') }));
    expect(statusLine().textContent).toBe('Installed in 1 folder at version 2.3.0');
  });

  it('counts folders, not rows, when two clients read the same directory', () => {
    seed({
      aiSkillClients: [
        CLIENTS[0],
        CLIENTS[1],
        { id: 'codex', name: 'Codex', ideId: 'codex-cli', dir: '~/.agents/skills', status: 'installed', canonical: true },
      ],
    });
    render(<Setup navigate={navigate} />);

    expect(statusLine().textContent).toBe('Installed in 2 folders at version 2.3.0');
    const rows = within(screen.getByRole('list', { name: 'AI clients' })).getAllByRole('listitem');
    expect(rows.map(row => row.querySelector('.skill-client__name')?.textContent)).toEqual(['Standard skills folder', 'Cursor', 'Codex']);
  });

  it('collapses the rest, grouped by whether the standard folder already covers them', async () => {
    render(<Setup navigate={navigate} />);

    const summary = screen.getByText('2 more supported clients');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await user.click(summary);

    expect(screen.getByRole('heading', { name: 'Already covered by the standard folder (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Get their own folder the next time you install (1)' })).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('Devin')).toBeInTheDocument();
  });

  it('omits an empty group', async () => {
    seed({ aiSkillClients: CLIENTS.filter(client => client.id !== 'devin') });
    render(<Setup navigate={navigate} />);

    await user.click(screen.getByText('1 more supported client'));

    expect(screen.getByRole('heading', { name: 'Already covered by the standard folder (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Get their own folder/ })).not.toBeInTheDocument();
  });

  it('explains project scope without a folder and offers no install', () => {
    seed({ settings: { ai: { installScope: 'project' } }, aiSkillClients: [] });
    render(<Setup navigate={navigate} />);

    expect(statusLine().textContent).toBe('Open a folder to install into a project, or switch the scope to this machine.');
    expect(statusLine().querySelector('.status-dot')).toHaveAttribute('data-variant', 'off');
    expect(screen.queryByRole('button', { name: 'Install skill' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'AI clients' })).not.toBeInTheDocument();
    expect(within(section()).getByText('One folder, installed into the open workspace for the clients detected here.')).toBeInTheDocument();
    expect(within(section()).getByText(/^Scope: open workspace/)).toBeInTheDocument();
  });

  it('Change goes to the Settings section that holds the scope select', async () => {
    render(<Setup navigate={navigate} />);

    expect(within(section()).getByText(/^Scope: this machine/)).toHaveTextContent('Scope: this machine · Change');
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(navigate).toHaveBeenCalledWith('settings', 'formula-scripting-heading');
  });

  it('Change lands on the scope select section in the real app', async () => {
    // Like the browser, run navigate()'s frame callback after React has committed the click.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      setTimeout(() => callback(0), 0);
      return 0;
    });
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Change' }));

    await waitFor(() => expect(useStore.getState().activeTab).toBe('settings'));
    await waitFor(() => expect(document.getElementById('formula-scripting-heading')).toHaveFocus());
  });

  it('confirms an install after its button goes away and moves focus to the section heading', async () => {
    render(<Setup navigate={navigate} />);

    await user.click(screen.getByRole('button', { name: 'Install skill' }));
    hostAnswers({ ok: true }, withGemini('installed'));

    expect(screen.queryByRole('button', { name: 'Install skill' })).not.toBeInTheDocument();
    expect(within(section()).getByText('Skill installed.')).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById('ai-skill-heading')).toHaveFocus());
  });

  it('confirms an update in the same words', async () => {
    seed({ aiSkillClients: withGemini('outdated') });
    render(<Setup navigate={navigate} />);

    await user.click(screen.getByRole('button', { name: 'Update skill' }));
    hostAnswers({ ok: true }, withGemini('installed'));

    expect(within(section()).getByText('Skill updated.')).toBeInTheDocument();
  });

  it('shows the host error when the install fails, and keeps the button', async () => {
    render(<Setup navigate={navigate} />);

    await user.click(screen.getByRole('button', { name: 'Install skill' }));
    hostAnswers({ ok: false, error: 'EACCES: ~/.gemini/skills' }, CLIENTS);

    expect(within(section()).getByRole('alert')).toHaveTextContent('EACCES: ~/.gemini/skills');
    expect(screen.getByRole('button', { name: 'Install skill' })).not.toHaveAttribute('aria-busy');
  });
});
