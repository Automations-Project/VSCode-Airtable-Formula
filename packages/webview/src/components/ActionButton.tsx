import React from 'react';

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  pending?: boolean;
}

export function ActionButton({
  variant = 'secondary',
  pending = false,
  disabled,
  className,
  children,
  type = 'button',
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
      disabled={disabled || pending}
    >
      {children}
    </button>
  );
}
