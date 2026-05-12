/**
 * Pure formula completions engine — zero vscode imports.
 * Derives all completion items from FUNCTION_REGISTRY (D-06: no separate FUNCTION_SIGNATURES).
 */

import type { LsCompletionItem, LsPosition } from '../../types.js';
import { LsCompletionItemKind } from '../../types.js';
import { FUNCTION_REGISTRY, CALLABLE_CONSTANTS } from './registry.js';

/**
 * Returns completion items for Airtable formula language.
 *
 * - Function items derived from FUNCTION_REGISTRY with kind=Function (2)
 * - TRUE/FALSE overridden to kind=Constant (20) — gap fix D-05
 * - Remaining CALLABLE_CONSTANTS (NOW, TODAY, BLANK) added as kind=Constant (20)
 * - Date unit strings added as kind=Value (11)
 *
 * Pitfall 4: insertText for function items is a single tab stop `NAME($0)`.
 * Do NOT expand to multi-parameter snippets — signature help handles navigation.
 */
export function formulaCompletions(_text: string, _pos: LsPosition): LsCompletionItem[] {
  const items: LsCompletionItem[] = [];

  // 1. Function items from FUNCTION_REGISTRY
  for (const [name, info] of Object.entries(FUNCTION_REGISTRY)) {
    items.push({
      label: name,
      kind: LsCompletionItemKind.Function,
      detail: info.category,
      documentation: { kind: 'markdown', value: `**${info.signature}**\n\n${info.description}` },
      insertText: `${name}($0)`,
    });
  }

  // 2. Override TRUE/FALSE to Constant kind (gap fix D-05 — they are in FUNCTION_REGISTRY but
  //    behave as constants and can be used without parentheses)
  for (const name of ['TRUE', 'FALSE'] as const) {
    const existing = items.find(i => i.label === name);
    if (existing) {
      existing.kind = LsCompletionItemKind.Constant;
    }
  }

  // 3. Add remaining CALLABLE_CONSTANTS (NOW, TODAY, BLANK) that are not in FUNCTION_REGISTRY
  for (const name of CALLABLE_CONSTANTS) {
    if (!FUNCTION_REGISTRY[name]) {
      items.push({
        label: name,
        kind: LsCompletionItemKind.Constant,
        insertText: name,
      });
    }
  }

  // 4. Date unit string completions (completions.ts lines 481-492 analog)
  const dateUnits = ['days', 'weeks', 'months', 'years', 'hours', 'minutes', 'seconds'];
  for (const unit of dateUnits) {
    items.push({
      label: `'${unit}'`,
      kind: LsCompletionItemKind.Value,
      detail: 'Date/Time unit',
      insertText: `'${unit}'`,
    });
  }

  return items;
}
