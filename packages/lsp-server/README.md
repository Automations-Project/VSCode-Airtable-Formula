# airtable-user-lsp

Airtable language server for formula, script, and automation files.
Works with any LSP-capable editor — Neovim, Zed, OpenCode, Claude Code, and more.

## Features

- **Diagnostics** — syntax errors and unknown function names in Airtable formulas
- **Completions** — all Airtable formula functions, scripting globals, and automation APIs
- **Hover documentation** — function signatures and descriptions on hover
- **Signature help** — parameter hints while typing formula function arguments
- Supports `.formula` / `.fx`, `.ats` / `.script`, `.ata` / `.automation` files

## Quick Start

No installation required:

```bash
npx airtable-user-lsp --stdio
```

Or install globally:

```bash
npm install -g airtable-user-lsp
airtable-user-lsp --stdio
```

**Requirements:** Node.js >= 20

## Editor Configuration

### Neovim (nvim-lspconfig)

```lua
require('lspconfig').airtable_formula.setup({
  cmd = { 'npx', 'airtable-user-lsp', '--stdio' },
  filetypes = { 'formula', 'airtable-formula', 'airtable-script', 'airtable-automation' },
  root_dir = function(fname)
    return require('lspconfig').util.find_git_ancestor(fname) or vim.fn.getcwd()
  end,
})
```

### Zed

In `.zed/settings.json` or `~/.config/zed/settings.json`:

```json
{
  "lsp": {
    "airtable-formula": {
      "binary": {
        "path": "npx",
        "arguments": ["airtable-user-lsp", "--stdio"]
      }
    }
  }
}
```

### OpenCode (Claude Code)

In `~/.config/claude-code/settings.json` or project `.claude/settings.json`:

```json
{
  "languageServers": {
    "airtable-formula": {
      "command": "npx",
      "args": ["airtable-user-lsp", "--stdio"],
      "filetypes": [".formula", ".fx", ".ats", ".script", ".ata", ".automation"]
    }
  }
}
```

### Helix

In `~/.config/helix/languages.toml`:

```toml
[[language]]
name = "airtable-formula"
language-servers = ["airtable-lsp"]

[language-server.airtable-lsp]
command = "npx"
args = ["airtable-user-lsp", "--stdio"]
```

## Supported File Types

| Extension | Language ID | Engine |
|-----------|-------------|--------|
| `.formula`, `.fx` | `airtable-formula` | Formula engine |
| `.ats`, `.script` | `airtable-script` | Scripting Extension engine |
| `.ata`, `.automation` | `airtable-automation` | Automation Script engine |

## Daemon TCP Mode (Advanced)

When the [airtable-user-mcp](https://www.npmjs.com/package/airtable-user-mcp) daemon is running,
it automatically starts `airtable-user-lsp --tcp` as a subprocess and writes the TCP port to
`~/.airtable-user-mcp/daemon.lock` as `port_lsp`.

Multiple editor sessions can share the same LSP server instance by connecting to this TCP port:

```bash
# Read port from lockfile
PORT=$(node -e "const f=require('fs').readFileSync(require('os').homedir()+'/.airtable-user-mcp/daemon.lock','utf8'); console.log(JSON.parse(f).port_lsp)")
# Connect your LSP client to 127.0.0.1:$PORT
```

## License

MIT
