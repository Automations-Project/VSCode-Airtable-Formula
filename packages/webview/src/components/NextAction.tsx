import React from 'react';
import type { DashboardTabId } from '@shared/types.js';
import { useActionOutcome, useScopePending } from '../lib/useActionOutcome.js';
import { useFocusFallback } from '../lib/useFocusFallback.js';
import type { ReadinessAction } from '../selectors/readiness.js';
import { useStore } from '../store.js';
import { ActionButton } from './ActionButton.js';
import { OutcomeFeedback } from './SettingRow.js';

export type NavigateFn = (tab: DashboardTabId, focusTargetId?: string) => void;

type DispatchType = NonNullable<ReadinessAction['dispatchType']>;

const DONE: Record<DispatchType, string> = {
  'action:login': 'Sign-in finished.',
  'action:status': 'Session checked.',
  'action:install-browser': 'Bundled Chromium installed.',
  'daemon:start': 'Service start requested.',
  'action:setupIde': 'Editor set up.',
  'action:setupAll': 'Editors set up.',
};

interface NextActionProps {
  action: ReadinessAction | null;
  navigate: NavigateFn;
}

/**
 * The single primary action of the page; no button when none is useful.
 * Each dispatch mirrors the surface that owns it: it is held only by work that
 * conflicts with it (the same guards the store applies), never by unrelated work.
 * Its result region stays mounted: a successful action usually resolves the
 * very state that offered it, so the button is gone when the result arrives.
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
  const [started, setStarted] = React.useState<{ id: string | null; type: DispatchType }>({ id: null, type: 'action:status' });
  const { outcome, clearOutcome } = useActionOutcome(started.id);
  // One node across next actions (only its label changes); when none is left, focus lands on the tab heading.
  const buttonFallback = useFocusFallback<HTMLButtonElement>(() => document.getElementById('overview-heading'));

  let pending = false;
  let disabled = false;
  let run = (): void => undefined;

  const dispatch = (type: DispatchType, start: () => string | null) => () => {
    clearOutcome();
    setStarted({ id: start(), type });
  };

  if (action?.kind === 'open-tab' && action.tab) {
    const { tab, focusTargetId } = action;
    run = () => navigate(tab, focusTargetId);
  } else if (action) {
    switch (action.dispatchType) {
      case 'action:login':
        run = dispatch('action:login', login);
        pending = loginBusy;
        disabled = sessionBusy || downloadBusy;
        break;
      case 'action:status':
        run = dispatch('action:status', status);
        pending = checkBusy;
        disabled = sessionBusy;
        break;
      case 'action:install-browser':
        run = dispatch('action:install-browser', installBrowser);
        pending = installing;
        disabled = downloadBusy || loginBusy;
        break;
      case 'daemon:start':
        run = dispatch('daemon:start', startDaemon);
        pending = daemonPending;
        break;
      case 'action:setupAll':
        run = dispatch('action:setupAll', setupAll);
        pending = setupAllPending || anyIdePending;
        break;
      case 'action:setupIde': {
        const { ideId } = action;
        if (ideId) run = dispatch('action:setupIde', () => setupIde(ideId));
        pending = idePending;
        disabled = setupAllPending;
        break;
      }
    }
  }

  return (
    <>
      {action && (
        <ActionButton ref={buttonFallback} variant="primary" pending={pending} disabled={disabled} onClick={run}>
          {action.label}
        </ActionButton>
      )}
      <OutcomeFeedback
        outcome={outcome}
        successMessage={DONE[started.type]}
        failureMessage="That action did not complete."
      />
    </>
  );
}
