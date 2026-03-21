import React from 'react';
import type { AiFileStatus } from '@shared/types.js';

const pillStyles: Record<AiFileStatus, React.CSSProperties> = {
  ok:      { background: 'var(--bg-success)', color: 'var(--fg-ok)',  border: '1px solid rgba(4,138,14,0.3)' },
  missing: { background: 'var(--bg-error)',   color: 'var(--fg-err)', border: '1px solid rgba(220,4,59,0.2)' },
  partial: { background: 'var(--bg-warn)',    color: 'var(--fg-warn)',border: '1px solid rgba(255,186,5,0.2)' },
};

export function Pill({ label, status }: { label: string; status: AiFileStatus }) {
  return (
    <span style={{
      fontSize: 9, padding: '2px 7px', borderRadius: 10, fontWeight: 600,
      fontFamily: 'var(--font-mono)', letterSpacing: '0.01em',
      ...pillStyles[status],
    }}>
      {label}
    </span>
  );
}
