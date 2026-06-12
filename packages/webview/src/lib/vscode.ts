import type { WebviewMessage, ExtensionMessage } from '@shared/messages.js';

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

export function onExtensionMessage(handler: (msg: ExtensionMessage) => void): () => void {
  const listener = (event: MessageEvent) => handler(event.data as ExtensionMessage);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
