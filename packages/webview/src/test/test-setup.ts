import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

const actionResultIds = new Set<string>();

export async function resetWebviewStore(): Promise<void> {
  const { useStore } = await import('../store.js');
  const initialStoreState = useStore.getInitialState();
  useStore.setState(initialStoreState, true);
}

async function trackActionResults(): Promise<void> {
  const { useStore } = await import('../store.js');
  const markActionDone = useStore.getState().markActionDone;
  useStore.setState({
    markActionDone: (id, ok) => {
      actionResultIds.add(id);
      markActionDone(id, ok);
    },
  });
}

export const vscodeApiMock = {
  postMessage: vi.fn(),
  getState: vi.fn<[], unknown>().mockReturnValue(undefined),
  setState: vi.fn(),
};

Object.defineProperty(globalThis, 'acquireVsCodeApi', { configurable: true, value: vi.fn(() => vscodeApiMock) });

beforeEach(async () => {
  vi.useFakeTimers();
  await resetWebviewStore();
  await trackActionResults();
});

afterEach(async () => {
  cleanup();
  vi.clearAllTimers();
  const { useStore } = await import('../store.js');
  for (const id of actionResultIds) useStore.getState().consumeActionResult(id);
  actionResultIds.clear();
  await resetWebviewStore();
  vi.useRealTimers();
  document.body.className = '';
  vscodeApiMock.getState.mockReturnValue(undefined);
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: ResizeObserverStub });
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
