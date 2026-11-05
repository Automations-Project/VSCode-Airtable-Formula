import React from 'react';

interface SectionProps {
  id?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Marks the region as updating (e.g. a lifecycle action is in flight). */
  busy?: boolean;
}

export function Section({
  id,
  title,
  description,
  actions,
  children,
  className,
  busy = false,
}: SectionProps) {
  const headingId = id ? `${id}-heading` : undefined;
  const classes = ['section', className].filter(Boolean).join(' ');

  return (
    <section className={classes} aria-labelledby={headingId} aria-busy={busy || undefined}>
      <div className="section-heading">
        <div className="section-heading__copy">
          {/* tabIndex -1: a programmatic focus target for navigate(), never a tab stop. */}
          <h2 id={headingId} className="section-title" tabIndex={headingId ? -1 : undefined}>{title}</h2>
          {description && <p className="section-description">{description}</p>}
        </div>
        {actions && <div className="section-actions">{actions}</div>}
      </div>
      <div className="section-body">{children}</div>
    </section>
  );
}
