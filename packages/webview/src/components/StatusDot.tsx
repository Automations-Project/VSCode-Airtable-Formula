import React from 'react';

type DotVariant = 'ok' | 'warn' | 'off' | 'err' | 'info';

const styles: Record<DotVariant, React.CSSProperties> = {
  ok:  { background: 'var(--at-green)',  boxShadow: '0 0 6px rgba(4,138,14,0.55)' },
  warn:{ background: 'var(--at-yellow)' },
  off: { background: 'var(--at-gray600)' },
  err:  { background: 'var(--at-red)',    boxShadow: '0 0 6px rgba(220,4,59,0.45)' },
  info: { background: 'var(--at-blue)',   boxShadow: '0 0 6px rgba(22,110,225,0.45)' },
};

export function StatusDot({ variant }: { variant: DotVariant }) {
  return <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, display: 'inline-block', ...styles[variant] }} />;
}
