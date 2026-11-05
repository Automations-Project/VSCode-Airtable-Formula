import React from 'react';

interface DisclosureProps {
  /** Stable prefix: the heading is `<id>-heading` (a navigate() focus target), the panel `<id>-panel`. */
  id: string;
  title: string;
  /** Short state text shown beside the title, visible while collapsed. */
  summary?: React.ReactNode;
  /** 2 for a top-level Setup section, 3 for one nested inside it. */
  level?: 2 | 3;
  defaultOpen?: boolean;
  /** Opens the panel whenever this turns true (e.g. an error appears while collapsed). */
  forceOpen?: boolean;
  /** Controlled mode: the caller owns `open` (used to keep one nested panel open at a time). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

/**
 * Progressive disclosure: a button inside the heading toggles a panel. It is
 * not `<details>` because callers need a controlled/forced open state and a
 * focusable heading. The panel element always exists so `aria-controls` is
 * valid, but its children mount only while open (one snippet at a time).
 */
export function Disclosure({
  id,
  title,
  summary,
  level = 2,
  defaultOpen = false,
  forceOpen = false,
  open: openProp,
  onOpenChange,
  children,
}: DisclosureProps) {
  const [localOpen, setLocalOpen] = React.useState(defaultOpen || forceOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : localOpen;

  React.useEffect(() => {
    if (forceOpen && !controlled) setLocalOpen(true);
  }, [forceOpen, controlled]);

  const headingId = `${id}-heading`;
  const panelId = `${id}-panel`;
  const Heading = level === 2 ? 'h2' : 'h3';

  const toggle = () => {
    if (!controlled) setLocalOpen(!open);
    onOpenChange?.(!open);
  };

  return (
    <section
      className={level === 2 ? 'section disclosure-section' : 'disclosure-section disclosure-section--nested'}
      aria-labelledby={headingId}
    >
      <div className="disclosure-header">
        {/* tabIndex -1: a programmatic focus target for navigate(), never a tab stop. */}
        <Heading id={headingId} className="section-title disclosure-title" tabIndex={-1}>
          <button
            type="button"
            className="disclosure-trigger"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={toggle}
          >
            <span className="disclosure-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
            {title}
          </button>
        </Heading>
        {summary && <span className="disclosure-summary">{summary}</span>}
      </div>
      <div id={panelId} className="disclosure-panel" hidden={!open}>
        {open && children}
      </div>
    </section>
  );
}
