import * as net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import { registerHandlers } from './server.js';
import { writeLspPort } from './lockfile-writer.js';

export interface StartTcpServerOptions {
  /** Explicit lockfile path. Defaults to AIRTABLE_USER_MCP_HOME + '/daemon.lock'. */
  lockPath?: string;
}

function resolveLockPath(options: StartTcpServerOptions): string {
  if (options.lockPath) return options.lockPath;
  const configDir = process.env['AIRTABLE_USER_MCP_HOME'] ?? join(homedir(), '.airtable-user-mcp');
  return join(configDir, 'daemon.lock');
}

/**
 * Start a multi-client TCP LSP server on 127.0.0.1 with an OS-assigned port.
 * After binding, writes port_lsp to daemon.lock so the daemon can discover it.
 * Each accepted connection gets its own independent LSP Connection instance.
 *
 * Implements D-02: daemon spawns this via 'airtable-user-lsp --tcp'.
 * Implements LSP-04: multi-client TCP server for shared daemon mode.
 * Implements LSP-05: writes port_lsp to lockfile.
 * Implements T-06-03-01: explicitly binds to 127.0.0.1 (loopback only, not 0.0.0.0).
 */
export async function startTcpServer(options: StartTcpServerOptions = {}): Promise<net.Server> {
  const lockPath = resolveLockPath(options);

  const tcpServer = net.createServer((socket) => {
    // Isolate per-socket errors — without this, ECONNRESET/EPIPE are uncaught exceptions
    socket.on('error', (err) => {
      // ECONNRESET is expected when editors close abruptly — not worth logging
      if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') {
        process.stderr.write(`[airtable-user-lsp] socket error: ${err.message}\n`);
      }
      socket.destroy();
    });
    const reader = new StreamMessageReader(socket);
    const writer = new StreamMessageWriter(socket);
    // Each connection gets its OWN Connection instance (RESEARCH.md Pitfall 5)
    const connection = createConnection(ProposedFeatures.all, reader, writer);
    // registerHandlers creates a new TextDocuments per call (per-connection document state)
    registerHandlers(connection);
    connection.listen();
    socket.on('close', () => connection.dispose());
  });

  // Wait for OS to assign port before reading it (RESEARCH.md Pitfall 3)
  await new Promise<void>((resolve, reject) => {
    tcpServer.once('error', (err) => {
      tcpServer.removeAllListeners('listening');
      reject(err);
    });
    tcpServer.once('listening', () => {
      tcpServer.removeAllListeners('error');
      // MUST read port inside 'listening' callback — server.address() is null before this
      const rawAddr = tcpServer.address();
      if (!rawAddr || typeof rawAddr === 'string') {
        reject(new Error('TCP server address is unavailable after listen'));
        return;
      }
      const addr = rawAddr as net.AddressInfo;
      // Write port_lsp to daemon.lock so daemon can discover this TCP server
      writeLspPort(lockPath, addr.port);
      resolve();
    });
    // T-06-03-01: bind to loopback only — never 0.0.0.0
    tcpServer.listen(0, '127.0.0.1');
  });

  return tcpServer;
}
