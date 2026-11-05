import React from 'react';

interface ProgressFieldProps {
  label: string;
  /** Known completion, 0-100. Out-of-range values are clamped. */
  value: number;
}

/** Native `<progress>` with a visible label: real progressbar semantics, no inline width. */
export function ProgressField({ label, value }: ProgressFieldProps) {
  const id = React.useId();
  const percent = Math.min(100, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));

  return (
    <div className="progress-field">
      <label htmlFor={id}>{label}</label>
      <progress id={id} max={100} value={percent}>
        {percent}%
      </progress>
      <span aria-hidden="true">{percent}%</span>
    </div>
  );
}
