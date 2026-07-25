import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

export async function resetWebviewStore(): Promise<void> {
  const { useStore } = await import('../store.js');
  const initialStoreState = useStore.getInitialState();
  useStore.setState(initialStoreState, true);
}

export const vscodeApiMock = {
  postMessage: vi.fn(),
  getState: vi.fn<[], unknown>().mockReturnValue(undefined),
  setState: vi.fn(),
};

Object.defineProperty(globalThis, 'acquireVsCodeApi', { configurable: true, value: vi.fn(() => vscodeApiMock) });

afterEach(async () => {
  cleanup();
  await resetWebviewStore();
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
