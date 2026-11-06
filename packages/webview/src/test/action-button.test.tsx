import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActionButton } from '../components/ActionButton.js';

describe('ActionButton pending state', () => {
  it('stays focusable while pending: aria-disabled and aria-busy, never native disabled', () => {
    render(<ActionButton pending>Save</ActionButton>);
    const button = screen.getByRole('button', { name: 'Save' });

    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
    button.focus();
    expect(button).toHaveFocus();
  });

  // jsdom never blurs a disabled element, so focus retention itself cannot go red
  // here; the native-disabled assertion above is what pins it.
  it('ignores click, Enter and Space while pending', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ActionButton pending onClick={onClick}>Save</ActionButton>);
    const button = screen.getByRole('button', { name: 'Save' });

    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not submit its form while pending, from a click or implicit submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="Field" />
        <ActionButton type="submit" pending>Save</ActionButton>
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.type(screen.getByRole('textbox', { name: 'Field' }), 'x{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('runs its action when not pending', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ActionButton onClick={onClick}>Save</ActionButton>);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-disabled');
  });

  it('keeps native disabled for a genuinely unavailable, non-pending button', () => {
    render(<ActionButton disabled>Save</ActionButton>);

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
