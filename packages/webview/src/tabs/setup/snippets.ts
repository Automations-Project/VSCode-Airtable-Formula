// Pure snippet and formatting helpers for the Setup tab. No React, no store —
// kept apart from rendering so generated configuration is unit-testable.

/** A live port number, a `{PLACEHOLDER}` string, or (HTTP only) a full https:// tunnel URL. */
export type SnippetPort = number | string;
export type McpSnippetVariant = 'http' | 'stdio';
export type LspSnippetVariant = 'tcp' | 'stdio';

export function formatUptime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 60_000) return '< 1m';
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

// Our own server, by the name Setup writes (airtable-user-mcp); "airtable" is the official entry's name.
export function getMcpSnippet(ide: string, variant: McpSnippetVariant, port: SnippetPort): string {
  if (variant === 'stdio') {
    return `"airtable-user-mcp": {
  "command": "npx",
  "args": ["-y", "airtable-user-mcp"]
}`;
  }

  // HTTP variant — port may be a number/placeholder, or a full https:// tunnel URL.
  // When a tunnel URL is passed, use it directly (no 127.0.0.1 prefix).
  const mcpUrl = (typeof port === 'string' && port.startsWith('http'))
    ? `${port}/mcp`
    : `http://127.0.0.1:${port}/mcp`;

  // Each IDE has a slightly different key name (Pitfall 2 in RESEARCH.md)
  // Windsurf: serverUrl (not url)
  if (ide === 'windsurf') {
    return `"airtable-user-mcp": {
  "serverUrl": "${mcpUrl}",
  "headers": {
    "Authorization": "Bearer {{BEARER_TOKEN}}"
  }
}`;
  }

  // Cursor + Cline: url only (no type: http)
  if (ide === 'cursor' || ide === 'cline') {
    return `"airtable-user-mcp": {
  "url": "${mcpUrl}",
  "headers": {
    "Authorization": "Bearer {{BEARER_TOKEN}}"
  }
}`;
  }

  // claude-code, claude-desktop (and any future IDE) — type: "http" + url
  return `"airtable-user-mcp": {
  "type": "http",
  "url": "${mcpUrl}",
  "headers": {
    "Authorization": "Bearer {{BEARER_TOKEN}}"
  }
}`;
}

export function getLspSnippet(ide: string, variant: LspSnippetVariant, port: SnippetPort): string {
  // Neovim uses Lua format (D-10: vim.lsp.config API — Neovim 0.11+ native LSP)
  if (ide === 'neovim') {
    if (variant === 'tcp') {
      return `vim.lsp.config('airtable_formula', {
  cmd = vim.lsp.rpc.connect('127.0.0.1', ${port}),
  filetypes = { 'formula', 'airtable-script', 'airtable-automation' },
  root_markers = { '.git' },
})
vim.lsp.enable('airtable_formula')`;
    }
    return `vim.lsp.config('airtable_formula', {
  cmd = { 'npx', '-y', 'airtable-user-lsp', '--stdio' },
  filetypes = { 'formula', 'airtable-script', 'airtable-automation' },
  root_markers = { '.git' },
})
vim.lsp.enable('airtable_formula')`;
  }

  // OpenCode — opencode.json format
  if (ide === 'opencode') {
    if (variant === 'tcp') {
      return `{
  "$schema": "https://opencode.ai/config.json",
  "lsp": {
    "airtable-formula": {
      "command": ["npx", "-y", "airtable-user-lsp"],
      "extensions": [".formula", ".ats", ".ata"],
      "initialization": {
        "host": "127.0.0.1",
        "port": ${port}
      }
    }
  }
}`;
    }
    return `{
  "$schema": "https://opencode.ai/config.json",
  "lsp": {
    "airtable-formula": {
      "command": ["npx", "-y", "airtable-user-lsp", "--stdio"],
      "extensions": [".formula", ".ats", ".ata"]
    }
  }
}`;
  }

  // Claude Code — .lsp.json plugin format (D-11: plugin-based, not settings.json key)
  // TCP variant: uses transport: "socket" (partially verified — see RESEARCH.md Assumption A2)
  if (variant === 'tcp') {
    return `{
  "airtable-formula": {
    "command": "npx",
    "args": ["-y", "airtable-user-lsp", "--stdio"],
    "transport": "socket",
    "extensionToLanguage": {
      ".formula": "airtable-formula",
      ".ats": "airtable-script",
      ".ata": "airtable-automation"
    }
  }
}`;
  }

  // Claude Code stdio (fully verified format)
  return `{
  "airtable-formula": {
    "command": "npx",
    "args": ["-y", "airtable-user-lsp", "--stdio"],
    "extensionToLanguage": {
      ".formula": "airtable-formula",
      ".ats": "airtable-script",
      ".ata": "airtable-automation"
    }
  }
}`;
}

export function getOfficialAirtableSnippet(ide: string): string {
  // OpenCode knows `local` and `remote` servers only (the shape Configure writes there).
  if (ide === 'opencode') {
    return `"airtable": {
  "type": "remote",
  "url": "https://mcp.airtable.com/mcp",
  "headers": {
    "Authorization": "Bearer {{AIRTABLE_PAT}}"
  },
  "enabled": true
}`;
  }
  const isWindsurf = ide === 'windsurf' || ide === 'windsurf-next';
  // Windsurf uses 'serverUrl'; everyone else uses 'url'.
  // Claude Code and most MCP clients require "type": "http" to recognise
  // remote HTTP servers — without it the entry is silently ignored.
  const urlKey = isWindsurf ? 'serverUrl' : 'url';
  const typeField = isWindsurf ? '' : '\n  "type": "http",';
  return `"airtable": {${typeField}
  "${urlKey}": "https://mcp.airtable.com/mcp",
  "headers": {
    "Authorization": "Bearer {{AIRTABLE_PAT}}"
  }
}`;
}
