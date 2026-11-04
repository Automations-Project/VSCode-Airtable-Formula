import React from 'react';

interface FeedbackProps {
  variant?: 'info' | 'success' | 'warning' | 'error';
  children: React.ReactNode;
  className?: string;
}

export function Feedback({
  variant = 'info',
  children,
  className,
}: FeedbackProps) {
  const classes = ['feedback', className].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      data-variant={variant}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
