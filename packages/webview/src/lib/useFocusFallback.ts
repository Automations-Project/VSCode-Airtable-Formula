import React from 'react';

/**
 * Keeps focus off <body> when the control holding it legitimately goes away
 * (Stop after the service stopped, Remove after the editor was unconfigured).
 *
 * Attach the returned ref to the control, or to a form around it. If it is
 * removed while focus is inside it, focus moves to `target()` once the commit
 * has finished (so a control mounted in the same update can be the target),
 * unless something else has already taken focus.
 */
export function useFocusFallback<T extends HTMLElement>(
  target: () => HTMLElement | null | undefined,
): React.RefCallback<T> {
  const targetRef = React.useRef(target);
  React.useLayoutEffect(() => {
    targetRef.current = target;
  });

  // Stable identity: React re-runs a changed ref callback (and its cleanup) on every render.
  return React.useCallback((node: T | null) => {
    if (!node) return undefined;
    return () => {
      // A detached node's cleanup runs before React removes it from the document.
      if (!node.contains(document.activeElement)) return;
      queueMicrotask(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        targetRef.current()?.focus();
      });
    };
  }, []);
}
