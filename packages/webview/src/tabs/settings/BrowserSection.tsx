import React from 'react';
import type { BrowserChoiceSummary, BrowserInfo, DetectedBrowserId } from '@shared/types.js';
import { ActionButton } from '../../components/ActionButton.js';
import { Feedback } from '../../components/Feedback.js';
import { OutcomeFeedback, SettingRow } from '../../components/SettingRow.js';
import { ProgressField } from '../../components/ProgressField.js';
import { Section } from '../../components/Section.js';
import { friendlyError } from '../../lib/friendlyError.js';
import { useActionOutcome, useScopePending } from '../../lib/useActionOutcome.js';
import { useStore } from '../../store.js';

type FoundBrowser = Extract<BrowserInfo, { found: true }>;

const AUTO = 'auto';
const CUSTOM = 'custom';

/** The select value for the saved choice: a stable id, never a path. */
function selectedValue(choice: BrowserChoiceSummary | undefined): string {
  if (choice?.mode === 'detected') return choice.browserId;
  if (choice?.mode === 'custom') return CUSTOM;
  return AUTO;
}

function browserOptions(detected: FoundBrowser[], choice: BrowserChoiceSummary | undefined) {
  const options = [{ value: AUTO, label: 'Automatic' }];
  for (const b of detected) options.push({ value: b.id, label: b.downloaded ? `${b.label} (bundled)` : b.label });
  // A remembered choice that is not in the list stays selectable instead of rendering a blank select.
  if (choice?.mode === 'detected' && !detected.some(b => b.id === choice.browserId)) {
    options.push({ value: choice.browserId, label: `${choice.label} (not detected)` });
  }
  // Shown only while the saved choice is the host-owned custom executable; it carries the host's label, never a path.
  if (choice?.mode === 'custom') options.push({ value: CUSTOM, label: `${choice.label} (custom)` });
  return options;
}

function BrowserChoice() {
  const auth = useStore(s => s.auth);
  const choice = useStore(s => s.settings.auth.browserChoice);
  const setBrowserChoice = useStore(s => s.setBrowserChoice);
  const selectCustomBrowser = useStore(s => s.selectCustomBrowser);
  const choosing = useScopePending('browser:choice:');
  const picking = useScopePending('browser:choice:pick');
  const [selectId, setSelectId] = React.useState<string | null>(null);
  const [pickId, setPickId] = React.useState<string | null>(null);
  const select = useActionOutcome(selectId);
  const pick = useActionOutcome(pickId);

  const detected = (auth.availableBrowsers ?? []).filter((b): b is FoundBrowser => b.found);
  const options = browserOptions(detected, choice);

  const onSelect = (value: string) => {
    // The custom entry is the current choice, not an action: only the picker button changes it.
    if (value === CUSTOM || value === selectedValue(choice)) return;
    select.clearOutcome();
    pick.clearOutcome();
    setSelectId(value === AUTO
      ? setBrowserChoice({ mode: 'auto' })
      : setBrowserChoice({ mode: 'detected', browserId: value as DetectedBrowserId }));
  };

  return (
    <>
      <SettingRow
        label="Browser selection"
        description={detected.length > 0
          ? `Detected: ${detected.map(b => b.label).join(', ')}`
          : 'No browsers detected.'}
        pending={choosing}
        outcome={select.outcome}
        successMessage="Browser saved"
      >
        {control => (
          <select
            {...control}
            className="form-control"
            value={selectedValue(choice)}
            onChange={e => onSelect(e.target.value)}
          >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </SettingRow>
      <div className="settings-subpanel">
        <p className="setting-row__description" id="custom-browser-description">
          Pick a Chromium-based browser that was not detected. VS Code opens the file dialog and keeps the location private.
        </p>
        <div className="settings-actions">
          <ActionButton
            aria-describedby="custom-browser-description"
            pending={picking}
            disabled={choosing}
            onClick={() => {
              pick.clearOutcome();
              select.clearOutcome();
              setPickId(selectCustomBrowser());
            }}
          >
            Choose custom browser executable
          </ActionButton>
        </div>
        <OutcomeFeedback
          outcome={pick.outcome}
          successMessage="Custom browser saved"
          failureMessage="The browser could not be saved."
        />
      </div>
    </>
  );
}

function BundledChromium() {
  const auth = useStore(s => s.auth);
  const installBrowser = useStore(s => s.installBrowser);
  const removeBrowser = useStore(s => s.removeBrowser);
  const openLink = useStore(s => s.openLink);
  const downloadBusy = useScopePending('browser:download:');
  // A login drives the browser, so it also holds the install and remove buttons.
  const loginBusy = useScopePending('session:login');
  const busy = downloadBusy || loginBusy;
  const installing = useScopePending('browser:download:install');
  const removing = useScopePending('browser:download:remove');
  const [action, setAction] = React.useState<{ id: string | null; kind: 'install' | 'remove' }>({ id: null, kind: 'install' });
  const { outcome, clearOutcome } = useActionOutcome(action.id);

  const missing = auth.browser?.found === false || auth.status === 'chrome-missing';
  const installed = auth.browser?.found === true && auth.browser.downloaded === true;
  const download = auth.browserDownload;
  const downloading = download?.status === 'downloading';
  const downloaded = download?.status === 'done';
  const downloadError = download?.status === 'error' ? friendlyError(download.error) : undefined;

  return (
    <div className="settings-subpanel">
      {missing && (
        <Feedback variant="error">
          No Chromium-based browser was found. Signing in through the browser needs a real browser to drive
          Airtable's login page. Install Google Chrome, or download a bundled Chromium (about 170 MB).
        </Feedback>
      )}
      {downloadError && (
        <Feedback variant="error">
          <span title={downloadError.raw}>Download failed: {downloadError.message}</span>
          {downloadError.hint && <span className="feedback__hint">{downloadError.hint}</span>}
        </Feedback>
      )}
      {downloading && <ProgressField label="Downloading Chromium" value={download?.progress ?? 0} />}
      <p className="outcome-status" role="status">{downloaded ? 'Bundled Chromium downloaded.' : null}</p>

      {installed && !downloading && (
        <p className="setting-row__description">
          A bundled Chromium is installed in the extension's global storage (about 170 MB).
        </p>
      )}
      <div className="settings-actions">
        {missing && (
          <ActionButton onClick={() => openLink('chrome')}>Get Google Chrome</ActionButton>
        )}
        {missing && !downloading && !downloaded && (
          <ActionButton
            variant="primary"
            pending={installing}
            disabled={busy}
            onClick={() => {
              clearOutcome();
              setAction({ id: installBrowser(), kind: 'install' });
            }}
          >
            Download bundled Chromium
          </ActionButton>
        )}
        {installed && !downloading && (
          <ActionButton
            pending={removing}
            disabled={busy}
            onClick={() => {
              clearOutcome();
              setAction({ id: removeBrowser(), kind: 'remove' });
            }}
          >
            Remove bundled Chromium
          </ActionButton>
        )}
      </div>
      <OutcomeFeedback
        outcome={outcome}
        successMessage={action.kind === 'remove' ? 'Bundled Chromium removed.' : 'Bundled Chromium installed.'}
        failureMessage="The bundled Chromium change did not complete."
      />
    </div>
  );
}

export function BrowserSection() {
  const authMode = useStore(s => s.settings.mcp.authMode ?? 'browser');
  const browser = useStore(s => s.auth.browser);
  const usesBrowser = authMode === 'browser';

  return (
    <Section
      id="browser-settings"
      title="Browser"
      description="The browser that signs in to Airtable and mints the session."
    >
      {usesBrowser ? (
        <div className="settings-stack">
          {browser?.found === true && (
            <p className="settings-status-line">Using {browser.label}</p>
          )}
          <BrowserChoice />
          <BundledChromium />
        </div>
      ) : (
        <p className="setting-row__description">
          Not used in this connection mode. Switch the connection mode to Browser to choose one.
        </p>
      )}
    </Section>
  );
}
