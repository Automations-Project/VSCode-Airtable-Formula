import React from 'react';
import type { DashboardTabId } from '@shared/types.js';
import { useScopePending } from '../lib/useActionOutcome.js';
import type { ReadinessAction } from '../selectors/readiness.js';
import { useStore } from '../store.js';
import { ActionButton } from './ActionButton.js';

export type NavigateFn = (tab: DashboardTabId, focusTargetId?: string) => void;

interface NextActionProps {
  action: ReadinessAction | null;
  navigate: NavigateFn;
}

/**
 * The single primary action of the page; renders nothing when none is useful.
 * Each dispatch mirrors the surface that owns it: it is held only by work that
 * conflicts with it (the same guards the store applies), never by unrelated work.
 */
export function NextAction({ action, navigate }: NextActionProps) {
  const login = useStore(s => s.login);
  const installBrowser = useStore(s => s.installBrowser);
  const startDaemon = useStore(s => s.startDaemon);
  const setupIde = useStore(s => s.setupIde);
  const setupAll = useStore(s => s.setupAll);
  const status = useStore(s => s.status);
  const sessionBusy = useScopePending('session');
  const loginBusy = useScopePending('session:login');
  const checkBusy = useScopePending('session:check');
  const downloadBusy = useScopePending('browser:download');
  const installing = useScopePending('browser:download:install');
  const daemonPending = useStore(s => s.pendingDaemonActions.size > 0);
  const idePending = useStore(s => (action?.ideId ? s.pendingIdeActions.has(action.ideId) : false));
  const anyIdePending = useStore(s => s.pendingIdeActions.size > 0);
  const setupAllPending = useStore(s => s.pendingSetupAll.size > 0);

  if (!action) return null;

  let pending = false;
  let disabled = false;
  let run = (): void => undefined;

  if (action.kind === 'open-tab' && action.tab) {
    const { tab, focusTargetId } = action;
    run = () => navigate(tab, focusTargetId);
  } else {
    switch (action.dispatchType) {
      case 'action:login':
        run = () => { login(); };
        pending = loginBusy;
        disabled = sessionBusy || downloadBusy;
        break;
      case 'action:status':
        run = () => { status(); };
        pending = checkBusy;
        disabled = sessionBusy;
        break;
      case 'action:install-browser':
        run = () => { installBrowser(); };
        pending = installing;
        disabled = downloadBusy || loginBusy;
        break;
      case 'daemon:start':
        run = () => { startDaemon(); };
        pending = daemonPending;
        break;
      case 'action:setupAll':
        run = () => { setupAll(); };
        pending = setupAllPending || anyIdePending;
        break;
      case 'action:setupIde': {
        const { ideId } = action;
        if (ideId) run = () => { setupIde(ideId); };
        pending = idePending;
        disabled = setupAllPending;
        break;
      }
    }
  }

  return (
    <ActionButton variant="primary" pending={pending} disabled={disabled} onClick={run}>
      {action.label}
    </ActionButton>
  );
}
