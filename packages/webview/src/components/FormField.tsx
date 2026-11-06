import React from 'react';

/** Attributes a field spreads onto its native control so label, help and error stay wired. */
export interface FormControlProps {
  id: string;
  required?: true;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

interface FormFieldProps {
  label: string;
  description?: React.ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: (control: FormControlProps) => React.ReactNode;
}

export function FormField({ label, description, error, required, className, children }: FormFieldProps) {
  const base = React.useId();
  const controlId = `${base}-control`;
  const descriptionId = `${base}-description`;
  const errorId = `${base}-error`;
  const describedBy = [description ? descriptionId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');

  const control: FormControlProps = {
    id: controlId,
    ...(required ? { required: true as const } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(error ? { 'aria-invalid': true as const } : {}),
  };

  return (
    <div className={['form-field', className].filter(Boolean).join(' ')}>
      <label className="form-field__label" htmlFor={controlId} data-required={required || undefined}>
        {label}
      </label>
      {children(control)}
      {description && <p id={descriptionId} className="form-field__description">{description}</p>}
      {error && <p id={errorId} className="form-field__error" role="alert">{error}</p>}
    </div>
  );
}
