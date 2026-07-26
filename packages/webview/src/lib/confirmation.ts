import type { ConfirmationKind } from '@shared/messages.js';
import { randomId } from './utils.js';
import { sendToExtension } from './vscode.js';

const TIMEOUT_MS = 60_000;
const pending = new Map<string, {
  resolve: (confirmed: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

export function requestHostConfirmation(kind: ConfirmationKind): Promise<boolean> {
  const id = randomId();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(false);
    }, TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    sendToExtension({ type: 'confirmation:request', id, kind });
  });
}

export function resolveHostConfirmation(id: string, confirmed: boolean): void {
  const entry = pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(id);
  entry.resolve(confirmed);
}
