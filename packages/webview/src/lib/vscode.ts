import type { WebviewMessage, ExtensionMessage } from '@shared/messages.js';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscodeApi = (() => {
  try { return acquireVsCodeApi(); }
  catch { return null; }
})();

export function sendToExtension(msg: WebviewMessage): void {
  vscodeApi?.postMessage(msg);
}

export function onExtensionMessage(handler: (msg: ExtensionMessage) => void): () => void {
  const listener = (event: MessageEvent) => handler(event.data as ExtensionMessage);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
