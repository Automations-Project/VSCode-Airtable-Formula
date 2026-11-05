import { useEffect, useState } from 'react';
import type { ActionOutcome } from '../store.js';
import { scopePending, useStore } from '../store.js';

/**
 * Follows ONE action by the id the store returned: whether it is still in
 * flight and, once it settles, its outcome. The id lives in the caller's local
 * state, so this is per-control feedback only. Duplicate-submit guards belong
 * on `useScopePending`, which survives a remount.
 */
export function useActionOutcome(actionId: string | null) {
  const pending = useStore(state =>
    actionId === null ? false : state.pendingActions.has(actionId),
  );
  const consumeActionResult = useStore(state => state.consumeActionResult);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  useEffect(() => {
    if (actionId === null || pending) return;
    const result = consumeActionResult(actionId);
    if (result) setOutcome(result);
  }, [actionId, consumeActionResult, pending]);

  return { pending, outcome, clearOutcome: () => setOutcome(null) };
}

/** True while an in-flight action holds `key` exactly, or a scope nested under it (see `scopePending`). */
export function useScopePending(key: string): boolean {
  return useStore(state => scopePending(state.pendingScoped, key));
}
