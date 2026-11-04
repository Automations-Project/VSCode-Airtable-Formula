import React from 'react';

interface SectionProps {
  id?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Section({
  id,
  title,
  description,
  actions,
  children,
  className,
}: SectionProps) {
  const headingId = id ? `${id}-heading` : undefined;
  const classes = ['section', className].filter(Boolean).join(' ');

  return (
    <section className={classes} aria-labelledby={headingId}>
      <div className="section-heading">
        <div className="section-heading__copy">
          <h2 id={headingId} className="section-title">{title}</h2>
          {description && <p className="section-description">{description}</p>}
        </div>
        {actions && <div className="section-actions">{actions}</div>}
      </div>
      <div className="section-body">{children}</div>
    </section>
  );
}
