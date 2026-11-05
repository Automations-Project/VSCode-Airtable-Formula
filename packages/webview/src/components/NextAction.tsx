import React from 'react';
import type { DashboardTabId } from '@shared/types.js';
import type { ReadinessAction } from '../selectors/readiness.js';
import { useStore } from '../store.js';
import { ActionButton } from './ActionButton.js';

export type NavigateFn = (tab: DashboardTabId, focusTargetId?: string) => void;

interface NextActionProps {
  action: ReadinessAction | null;
  navigate: NavigateFn;
}

/** The single primary action of the page; renders nothing when none is useful. */
export function NextAction({ action, navigate }: NextActionProps) {
  const login = useStore(s => s.login);
  const installBrowser = useStore(s => s.installBrowser);
  const startDaemon = useStore(s => s.startDaemon);
  const setupIde = useStore(s => s.setupIde);
  const setupAll = useStore(s => s.setupAll);
  const status = useStore(s => s.status);
  const daemonPending = useStore(s => s.pendingDaemonActions.size > 0);
  const idePending = useStore(s => (action?.ideId ? s.pendingIdeActions.has(action.ideId) : false));
  const setupAllPending = useStore(s => s.pendingSetupAll.size > 0);
  const anyPending = useStore(s => s.pendingActions.size > 0);

  if (!action) return null;

  let pending = false;
  let run = (): void => undefined;

  if (action.kind === 'open-tab' && action.tab) {
    const { tab, focusTargetId } = action;
    run = () => navigate(tab, focusTargetId);
  } else {
    switch (action.dispatchType) {
      case 'action:login': run = login; break;
      case 'action:install-browser': run = installBrowser; break;
      case 'daemon:start': run = startDaemon; break;
      case 'action:setupAll': run = setupAll; break;
      case 'action:status': run = status; break;
      case 'action:setupIde': {
        const { ideId } = action;
        if (ideId) run = () => setupIde(ideId);
        break;
      }
    }
    pending = action.dispatchType === 'daemon:start'
      ? daemonPending
      : action.dispatchType === 'action:setupIde'
        ? idePending
        : action.dispatchType === 'action:setupAll' ? setupAllPending : anyPending;
  }

  return (
    <ActionButton variant="primary" pending={pending} onClick={run}>
      {action.label}
    </ActionButton>
  );
}
