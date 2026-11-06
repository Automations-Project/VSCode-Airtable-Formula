import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptDef } from '@shared/types.js';
import { resolveHostConfirmation } from '../lib/confirmation.js';
import { useStore } from '../store.js';
import { Prompts } from '../tabs/Prompts.js';
import { validatePromptDraft } from '../tabs/prompts/validation.js';
import { makeDashboardState } from './dashboard-state.fixture.js';
import { vscodeApiMock } from './test-setup.js';

function prompt(overrides: Partial<PromptDef> = {}): PromptDef {
  return {
    name: 'inspect-base',
    description: 'Inspect a base',
    arguments: [{ name: 'appId', description: 'Base', required: true }],
    template: '{appId}',
    isBuiltin: false,
    isModified: false,
    ...overrides,
  };
}

function seed(prompts: PromptDef[] = [prompt()]): void {
  useStore.setState({ ...makeDashboardState({ prompts: { prompts } }), activeTab: 'prompts' });
}

function posted(type: string): Array<Record<string, unknown> & { id: string }> {
  return vscodeApiMock.postMessage.mock.calls
    .map(([message]) => message as Record<string, unknown> & { id: string })
    .filter(message => message.type === type);
}

function lastPostedActionId(type: string): string {
  const id = posted(type).at(-1)?.id;
  if (!id) throw new Error(`no ${type} was posted`);
  return id;
}

function answerConfirmation(confirmed: boolean): void {
  const request = posted('confirmation:request').at(-1);
  if (!request) throw new Error('no confirmation was requested');
  act(() => resolveHostConfirmation(request.id, confirmed));
}

async function openEditor(user: ReturnType<typeof userEvent.setup>, name = /inspect-base/i): Promise<void> {
  await user.click(screen.getByRole('button', { name }));
}

/** Seeds one prompt and opens it, which is what most editor behaviour needs. */
async function renderPromptEditor(overrides: Partial<PromptDef> = {}) {
  const user = userEvent.setup();
  seed([prompt(overrides)]);
  const view = render(<Prompts />);
  await openEditor(user, new RegExp(overrides.name ?? 'inspect-base'));
  return { user, ...view };
}

async function editDescription(user: ReturnType<typeof userEvent.setup>, text: string): Promise<HTMLElement> {
  const description = screen.getByRole('textbox', { name: 'Description' });
  await user.clear(description);
  await user.type(description, text);
  return description;
}

function finish(id: string, outcome: { ok: boolean; error?: string; cancelled?: boolean }): void {
  act(() => useStore.getState().markActionDone(id, outcome));
}

describe('Prompt list', () => {
  beforeEach(() => seed());

  it('has the tab h1 and one list heading, and names built-in and modified prompts in text', () => {
    seed([
      prompt({ name: 'custom-one' }),
      prompt({ name: 'airtable-help', isBuiltin: true, isModified: true }),
    ]);
    render(<Prompts />);

    expect(screen.getByRole('heading', { level: 1, name: 'Prompts' })).toHaveAttribute('id', 'prompts-heading');
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings).toHaveLength(2);
    expect(headings[0]).toHaveTextContent('Slash commands');
    expect(headings[1]).toHaveTextContent('Reconnect clients after changes');
    const builtin = screen.getByRole('button', { name: /airtable-help/ });
    expect(builtin).toHaveTextContent('built-in');
    expect(builtin).toHaveTextContent('modified');
    expect(screen.getByRole('button', { name: /custom-one/ })).not.toHaveTextContent('built-in');
  });

  it('keeps reconnect guidance collapsed by default and discloses it with aria-expanded', async () => {
    const user = userEvent.setup();
    render(<Prompts />);

    const toggle = screen.getByRole('button', { name: /Reconnect clients/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Reload Window/)).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Reload Window/)).toBeVisible();
  });

  it('shows an empty state that points at New prompt', () => {
    seed([]);
    render(<Prompts />);

    expect(screen.getByText(/No prompts yet/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'New prompt' })).toHaveAttribute('id', 'new-prompt-button');
  });

  it('gives each row a stable id used for focus return', () => {
    render(<Prompts />);

    expect(screen.getByRole('button', { name: /inspect-base/ })).toHaveAttribute('id', 'prompt-row-inspect-base');
  });

  it('renders without inline presentation', () => {
    const { container } = render(<Prompts />);

    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});

describe('Prompt editor validation', () => {
  it('rejects duplicate argument names and disables Save', async () => {
    const user = userEvent.setup();
    seed();
    render(<Prompts />);

    await user.click(screen.getByRole('button', { name: /inspect-base/i }));
    await user.click(screen.getByRole('button', { name: 'Add argument' }));
    const names = screen.getAllByRole('textbox', { name: /Argument name/i });
    await user.type(names[1], 'appId');

    expect(screen.getByRole('alert')).toHaveTextContent('Argument names must be unique');
    expect(screen.getByRole('button', { name: 'Save prompt' })).toBeDisabled();
  });

  it('treats argument names that differ only by case as distinct', async () => {
    const { user } = await renderPromptEditor();
    await user.click(screen.getByRole('button', { name: 'Add argument' }));

    await user.type(screen.getAllByRole('textbox', { name: /Argument name/i })[1], 'AppId');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save prompt' })).toBeEnabled();
  });

  // Only a new prompt chooses its name (an existing prompt's name is locked).
  async function renderNewPromptEditor() {
    const user = userEvent.setup();
    seed();
    render(<Prompts />);
    await user.click(screen.getByRole('button', { name: 'New prompt' }));
    return { user, field: screen.getByRole('textbox', { name: 'Slash command name' }) };
  }

  it.each([
    ['starts with a digit', '1abc'],
    ['has uppercase letters', 'Abc'],
    ['has an underscore', 'a_b'],
    ['is over 64 characters', 'a'.repeat(65)],
  ])('rejects a prompt name that %s', async (_label, name) => {
    const { user, field } = await renderNewPromptEditor();

    await user.type(field, name);

    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save prompt' })).toBeDisabled();
  });

  it('accepts a 64-character lowercase hyphenated prompt name', async () => {
    const { user, field } = await renderNewPromptEditor();

    await user.type(field, `a${'-b'.repeat(31)}c`);

    expect((field as HTMLInputElement).value).toHaveLength(64);
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Save prompt' })).toBeEnabled();
  });

  it('rejects a new prompt that would overwrite an existing one', async () => {
    const user = userEvent.setup();
    seed();
    render(<Prompts />);
    await user.click(screen.getByRole('button', { name: 'New prompt' }));

    await user.type(screen.getByRole('textbox', { name: 'Slash command name' }), 'inspect-base');

    expect(screen.getByRole('alert')).toHaveTextContent('A prompt named inspect-base already exists');
    expect(screen.getByRole('button', { name: 'Save prompt' })).toBeDisabled();
  });

  // The host saves by name, so a "rename" would silently leave both prompts.
  // An existing prompt's name is therefore locked; a new prompt picks its name.
  describe('the name of an existing prompt', () => {
    const LOCKED = "Prompt names can't be changed after creation. Create a new prompt to use a different name.";

    async function openA() {
      const user = userEvent.setup();
      seed([prompt({ name: 'prompt-a' }), prompt({ name: 'prompt-b', description: 'Other' })]);
      render(<Prompts />);
      await user.click(screen.getByRole('button', { name: /prompt-a/ }));
      return { user, field: screen.getByRole('textbox', { name: 'Slash command name' }) };
    }

    it('is locked for an existing custom prompt, and says why', async () => {
      const { field } = await openA();

      expect(field).toBeDisabled();
      expect(field).toHaveValue('prompt-a');
      expect(field).toHaveAccessibleDescription(expect.stringContaining(LOCKED));
    });

    it('is locked for a built-in prompt with the same explanation', async () => {
      await renderPromptEditor({ name: 'airtable-help', isBuiltin: true, isModified: false });
      const field = screen.getByRole('textbox', { name: 'Slash command name' });

      expect(field).toBeDisabled();
      expect(field).toHaveAccessibleDescription(expect.stringContaining(LOCKED));
    });

    it('can never post a rename: a save keeps the prompt its own name', async () => {
      const { user, field } = await openA();

      await user.type(field, '-renamed');
      await editDescription(user, 'Changed');
      await user.click(screen.getByRole('button', { name: 'Save prompt' }));

      expect(field).toHaveValue('prompt-a');
      expect(posted('action:save-prompt').at(-1)?.prompt).toMatchObject({ name: 'prompt-a', description: 'Changed' });
    });

    it('stays editable for a new prompt, without the lock explanation', async () => {
      const user = userEvent.setup();
      seed();
      render(<Prompts />);
      await user.click(screen.getByRole('button', { name: 'New prompt' }));
      const field = screen.getByRole('textbox', { name: 'Slash command name' });

      expect(field).toBeEnabled();
      expect(field).not.toHaveAccessibleDescription(expect.stringContaining('after creation'));
      await user.type(field, 'fresh');
      expect(field).toHaveValue('fresh');
    });

    it('still saves other edits under its own name', async () => {
      const { user } = await openA();

      await editDescription(user, 'Changed');
      await user.click(screen.getByRole('button', { name: 'Save prompt' }));

      expect(posted('action:save-prompt').at(-1)?.prompt).toMatchObject({ name: 'prompt-a', description: 'Changed' });
    });
  });

  it('rejects an argument name that does not match the shared pattern', async () => {
    const { user } = await renderPromptEditor();
    await user.click(screen.getByRole('button', { name: 'Add argument' }));

    await user.type(screen.getAllByRole('textbox', { name: /Argument name/i })[1], '9lives');

    expect(screen.getByRole('alert')).toHaveTextContent('Start with a letter');
    expect(screen.getByRole('button', { name: 'Save prompt' })).toBeDisabled();
  });

  it('blocks Add argument at the shared maximum of 16', async () => {
    const args = Array.from({ length: 16 }, (_, index) => ({ name: `arg${index}`, description: '', required: false }));
    await renderPromptEditor({ arguments: args });

    expect(screen.getAllByRole('textbox', { name: /Argument name/i })).toHaveLength(16);
    expect(screen.getByRole('button', { name: 'Add argument' })).toBeDisabled();
  });

  it('rejects an over-long template without changing the typed text', async () => {
    const { user } = await renderPromptEditor();
    const template = screen.getByRole('textbox', { name: 'Template' });

    await user.clear(template);
    await user.click(template);
    await user.paste('x'.repeat(16_385));

    expect(screen.getByRole('alert')).toHaveTextContent('16,384 characters or fewer');
    expect((template as HTMLTextAreaElement).value).toHaveLength(16_385);
    expect(screen.getByRole('button', { name: 'Save prompt' })).toBeDisabled();
  });

  it('exposes the same rules as pure validation', () => {
    expect(validatePromptDraft(prompt()).arguments).toEqual({});
    expect(validatePromptDraft(prompt({ name: '' })).name).toBeDefined();
    expect(validatePromptDraft(prompt({ description: 'd'.repeat(2_049) })).description).toBeDefined();
    expect(validatePromptDraft(prompt({
      arguments: [
        { name: 'a', description: '', required: false },
        { name: 'a', description: '', required: false },
        { name: 'A', description: 'x'.repeat(2_049), required: false },
      ],
    }))).toMatchObject({
      arguments: { 1: 'Argument names must be unique.' },
      argumentDescriptions: { 2: expect.any(String) },
    });
    const tooMany = Array.from({ length: 17 }, (_, index) => ({ name: `a${index}`, description: '', required: false }));
    expect(validatePromptDraft(prompt({ arguments: tooMany })).form).toMatch(/at most 16/);
  });

  it('gives every input and textarea a visible associated label', async () => {
    const { user } = await renderPromptEditor();
    await user.click(screen.getByRole('button', { name: 'Add argument' }));

    const controls = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
    expect(controls.length).toBeGreaterThanOrEqual(8);
    for (const control of controls) {
      expect(control.labels?.length, control.outerHTML).toBeGreaterThan(0);
      expect(control.labels?.[0].textContent?.trim(), control.outerHTML).toBeTruthy();
      expect(control).not.toHaveAttribute('aria-label');
    }
    expect(screen.getByRole('textbox', { name: 'Argument name 1' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Argument description 2' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Argument 2 required' })).toBeVisible();
  });

  it('marks argument rows with the responsive prompt-argument class', async () => {
    const { user } = await renderPromptEditor();
    await user.click(screen.getByRole('button', { name: 'Add argument' }));

    const rows = document.querySelectorAll('.prompt-argument');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByRole('button', { name: 'Remove argument 1' })).toBeVisible();
  });

  it('renders the editor without inline presentation and without axe violations', async () => {
    const { container } = await renderPromptEditor();

    expect(container.querySelectorAll('[style]')).toHaveLength(0);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});

describe('Saving', () => {
  it('keeps edits and announces the host error after save fails', async () => {
    const { user } = await renderPromptEditor();

    const description = await editDescription(user, 'Unsaved description');
    await user.click(screen.getByRole('button', { name: 'Save prompt' }));
    const id = lastPostedActionId('action:save-prompt');

    finish(id, { ok: false, error: 'Prompt file is read-only' });

    expect(description).toHaveValue('Unsaved description');
    expect(screen.getByRole('alert')).toHaveTextContent('Prompt file is read-only');
    expect(screen.getByRole('button', { name: 'Save prompt' })).toBeEnabled();
  });

  it('falls back to a generic message when the host gives no error text', async () => {
    const { user } = await renderPromptEditor();
    await editDescription(user, 'Unsaved description');
    await user.click(screen.getByRole('button', { name: 'Save prompt' }));

    finish(lastPostedActionId('action:save-prompt'), { ok: false });

    expect(screen.getByRole('alert')).toHaveTextContent(/did not apply/i);
  });

  it('keeps the editor and reports a cancelled save as status, not as an error', async () => {
    const { user } = await renderPromptEditor();
    await editDescription(user, 'Unsaved description');
    await user.click(screen.getByRole('button', { name: 'Save prompt' }));

    finish(lastPostedActionId('action:save-prompt'), { ok: false, cancelled: true });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Save cancelled');
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Unsaved description');
  });

  it('exposes pending save as an aria-busy status and blocks a second submit', async () => {
    const { user } = await renderPromptEditor();
    await editDescription(user, 'Changed');
    const save = screen.getByRole('button', { name: 'Save prompt' });

    await user.click(save);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Saving prompt…');
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).toHaveAttribute('aria-busy', 'true');
    await user.click(save);
    expect(posted('action:save-prompt')).toHaveLength(1);

    finish(lastPostedActionId('action:save-prompt'), { ok: false, error: 'No' });
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy');
  });

  it('sends the edited prompt through the strict save message', async () => {
    const { user } = await renderPromptEditor();
    await editDescription(user, 'Changed');

    await user.click(screen.getByRole('button', { name: 'Save prompt' }));

    expect(posted('action:save-prompt').at(-1)?.prompt).toEqual(prompt({ description: 'Changed' }));
  });

  it('returns to the list and focuses the edited prompt row after a successful save', async () => {
    const { user } = await renderPromptEditor();
    await editDescription(user, 'Changed');
    await user.click(screen.getByRole('button', { name: 'Save prompt' }));

    finish(lastPostedActionId('action:save-prompt'), { ok: true });

    await waitFor(() => expect(screen.getByRole('button', { name: /inspect-base/ })).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Prompt saved');
    expect(screen.queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument();
    expect(useStore.getState().promptEditorDirty).toBe(false);
  });

  it('returns focus to New prompt after a new prompt is saved', async () => {
    const user = userEvent.setup();
    seed([]);
    render(<Prompts />);
    await user.click(screen.getByRole('button', { name: 'New prompt' }));
    await user.type(screen.getByRole('textbox', { name: 'Slash command name' }), 'fresh');
    await user.click(screen.getByRole('button', { name: 'Save prompt' }));

    finish(lastPostedActionId('action:save-prompt'), { ok: true });

    await waitFor(() => expect(screen.getByRole('button', { name: 'New prompt' })).toHaveFocus());
  });

  it('returns focus to New prompt when a new prompt is cancelled', async () => {
    const user = userEvent.setup();
    seed();
    render(<Prompts />);
    await user.click(screen.getByRole('button', { name: 'New prompt' }));

    await user.click(screen.getByRole('button', { name: 'Back to prompts' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'New prompt' })).toHaveFocus());
    expect(posted('confirmation:request')).toHaveLength(0);
  });

  it('keeps Save disabled until something actually changed', async () => {
    const { user } = await renderPromptEditor();
    const save = screen.getByRole('button', { name: 'Save prompt' });
    expect(save).toBeDisabled();

    const description = await editDescription(user, 'Changed');
    expect(save).toBeEnabled();

    await user.clear(description);
    await user.type(description, 'Inspect a base');
    expect(save).toBeDisabled();
  });

  it('is not held by an unrelated long action elsewhere in the dashboard', async () => {
    const { user } = await renderPromptEditor();
    // A bundled-Chromium download can run for ten minutes; it has nothing to do with prompts.
    act(() => { useStore.getState().installBrowser(); });
    await editDescription(user, 'Changed');

    const save = screen.getByRole('button', { name: 'Save prompt' });
    expect(save).toBeEnabled();
    expect(save).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Delete prompt' })).toBeEnabled();
    await user.click(save);
    expect(posted('action:save-prompt')).toHaveLength(1);
  });

  it('holds prompt actions while a discard confirmation is open', async () => {
    const { user } = await renderPromptEditor();
    await editDescription(user, 'Changed');
    await user.click(screen.getByRole('button', { name: 'Back to prompts' }));
    expect(useStore.getState().promptDiscardPending).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Save prompt' }));
    await user.click(screen.getByRole('button', { name: 'Delete prompt' }));

    expect(posted('action:save-prompt')).toHaveLength(0);
    expect(posted('action:delete-prompt')).toHaveLength(0);
    answerConfirmation(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save prompt' })).toBeEnabled());
  });

  it('refuses a prompt action in the store while another prompt action is in flight', () => {
    seed();
    const first = useStore.getState().savePrompt(prompt({ description: 'One' }));

    expect(first).not.toBeNull();
    expect(useStore.getState().deletePrompt('inspect-base')).toBeNull();
    expect(useStore.getState().resetPrompt('inspect-base')).toBeNull();
    finish(first!, { ok: true });
    expect(useStore.getState().deletePrompt('inspect-base')).not.toBeNull();
  });

  it('blocks a second save from a remounted editor while the first is in flight', async () => {
    const { user, unmount } = await renderPromptEditor();
    await editDescription(user, 'Changed');
    await user.click(screen.getByRole('button', { name: 'Save prompt' }));
    unmount();

    const remounted = userEvent.setup();
    render(<Prompts />);
    await remounted.click(screen.getByRole('button', { name: /inspect-base/i }));
    await editDescription(remounted, 'Changed again');

    expect(screen.getByRole('button', { name: 'Save prompt' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete prompt' })).toBeDisabled();
    expect(posted('action:save-prompt')).toHaveLength(1);
  });
});

describe('Delete and reset', () => {
  it('sends delete directly and leaves confirmation to the host modal', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { user } = await renderPromptEditor();

    await user.click(screen.getByRole('button', { name: 'Delete prompt' }));

    expect(posted('action:delete-prompt').at(-1)).toMatchObject({ name: 'inspect-base' });
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Deleting prompt…');
  });

  it('stays in the editor and announces Delete cancelled', async () => {
    const { user } = await renderPromptEditor();
    await user.click(screen.getByRole('button', { name: 'Delete prompt' }));

    finish(lastPostedActionId('action:delete-prompt'), { ok: false, error: 'Cancelled', cancelled: true });

    expect(screen.getByRole('status')).toHaveTextContent('Delete cancelled');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete prompt' })).toBeEnabled();
  });

  it('returns to the list after a delete and focuses New prompt, whose row is gone', async () => {
    const { user } = await renderPromptEditor();
    await user.click(screen.getByRole('button', { name: 'Delete prompt' }));
    useStore.setState({ prompts: { prompts: [] } });

    finish(lastPostedActionId('action:delete-prompt'), { ok: true });

    await waitFor(() => expect(screen.getByRole('button', { name: 'New prompt' })).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Prompt deleted');
  });

  it('offers Reset only for a modified built-in, sends it directly and announces Reset cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { user } = await renderPromptEditor({ name: 'airtable-help', isBuiltin: true, isModified: true });
    expect(screen.queryByRole('button', { name: 'Delete prompt' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Slash command name' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(posted('action:reset-prompt').at(-1)).toMatchObject({ name: 'airtable-help' });
    expect(confirm).not.toHaveBeenCalled();

    finish(lastPostedActionId('action:reset-prompt'), { ok: false, error: 'Cancelled', cancelled: true });

    expect(screen.getByRole('status')).toHaveTextContent('Reset cancelled');
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeEnabled();
  });

  it('does not offer Reset for an unmodified built-in', async () => {
    await renderPromptEditor({ name: 'airtable-help', isBuiltin: true, isModified: false });

    expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();
  });

  it('returns to the list and focuses the row after a successful reset', async () => {
    const { user } = await renderPromptEditor({ name: 'inspect-base', isBuiltin: true, isModified: true });
    await user.click(screen.getByRole('button', { name: 'Reset to default' }));

    finish(lastPostedActionId('action:reset-prompt'), { ok: true });

    await waitFor(() => expect(document.getElementById('prompt-row-inspect-base')).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Prompt reset to default');
  });
});

describe('Dirty exit protection', () => {
  it('leaves an untouched editor without asking', async () => {
    const { user } = await renderPromptEditor();

    await user.click(screen.getByRole('button', { name: 'Back to prompts' }));

    expect(posted('confirmation:request')).toHaveLength(0);
    await waitFor(() => expect(document.getElementById('prompt-row-inspect-base')).toHaveFocus());
  });

  it('tracks dirtiness in the store and clears it when the editor unmounts', async () => {
    const { user, unmount } = await renderPromptEditor();
    expect(useStore.getState().promptEditorDirty).toBe(false);

    await editDescription(user, 'Changed');
    expect(useStore.getState().promptEditorDirty).toBe(true);

    unmount();
    expect(useStore.getState().promptEditorDirty).toBe(false);
  });

  it('requests the host discard confirmation for unsaved Back and keeps the editor and focus on refusal', async () => {
    const { user } = await renderPromptEditor();
    await editDescription(user, 'Unsaved description');
    const back = screen.getByRole('button', { name: 'Back to prompts' });

    await user.click(back);

    expect(posted('confirmation:request')).toEqual([
      expect.objectContaining({ kind: 'discard-prompt-edits' }),
    ]);
    answerConfirmation(false);

    await waitFor(() => expect(back).toHaveFocus());
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Unsaved description');
    expect(useStore.getState().promptEditorDirty).toBe(true);
  });

  it('exits to the focused row once the host confirms the discard', async () => {
    const { user } = await renderPromptEditor();
    await editDescription(user, 'Unsaved description');
    await user.click(screen.getByRole('button', { name: 'Back to prompts' }));

    answerConfirmation(true);

    await waitFor(() => expect(document.getElementById('prompt-row-inspect-base')).toHaveFocus());
    expect(screen.queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument();
    expect(useStore.getState().promptEditorDirty).toBe(false);
    expect(screen.getByRole('status')).not.toHaveTextContent('saved');
  });

  it('asks only once while a discard confirmation is already open', async () => {
    const { user } = await renderPromptEditor();
    await editDescription(user, 'Unsaved description');
    const back = screen.getByRole('button', { name: 'Back to prompts' });

    await user.click(back);
    await user.click(back);

    expect(posted('confirmation:request')).toHaveLength(1);
    answerConfirmation(false);
    await waitFor(() => expect(useStore.getState().promptDiscardPending).toBe(false));
  });

  it('does not treat a guard-refused navigation as accepted', async () => {
    const { user } = await renderPromptEditor();
    await editDescription(user, 'Unsaved description');
    const navigate = vi.fn();

    const pending = useStore.getState().guardPromptNavigation(navigate);
    answerConfirmation(false);

    await expect(pending).resolves.toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
