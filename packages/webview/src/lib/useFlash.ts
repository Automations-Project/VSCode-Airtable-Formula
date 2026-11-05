import React from 'react';

/** A short-lived "just happened" flag for copy/rotate confirmations. */
export function useFlash(ms: number): [boolean, () => void] {
  const [on, setOn] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  return [on, () => {
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), ms);
  }];
}
