export interface DebugEvent {
  ts: string;
  source: 'ext' | 'mcp';
  category: 'tool' | 'auth' | 'http' | 'command' | 'webview' | 'config' | 'error';
  event: string;
  duration_ms?: number;
  data: Record<string, unknown>;
  error?: string;
  repeated?: number;
}

export class DebugCollector {
  private buffer: (DebugEvent | null)[];
  private head = 0;
  private count = 0;
  private capacity: number;
  private sessionStart: string | null = null;
  private sessionIndex: number | null = null;
  private _enabled: boolean;

  constructor(capacity: number, enabled: boolean) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(null);
    this._enabled = enabled;
  }

  get enabled(): boolean { return this._enabled; }
  set enabled(v: boolean) { this._enabled = v; }

  get isSessionActive(): boolean { return this.sessionStart !== null; }

  push(event: DebugEvent): void {
    if (!this._enabled) return;

    // Deduplication: collapse consecutive identical events
    const prevIdx = (this.head - 1 + this.capacity) % this.capacity;
    const prev = this.buffer[prevIdx];
    if (prev &&
        prev.source === event.source &&
        prev.category === event.category &&
        prev.event === event.event &&
        prev.error === event.error) {
      prev.repeated = (prev.repeated ?? 1) + 1;
      return;
    }

    this.buffer[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    this.count++;
  }

  trace(
    source: 'ext' | 'mcp',
    category: DebugEvent['category'],
    event: string,
    data: Record<string, unknown> = {},
    error?: string,
  ): void {
    const entry: DebugEvent = {
      ts: new Date().toISOString(),
      source,
      category,
      event,
      data,
    };
    if (error !== undefined) entry.error = error;
    this.push(entry);
  }

  startSession(): void {
    this.sessionStart = new Date().toISOString();
    this.sessionIndex = this.head;
  }

  stopSession(): { start: string; end: string } | null {
    if (!this.sessionStart) return null;
    const result = { start: this.sessionStart, end: new Date().toISOString() };
    this.sessionStart = null;
    this.sessionIndex = null;
    return result;
  }

  export(sessionOnly: boolean): { events: DebugEvent[]; eventsDropped: number } {
    const events: DebugEvent[] = [];
    const eventsDropped = Math.max(0, this.count - this.capacity);

    if (sessionOnly && this.sessionIndex !== null) {
      let i = this.sessionIndex;
      while (i !== this.head) {
        const ev = this.buffer[i];
        if (ev) events.push(ev);
        i = (i + 1) % this.capacity;
      }
    } else {
      for (let j = 0; j < this.capacity; j++) {
        const idx = (this.head + j) % this.capacity;
        const ev = this.buffer[idx];
        if (ev) events.push(ev);
      }
    }

    return { events, eventsDropped };
  }

  resize(newCapacity: number): void {
    const { events } = this.export(false);
    this.capacity = newCapacity;
    this.buffer = new Array(newCapacity).fill(null);
    this.head = 0;
    const toKeep = events.slice(-newCapacity);
    for (const ev of toKeep) {
      this.buffer[this.head] = ev;
      this.head = (this.head + 1) % this.capacity;
    }
  }
}
