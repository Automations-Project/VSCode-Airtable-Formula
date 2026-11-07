import React from 'react';
import { Disclosure } from '../../components/Disclosure.js';

/** Clients cache MCP capabilities at connect time, so saved prompts need a reconnect. */
export function PromptReconnectDisclosure() {
  return (
    <Disclosure id="prompt-reconnect" title="Reconnect clients after changes">
      <p className="prompt-hint">
        Clients cache MCP capabilities when they connect. After saving or adding prompts:
      </p>
      <ul className="prompt-reconnect-list">
        <li><strong>Cursor / Devin Desktop (Windsurf)</strong>: Reload Window (Ctrl+Shift+P)</li>
        <li><strong>Claude Code</strong>: restart the session or run <code>/mcp</code></li>
        <li><strong>Claude Desktop</strong>: restart the app</li>
      </ul>
      <p className="prompt-hint">
        Clients that do not show MCP prompts get the same recipes through the AI skill (Setup tab); they refresh when you save here.
      </p>
    </Disclosure>
  );
}
