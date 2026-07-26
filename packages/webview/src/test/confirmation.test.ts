import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/vscode.js', () => ({
  sendToExtension: vi.fn(),
}));

import {
  requestHostConfirmation,
  resolveHostConfirmation,
} from '../lib/confirmation.js';
import { sendToExtension } from '../lib/vscode.js';

describe('host confirmation bridge', () => {
  function lastRequest() {
    const request = vi.mocked(sendToExtension).mock.calls[0]?.[0];
    if (request?.type !== 'confirmation:request') {
      throw new Error('confirmation request was not sent');
    }
    return request;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('resolves true and clears its timer after a confirmed reply', async () => {
    const result = requestHostConfirmation('discard-prompt-edits');
    const request = lastRequest();

    expect(request).toMatchObject({
      type: 'confirmation:request',
      kind: 'discard-prompt-edits',
    });
    expect(request.id).toMatch(/^[0-9a-f]{24}$/);
    resolveHostConfirmation(request.id, true);

    await expect(result).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves false and clears its timer after a negative reply', async () => {
    const result = requestHostConfirmation('discard-prompt-edits');
    const request = lastRequest();

    resolveHostConfirmation(request.id, false);

    await expect(result).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves false on timeout and ignores a late reply', async () => {
    const result = requestHostConfirmation('discard-prompt-edits');
    const request = lastRequest();

    await vi.advanceTimersByTimeAsync(60_000);
    resolveHostConfirmation(request.id, true);

    await expect(result).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('registers the resolver before a synchronous host reply can arrive', async () => {
    vi.mocked(sendToExtension).mockImplementationOnce(message => {
      if (message.type === 'confirmation:request') {
        resolveHostConfirmation(message.id, true);
      }
    });

    const result = requestHostConfirmation('discard-prompt-edits');

    await expect(result).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
