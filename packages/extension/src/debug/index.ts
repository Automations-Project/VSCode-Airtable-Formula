export { DebugCollector } from './collector.js';
export type { DebugEvent } from './collector.js';
export { exportDebugLog } from './exporter.js';
export { parseStderrLine, processStderrChunk } from './stderr-parser.js';
export {
  tracedCommand,
  traceWebviewMessages,
  createTracedPostMessage,
  traceConfigChanges,
} from './instrumentation.js';
