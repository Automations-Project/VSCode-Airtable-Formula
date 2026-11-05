import React from 'react';

export type DotVariant = 'ok' | 'warn' | 'off' | 'err' | 'info';

/** Decorative status marker. Always pair it with literal status text. */
export function StatusDot({ variant }: { variant: DotVariant }) {
  return <span className="status-dot" data-variant={variant} aria-hidden="true" />;
}
