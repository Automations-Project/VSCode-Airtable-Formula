import React from 'react';
import type { AiFileStatus } from '@shared/types.js';

const STATUS_TEXT: Record<AiFileStatus, string> = {
  ok: 'ready',
  partial: 'partial',
  missing: 'missing',
};

/** A file-group status chip. The status is spelled out, never colour-only. */
export function Pill({ label, status }: { label: string; status: AiFileStatus }) {
  return (
    <span className="pill" data-status={status}>
      {label}: {STATUS_TEXT[status]}
    </span>
  );
}
