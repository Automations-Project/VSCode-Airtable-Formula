/**
 * Canonical "is this column visible" predicate for a raw Airtable view
 * `columnOrder` entry ({ columnId, visibility? }).
 *
 * Airtable's internal API omits the `visibility` key entirely for a visible
 * column in some responses (most notably a column that was just shown), so an
 * ABSENT key means VISIBLE, not hidden — visibility is only ever explicitly
 * `false` for a hidden column. A naive truthy check (`c.visibility`) gets this
 * backwards for the absent-key case.
 *
 * This exact divergence shipped as two separate bugs before being unified
 * here: client.js's `_showColumnsWithRetry` (never observed a freshly-shown
 * column as confirmed, burning every retry) and the sync engine's
 * apply/compare column-visibility handling (misclassified an unvisited
 * column as hidden). Every site that reads columnOrder for visibility must
 * use this function so the semantics cannot silently re-diverge.
 */
export function isColumnVisible(c) {
  return !!(c && c.visibility !== false);
}
