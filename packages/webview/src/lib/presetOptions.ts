export interface NumberPreset {
  value: number;
  label: string;
}

/**
 * Select options for a numeric setting: the presets, plus the current value when
 * it is another valid integer. A value outside the presets is never coerced to
 * one and never renders as a blank select.
 */
export function presetOptions(
  presets: readonly NumberPreset[],
  current: number,
  describeCurrent: (value: number) => string,
): Array<{ value: string; label: string }> {
  const options = presets.map(p => ({ value: String(p.value), label: p.label }));
  if (!presets.some(p => p.value === current)) {
    options.push({ value: String(current), label: `${describeCurrent(current)} (current)` });
    options.sort((a, b) => Number(a.value) - Number(b.value));
  }
  return options;
}
