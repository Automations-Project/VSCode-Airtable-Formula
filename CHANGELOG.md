# Change Log

All notable changes to the "airtable-formula" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [2.0.11] - 2026-04-11

### Added
- **Dual-channel publishing** — MCP server now available as standalone `airtable-user-mcp` npm package
- **CLI subcommands** — `npx airtable-user-mcp login`, `logout`, `status`, `doctor`, `install-browser`
- **Dashboard version card** — Shows extension + bundled MCP server versions with update-available hints
- **Build-time version manifest** — Fixes hardcoded `v2.0.0` MCP version bug in dashboard
- **GitHub Actions CI/CD** — Publish workflows for npm, VS Code Marketplace, and Open VSX

### Changed
- **Package rename** — MCP server renamed from `mcp-internal-airtable` to `airtable-user-mcp`
- **Lazy-load patchright** — Dynamic imports for browser deps (smaller install, no crash without browser)
- **Command renames** — `checkSession` → `status`, `downloadBrowser` → `install-browser`

## [0.2.0] - 2026-01-24

### Added
- **Context menu submenus** for beautify styles and minify levels
- **Batch style/level commands** for explorer selections

### Changed
- **Explorer file operations** now use file-based formatting for better stability
- **Minify in-place** when running on `.min.formula` or `.ultra-min.formula`

### Fixed
- **Beautifier v2 JSON performance** improvements to prevent extension host freezes
- **Vendor script resolution** consistency across style/level commands

## [0.1.0] - 2025-09-28

### Added
- **Airtable-Matching Color Scheme**: Exact syntax highlighting colors matching Airtable's interface
- **Intelligent Diagnostics**: Real-time error detection for unclosed parentheses, brackets, quotes
- **IntelliSense Support**: Auto-completion for all Airtable functions with parameter hints
- **Version Selection**: Choose between v1 (stable) and v2 (enhanced) for beautifier and minifier
- **New Formatting Styles**: `smart` style (v2) and `safe` minification level (v2)
- **Extended File Support**: `.min.formula` and `.ultra-min.formula` extensions
- **Enhanced Error Reporting**: Better parenthesis mismatch detection with linked errors

### Changed
- Default to v2 versions for both beautifier and minifier (with v1 fallback)
- Improved diagnostics to not flag `{}` as errors (used in JSON string building)

### Fixed
- Syntax highlighting for minified files
- False positive errors for empty field references `{}`
- Better handling of long single-line formulas in minified files

## [0.0.2] - 2025-09-24

### Added
- Initial release of Airtable Formula VS Code extension
- **Beautify functionality**: Format Airtable formulas with proper indentation and line breaks
- **Minify functionality**: Compress formulas to reduce size while maintaining functionality
- **Syntax highlighting**: Full support for `.formula` files with custom language definition
- **Multiple formatting styles**: Ultra-compact, compact, readable, JSON, and cascade styles
- **Customizable settings**: Configure indentation, line length, quote style, and minification levels
- **Context menu integration**: Right-click options for beautify/minify in formula files
- **File operations**: Batch beautify/minify operations on multiple files
