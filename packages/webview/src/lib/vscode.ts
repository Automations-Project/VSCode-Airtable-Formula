import type { WebviewMessage } from '@shared/messages.js';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscodeApi = (() => {
  try { return acquireVsCodeApi(); }
  catch {
    // Expected in the browser dev preview (vite dev); fatal inside VS Code.
    console.warn('[webview] acquireVsCodeApi unavailable — messages to the extension will be dropped');
    return null;
  }
})();

export function sendToExtension(msg: WebviewMessage): void {
  if (!vscodeApi) {
    console.warn('[webview] dropped message (no VS Code API):', msg.type);
    return;
  }
  vscodeApi.postMessage(msg);
}

export interface PersistedWebviewState {
  activeTab?: import('@shared/types.js').DashboardTabId;
}

export function getPersistedState(): PersistedWebviewState | undefined {
  if (!vscodeApi) return undefined;
  const value = vscodeApi.getState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const activeTab = (value as { activeTab?: unknown }).activeTab;
  if (
    typeof activeTab !== 'string'
    || !['overview', 'setup', 'prompts', 'settings'].includes(activeTab)
  ) {
    return undefined;
  }
  return { activeTab: activeTab as PersistedWebviewState['activeTab'] };
}

export function setPersistedState(state: PersistedWebviewState): void {
  vscodeApi?.setState({ activeTab: state.activeTab });
}

export function onExtensionMessage(handler: (input: unknown) => void): () => void {
  const listener = (event: MessageEvent<unknown>) => handler(event.data);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
