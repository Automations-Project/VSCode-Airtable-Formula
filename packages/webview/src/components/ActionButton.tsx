import React from 'react';

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  /**
   * An action this button starts (or one it conflicts with) is in flight. The
   * button stays focusable and announces busy, but ignores activation.
   */
  pending?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * A pending button is `aria-disabled`, never natively `disabled`: Chromium
 * blurs a focused button the moment it becomes disabled, which drops focus to
 * <body> right after the user clicked it. Native `disabled` is kept only for a
 * button that is genuinely unavailable while nothing is pending.
 */
export function ActionButton({
  variant = 'secondary',
  pending = false,
  disabled,
  className,
  children,
  type = 'button',
  onClick,
  ...props
}: ActionButtonProps) {
  const classes = ['action-button', className].filter(Boolean).join(' ');

  return (
    <button
      {...props}
      type={type}
      className={classes}
      data-variant={variant}
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      disabled={!pending && disabled}
      onClick={event => {
        // Click, Enter, Space and implicit form submission all arrive here.
        if (pending) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {children}
    </button>
  );
}
