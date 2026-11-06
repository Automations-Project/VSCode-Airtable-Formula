import React from 'react';
import { ActionButton } from '../../components/ActionButton.js';
import { Disclosure } from '../../components/Disclosure.js';
import { OutcomeFeedback, SettingSelectRow, SettingSwitchRow } from '../../components/SettingRow.js';
import { presetOptions } from '../../lib/presetOptions.js';
import { useActionOutcome, useScopePending } from '../../lib/useActionOutcome.js';
import { useStore } from '../../store.js';

const BUFFER_PRESETS = [100, 500, 1000, 5000, 10000].map(value => ({ value, label: value.toLocaleString('en-US') }));
const DEFAULT_BUFFER = 1000;

function DebugActions({ sessionActive }: { sessionActive: boolean }) {
  const debugStartSession = useStore(s => s.debugStartSession);
  const debugStopAndExport = useStore(s => s.debugStopAndExport);
  const debugExport = useStore(s => s.debugExport);
  const busy = useScopePending('debug');
  const exporting = useScopePending('debug:export');
  const starting = useScopePending('debug:start');
  const stopping = useScopePending('debug:stop');
  const sessionChanging = starting || stopping;
  const [session, setSession] = React.useState<{ id: string | null; kind: 'start' | 'stop' }>({ id: null, kind: 'start' });
  const [exportId, setExportId] = React.useState<string | null>(null);
  const sessionOutcome = useActionOutcome(session.id);
  const exportOutcome = useActionOutcome(exportId);

  return (
    <div className="settings-subpanel">
      <div className="settings-actions">
        {/* One control for both states, so focus stays put when the recording state flips. */}
        <ActionButton
          variant="primary"
          pending={sessionChanging}
          disabled={busy}
          onClick={() => {
            sessionOutcome.clearOutcome();
            exportOutcome.clearOutcome();
            setSession(sessionActive
              ? { id: debugStopAndExport(), kind: 'stop' }
              : { id: debugStartSession(), kind: 'start' });
          }}
        >
          {sessionActive ? 'Stop & Export' : 'Start Session'}
        </ActionButton>
        <ActionButton
          pending={exporting}
          disabled={busy}
          onClick={() => {
            sessionOutcome.clearOutcome();
            exportOutcome.clearOutcome();
            setExportId(debugExport());
          }}
        >
          Export Full Log
        </ActionButton>
      </div>
      <OutcomeFeedback
        outcome={sessionOutcome.outcome}
        successMessage={session.kind === 'start' ? 'Session started.' : 'Session stopped and exported.'}
        failureMessage="The debug session action did not complete."
      />
      <OutcomeFeedback outcome={exportOutcome.outcome} successMessage="Log exported." failureMessage="The log could not be exported." />
    </div>
  );
}

export function DiagnosticsSection() {
  const debug = useStore(s => s.debug);
  const settings = useStore(s => s.settings.debug);
  const recording = debug?.sessionActive ?? false;
  const capacity = debug?.bufferCapacity ?? DEFAULT_BUFFER;
  const bufferSize = settings?.bufferSize ?? DEFAULT_BUFFER;

  return (
    <Disclosure
      id="diagnostics"
      title="Diagnostics"
      summary={(
        <>
          <span role="status">{recording ? 'Recording' : 'Idle'}</span>
          {' · '}
          <span>{(debug?.eventCount ?? 0).toLocaleString('en-US')} of {capacity.toLocaleString('en-US')} events</span>
        </>
      )}
    >
      <p className="setting-row__description">
        Troubleshooting only. Tracing keeps recent extension and MCP events in memory so you can export them for a bug report.
      </p>
      <SettingSwitchRow
        label="Debug tracing"
        description="Collect extension & MCP events in a memory ring buffer"
        checked={settings?.enabled ?? true}
        change={value => ({ key: 'debug.enabled', value })}
      />
      <SettingSwitchRow
        label="Verbose HTTP tracing"
        description="Include HTTP request/response events from MCP (high volume)"
        checked={settings?.verboseHttp ?? false}
        change={value => ({ key: 'debug.verboseHttp', value })}
      />
      <SettingSelectRow
        label="Buffer size"
        description="How many events the ring buffer keeps (100 to 10,000)."
        value={String(bufferSize)}
        options={presetOptions(BUFFER_PRESETS, bufferSize, value => value.toLocaleString('en-US'))}
        change={value => ({ key: 'debug.bufferSize', value: Number(value) })}
      />
      <DebugActions sessionActive={recording} />
    </Disclosure>
  );
}
