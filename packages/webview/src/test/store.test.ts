import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/vscode.js', () => ({
  sendToExtension: vi.fn(),
  onExtensionMessage: vi.fn(() => () => {}),
}));

import { useStore } from '../store.js';
import { sendToExtension } from '../lib/vscode.js';

beforeEach(() => {
  useStore.setState({
    ideStatuses: [], versions: { extension: '—', mcpServerBundled: '—' }, aiFilesCount: 0, loading: true,
    activeTab: 'overview', pendingActions: new Set(),
    settings: {
      mcp: { autoConfigureOnInstall: true, notifyOnUpdates: true },
      ai: { autoInstallFiles: true, includeAgents: false },
      formula: { formatterVersion: 'v2' }
    }
  });
  vi.clearAllMocks();
});

describe('store', () => {
  it('setTab updates activeTab', () => {
    useStore.getState().setTab('setup');
    expect(useStore.getState().activeTab).toBe('setup');
  });

  it('applyState replaces dashboard data and clears loading', () => {
    useStore.getState().applyState({
      ideStatuses: [], versions: { extension: '2.0.10', mcpServerBundled: '2.1.0' }, aiFilesCount: 3, loading: false,
      settings: {
        mcp: { autoConfigureOnInstall: true, notifyOnUpdates: true },
        ai: { autoInstallFiles: true, includeAgents: false },
        formula: { formatterVersion: 'v2' }
      }
    });
    expect(useStore.getState().versions.mcpServerBundled).toBe('2.1.0');
    expect(useStore.getState().loading).toBe(false);
  });

  it('setupIde sends action:setupIde message', () => {
    useStore.getState().setupIde('cursor');
    expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({ type: 'action:setupIde', ideId: 'cursor' }));
  });

  it('refresh sends action:refresh message', () => {
    useStore.getState().refresh();
    expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({ type: 'action:refresh' }));
  });
});
