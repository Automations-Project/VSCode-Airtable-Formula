import React from 'react';
import type { AiSkillStatus } from '@shared/types.js';

const STATUS_TEXT: Record<AiSkillStatus, string> = {
  installed: 'installed',
  outdated: 'outdated',
  missing: 'not installed',
  unsupported: 'not supported',
};

// Reuses the pill styles: unsupported is a fact about the editor, not a fault, so never red.
const VARIANT: Record<AiSkillStatus, 'ok' | 'partial' | 'missing' | 'neutral'> = {
  installed: 'ok',
  outdated: 'partial',
  missing: 'missing',
  unsupported: 'neutral',
};

/** A status chip. The status is spelled out, never colour-only; a non-empty `label` follows it (e.g. `v2.3.0`). */
export function Pill({ label, status }: { label: string; status: AiSkillStatus }) {
  return (
    <span className="pill" data-status={VARIANT[status]}>
      {label ? `${STATUS_TEXT[status]} ${label}` : STATUS_TEXT[status]}
    </span>
  );
}
