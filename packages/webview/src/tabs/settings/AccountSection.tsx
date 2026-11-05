import React from 'react';
import type { AuthStatus } from '@shared/types.js';
import { ActionButton } from '../../components/ActionButton.js';
import { Feedback } from '../../components/Feedback.js';
import { FormField } from '../../components/FormField.js';
import { OutcomeFeedback, SettingSelectRow, SettingSwitchRow } from '../../components/SettingRow.js';
import { Section } from '../../components/Section.js';
import { StatusDot, type DotVariant } from '../../components/StatusDot.js';
import { friendlyError } from '../../lib/friendlyError.js';
import { useActionOutcome, useScopePending } from '../../lib/useActionOutcome.js';
import { useStore } from '../../store.js';

const STATUS: Record<AuthStatus, { text: string; dot: DotVariant }> = {
  unknown: { text: 'Not checked', dot: 'off' },
  checking: { text: 'Checking', dot: 'info' },
  valid: { text: 'Active', dot: 'ok' },
  expired: { text: 'Expired', dot: 'warn' },
  error: { text: 'Error', dot: 'warn' },
  'logging-in': { text: 'Logging in', dot: 'info' },
  'chrome-missing': { text: 'Browser missing', dot: 'err' },
};

const AUTH_MODES = [
  { value: 'browser', label: 'Browser (log in through Chrome)' },
  { value: 'byo', label: 'Cookie (no browser)' },
  { value: 'direct-login', label: 'Direct login (no browser)' },
] as const;

const INTERVAL_PRESETS = [1, 4, 8, 12, 24, 48, 168];

function hoursLabel(hours: number): string {
  if (hours === 168) return '1 week';
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/** The presets, plus the current value when it is another integer: never a blank select, never a coerced value. */
function intervalOptions(current: number) {
  const hours = INTERVAL_PRESETS.includes(current)
    ? INTERVAL_PRESETS
    : [...INTERVAL_PRESETS, current].sort((a, b) => a - b);
  return hours.map(h => ({
    value: String(h),
    label: INTERVAL_PRESETS.includes(h) ? hoursLabel(h) : `${hoursLabel(h)} (current)`,
  }));
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

type SessionKind = 'login' | 'logout' | 'check';

const SESSION_DONE: Record<SessionKind, string> = {
  login: 'Login finished.',
  logout: 'Logged out.',
  check: 'Session checked.',
};

function SessionPanel({ authMode, isManual }: { authMode: string; isManual: boolean }) {
  const auth = useStore(s => s.auth);
  const login = useStore(s => s.login);
  const manualLogin = useStore(s => s.manualLogin);
  const logout = useStore(s => s.logout);
  const check = useStore(s => s.status);
  const sessionBusy = useScopePending('session:');
  const loginBusy = useScopePending('session:login');
  const logoutBusy = useScopePending('session:logout');
  const checkBusy = useScopePending('session:check');
  const browserBusy = useScopePending('browser:download:');
  const [action, setAction] = React.useState<{ id: string | null; kind: SessionKind }>({ id: null, kind: 'check' });
  const { outcome, clearOutcome } = useActionOutcome(action.id);

  const status = STATUS[auth.status] ?? STATUS.unknown;
  const locked = sessionBusy || auth.status === 'checking' || auth.status === 'logging-in';
  // A bundled-Chromium install or removal is the browser the login would drive.
  const loginLocked = locked || browserBusy;
  const error = friendlyError(auth.error);

  const run = (kind: SessionKind, start: () => string | null) => {
    clearOutcome();
    setAction({ id: start(), kind });
  };

  const loginLabel = authMode === 'direct-login'
    ? 'Validate Airtable credentials'
    : isManual ? 'Log in to Airtable in browser' : 'Log in to Airtable';
  const startLogin = authMode === 'browser' && isManual ? manualLogin : login;

  return (
    <div className="settings-group" role="group" aria-labelledby="account-session-title">
      <h3 id="account-session-title" className="settings-group__title">Session</h3>
      <p className="settings-status-line" role="status">
        <StatusDot variant={status.dot} />
        <span>{status.text}</span>
        {auth.userId && <code className="settings-id">{auth.userId}</code>}
      </p>
      {(auth.lastChecked || auth.lastLogin) && (
        <p className="settings-meta">
          {auth.lastChecked && <span>Checked {formatTime(auth.lastChecked)}</span>}
          {auth.lastLogin && <span>Logged in {formatTime(auth.lastLogin)}</span>}
        </p>
      )}
      {error && (
        <Feedback variant={auth.status === 'error' ? 'error' : 'warning'}>
          <span title={error.raw}>{error.message}</span>
          {error.hint && <span className="feedback__hint">{error.hint}</span>}
        </Feedback>
      )}
      <div className="settings-actions">
        {/* Cookie mode has no login button: the cookie field below IS how it signs in. */}
        {authMode !== 'byo' && (
          <ActionButton
            variant="primary"
            pending={loginBusy}
            disabled={loginLocked}
            onClick={() => run('login', startLogin)}
          >
            {loginLabel}
          </ActionButton>
        )}
        <ActionButton pending={checkBusy} disabled={locked} onClick={() => run('check', check)}>
          Check Airtable session
        </ActionButton>
        <ActionButton pending={logoutBusy} disabled={locked} onClick={() => run('logout', logout)}>
          Log out of Airtable
        </ActionButton>
      </div>
      <OutcomeFeedback
        outcome={outcome}
        successMessage={SESSION_DONE[action.kind]}
        failureMessage="That session action did not complete."
      />
    </div>
  );
}

function CredentialsPanel({ hasCredentials }: { hasCredentials: boolean }) {
  const saveCredentials = useStore(s => s.saveCredentials);
  const sessionBusy = useScopePending('session:');
  const saving = useScopePending('session:credentials');
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [otpSecret, setOtpSecret] = React.useState('');
  const [actionId, setActionId] = React.useState<string | null>(null);
  const { outcome, clearOutcome } = useActionOutcome(actionId);

  const reset = () => {
    setEmail('');
    setPassword('');
    setOtpSecret('');
  };

  // The secrets leave this component only once the host confirms the save; a
  // failed save keeps what was typed so nothing has to be re-entered.
  React.useEffect(() => {
    if (outcome?.ok) {
      reset();
      setOpen(false);
    }
  }, [outcome]);

  const submit = () => {
    if (!email || !password) return;
    clearOutcome();
    setActionId(saveCredentials(email, password, otpSecret));
  };

  return (
    <div className="settings-subpanel">
      <p className="settings-status-line">
        <StatusDot variant={hasCredentials ? 'ok' : 'warn'} />
        <span>{hasCredentials ? 'Credentials saved in the OS keychain' : 'No credentials saved'}</span>
      </p>
      {!open && (
        <div className="settings-actions">
          <ActionButton
            disabled={sessionBusy}
            onClick={() => { clearOutcome(); setOpen(true); }}
          >
            {hasCredentials ? 'Update credentials' : 'Set credentials'}
          </ActionButton>
        </div>
      )}
      {open && (
        <form
          className="form-stack"
          onSubmit={e => { e.preventDefault(); submit(); }}
        >
          <FormField label="Airtable email" required>
            {control => (
              <input
                {...control}
                className="form-control"
                type="email"
                autoComplete="off"
                value={email}
                disabled={saving}
                onChange={e => setEmail(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Airtable password" required>
            {control => (
              <input
                {...control}
                className="form-control"
                type="password"
                autoComplete="off"
                value={password}
                disabled={saving}
                onChange={e => setPassword(e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="Two-factor secret (optional)"
            description="The base32 code Airtable shows when you set up an authenticator app, also called a TOTP secret. Leave it empty if two-factor sign-in is off."
          >
            {control => (
              <input
                {...control}
                className="form-control form-control--mono"
                type="password"
                autoComplete="off"
                value={otpSecret}
                disabled={saving}
                onChange={e => setOtpSecret(e.target.value)}
              />
            )}
          </FormField>
          <div className="form-actions">
            <ActionButton
              type="submit"
              variant="primary"
              pending={saving}
              disabled={!email || !password || sessionBusy}
            >
              Save credentials to keychain
            </ActionButton>
            <ActionButton
              disabled={saving}
              onClick={() => { reset(); clearOutcome(); setOpen(false); }}
            >
              Cancel
            </ActionButton>
          </div>
        </form>
      )}
      <OutcomeFeedback
        outcome={outcome}
        successMessage="Credentials saved to the keychain."
        failureMessage="The credentials could not be saved."
      />
    </div>
  );
}

function CookiePanel({ hasCookie }: { hasCookie: boolean }) {
  const saveCookie = useStore(s => s.saveCookie);
  const clearCookie = useStore(s => s.clearCookie);
  const sessionBusy = useScopePending('session:');
  const cookieBusy = useScopePending('session:cookie');
  const [cookie, setCookie] = React.useState('');
  const [action, setAction] = React.useState<{ id: string | null; kind: 'save' | 'clear' }>({ id: null, kind: 'save' });
  const { outcome, clearOutcome } = useActionOutcome(action.id);
  const trimmed = cookie.trim();

  // Cleared only after the host confirms the save; a failed save keeps the value.
  React.useEffect(() => {
    if (outcome?.ok && action.kind === 'save') setCookie('');
  }, [outcome, action.kind]);

  return (
    <div className="settings-subpanel">
      <p className="settings-status-line">
        <StatusDot variant={hasCookie ? 'ok' : 'warn'} />
        <span>{hasCookie ? 'Cookie saved in the OS keychain' : 'No cookie saved'}</span>
      </p>
      <FormField
        label="Airtable session cookie"
        description="Paste the Cookie header from a signed-in Airtable browser session: open DevTools, then Network, then any airtable.com request, then Cookie."
      >
        {control => (
          <textarea
            {...control}
            className="form-control form-control--mono"
            rows={3}
            placeholder="brw=…; __Host-airtable-session=…"
            autoComplete="off"
            value={cookie}
            disabled={cookieBusy}
            onChange={e => setCookie(e.target.value)}
          />
        )}
      </FormField>
      <div className="form-actions">
        <ActionButton
          variant="primary"
          pending={cookieBusy && action.kind === 'save'}
          disabled={!trimmed || sessionBusy}
          onClick={() => {
            clearOutcome();
            setAction({ id: saveCookie(trimmed), kind: 'save' });
          }}
        >
          Save cookie to keychain
        </ActionButton>
        {hasCookie && (
          <ActionButton
            pending={cookieBusy && action.kind === 'clear'}
            disabled={sessionBusy}
            onClick={() => {
              clearOutcome();
              setAction({ id: clearCookie(), kind: 'clear' });
            }}
          >
            Clear saved cookie
          </ActionButton>
        )}
      </div>
      <OutcomeFeedback
        outcome={outcome}
        successMessage={action.kind === 'save' ? 'Cookie saved to the keychain.' : 'Saved cookie cleared.'}
        failureMessage="The cookie change did not complete."
      />
    </div>
  );
}

export function AccountSection() {
  const settings = useStore(s => s.settings);
  const auth = useStore(s => s.auth);
  const sessionBusy = useScopePending('session:');

  const authMode = settings.mcp.authMode ?? 'browser';
  const isManual = (settings.auth.loginMode ?? 'manual') === 'manual';
  // Connection mode decides which credential fields exist:
  //   browser      -> login-mode switch; automatic login also takes email/password/TOTP
  //   direct-login -> email/password/TOTP always (no browser, no login-mode switch)
  //   byo          -> the session cookie
  const showCredentials = authMode === 'direct-login' || (authMode === 'browser' && !isManual);

  return (
    <Section
      id="account-settings"
      title="Airtable account"
      description="How the MCP server signs in to Airtable and keeps that session alive."
      busy={sessionBusy}
    >
      <div className="settings-stack">
        <SessionPanel authMode={authMode} isManual={isManual} />

        <div className="settings-group" role="group" aria-labelledby="account-connection-title">
          <h3 id="account-connection-title" className="settings-group__title">Connection</h3>
          <SettingSelectRow
            label="Connection mode"
            description="Browser signs in through a Chromium window. Cookie and Direct login use no browser. Changing it restarts or reprovisions the active transport before this row reports success."
            value={authMode}
            options={AUTH_MODES}
            change={value => ({ key: 'mcp.authMode', value: value as (typeof AUTH_MODES)[number]['value'] })}
          />
          {authMode === 'browser' && (
            <SettingSwitchRow
              label="Automatic login"
              description={isManual
                ? 'Off: you sign in through the browser window and no credentials are stored.'
                : 'On: the extension signs in with the credentials stored in your OS keychain.'}
              checked={!isManual}
              change={next => ({ key: 'auth.loginMode', value: next ? 'auto' : 'manual' })}
            />
          )}
        </div>

        {(showCredentials || authMode === 'byo') && (
          <div className="settings-group" role="group" aria-labelledby="account-credentials-title">
            <h3 id="account-credentials-title" className="settings-group__title">
              {authMode === 'byo' ? 'Session cookie' : 'Credentials'}
            </h3>
            {authMode === 'byo'
              ? <CookiePanel hasCookie={!!auth.hasCookie} />
              : <CredentialsPanel hasCredentials={auth.hasCredentials} />}
          </div>
        )}

        <div className="settings-group" role="group" aria-labelledby="account-refresh-title">
          <h3 id="account-refresh-title" className="settings-group__title">Keeping the session alive</h3>
          <SettingSwitchRow
            label={isManual ? 'Monitor session health' : 'Auto-refresh session'}
            description={isManual
              ? 'Periodically check the session and notify you when it expires.'
              : 'Periodically check the session and sign in again when it expires.'}
            checked={settings.auth.autoRefresh}
            change={next => ({ key: 'auth.autoRefresh', value: next })}
          />
          {settings.auth.autoRefresh && (
            <SettingSelectRow
              label="Check interval"
              value={String(settings.auth.refreshIntervalHours)}
              options={intervalOptions(settings.auth.refreshIntervalHours)}
              change={value => ({ key: 'auth.refreshIntervalHours', value: Number(value) })}
            />
          )}
        </div>
      </div>
    </Section>
  );
}
