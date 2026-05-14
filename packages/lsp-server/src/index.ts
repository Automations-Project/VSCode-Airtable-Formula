import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { registerHandlers } from './server.js';
import { startTcpServer } from './tcp-server.js';

const mode = process.argv.includes('--tcp') ? 'tcp' : 'stdio';

if (mode === 'tcp') {
  // LSP-04: Multi-client TCP mode — spawned by daemon (D-02)
  // lockPath resolved from AIRTABLE_USER_MCP_HOME env var inside startTcpServer
  startTcpServer().catch((err) => {
    process.stderr.write(`[airtable-user-lsp] TCP server failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else {
  // LSP-03: Stdio mode — always fresh in-process (D-04), no proxy to daemon
  // RESEARCH.md Pitfall 7: inject --stdio if editors omit it
  if (!process.argv.includes('--stdio')) {
    process.argv.push('--stdio');
  }
  // createConnection reads --stdio from process.argv automatically
  const connection = createConnection(ProposedFeatures.all);
  registerHandlers(connection);
  connection.listen();
}
