# Airtable Formula VSCode Extension 🧮✨

[![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/Nskha.airtable-formula?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula)
[![VS Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/Nskha.airtable-formula?label=Installs)](https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula)
[![VS Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/Nskha.airtable-formula?label=Rating)](https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula)
[![Open VSX Version](https://img.shields.io/open-vsx/v/Nskha/airtable-formula?label=Open%20VSX&color=brightgreen)](https://open-vsx.org/extension/Nskha/airtable-formula)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/Nskha/airtable-formula?label=Downloads)](https://open-vsx.org/extension/Nskha/airtable-formula)

The ultimate Airtable formula development environment in VS Code with Airtable-matching syntax colors, intelligent diagnostics, auto-completion, and advanced formatting tools.

![Airtable Formula](https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/refs/heads/main/images/gallery-banner.png)

## Install

- [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula)
- [Open VSX Registry](https://open-vsx.org/extension/Nskha/airtable-formula)
- [Releases](https://github.com/Automations-Project/VSCode-Airtable-Formula/releases)

## Features

### 🎨 Airtable-Matching Colors
- **Exact color scheme**: Functions (green #7fe095), Fields (purple #b2aefc), Values (cyan #61ebe1)
- **Automatic application**: Colors match Airtable's interface perfectly

### ✨ Smart Formatting
- **Beautify v2**: Smart adaptive formatting with comment removal and JSON-aware optimization
- **Minify v2**: Safe mode prevents tokenization issues on long lines
- **Version selection**: Choose between stable v1 or feature-rich v2
- **Multiple styles**: Ultra-compact, compact, readable, JSON, cascade, and smart (v2)
- **Style/level submenus**: Pick a formatting style or minify level directly from context menus

### 🔍 Intelligent Diagnostics
- **Real-time error detection**: Unclosed parentheses, brackets, and quotes
- **Function validation**: Detects missing parentheses after function names
- **Comment warnings**: Alerts for invalid comments (not allowed in Airtable)
- **Related information**: Links opening brackets to where closing is needed

### 💡 IntelliSense Support
- **Auto-completion**: All Airtable functions with documentation
- **Function signatures**: Parameter hints and descriptions
- **Smart triggers**: Activates on `(`, `{`, quotes

### 📁 File Support
- **Extensions**: `.formula`, `.min.formula`, `.ultra-min.formula`
- **High tokenization limit**: Handles minified files up to 250,000 characters per line
- **Batch operations**: Beautify/minify multiple files from Explorer
- **Minify in-place**: Running minify on `.min.formula` or `.ultra-min.formula` overwrites the same file

## Usage

1. Install the extension
2. Create a file with `.formula` extension
3. Write your Airtable formula
4. Right-click and select "Airtable Formula: Beautify" or "Minify"
5. Or use the title bar buttons when viewing a formula file

## Extension Settings

This extension contributes the following settings:

* `airtableFormula.beautifierVersion`: Choose beautifier version (v1 or v2, default: v2)
* `airtableFormula.minifierVersion`: Choose minifier version (v1 or v2, default: v2)
* `airtableFormula.scriptRoot`: Path to formula scripts directory
* `airtableFormula.beautify.style`: Formatting style
  - `ultra-compact`: No indentation, maximum compression
  - `compact`: Minimal indentation, balanced readability
  - `readable`: Human-friendly formatting
  - `json`: Optimized for JSON string building
  - `cascade`: For cascading IF conditions
  - `smart` (v2 only): Adaptive formatting based on complexity
* `airtableFormula.beautify.indentSize`: Indentation size (default: 1)
* `airtableFormula.beautify.maxLineLength`: Maximum line length (default: 120)
* `airtableFormula.beautify.quoteStyle`: Quote style preference (double/single)
* `airtableFormula.minify.level`: Minification level
  - `micro`: Minimal changes
  - `safe` (v2 only): Prevents tokenization issues with line breaks
  - `standard`: Balanced optimization
  - `aggressive`: More space removal
  - `extreme`: Maximum compression
* `airtableFormula.minify.preserveReadability`: Preserve whitespace for readability

Font note: The extension sets a default editor font for Airtable Formula files to
`Consolas, 'Courier New', monospace`. This only takes effect if the font is
installed on the user's system. VS Code extensions cannot install fonts. [Download Airtable Code Font](https://fonts.adobe.com/fonts/consolas)

## Requirements

- VS Code 1.74.0 or later

## Development

### Building the Extension

```bash
# Install dependencies
pnpm install

# Compile the extension
pnpm run compile

# Package for distribution
pnpm run package
```

### Releasing

To create a new release with a VSIX file:

1. Update the version in `package.json`
2. Commit your changes
3. Create a new GitHub release:
   - Go to GitHub → Releases → "Create a new release"
   - Create a new tag (e.g., `v0.0.3`)
   - Add release notes
   - Publish the release
4. GitHub Actions will automatically:
   - Build the extension
   - Package it into a `.vsix` file
   - Upload the VSIX to the release assets

The VSIX file will be available for download from the GitHub release page and can be installed directly in VS Code.

## Release Notes

### 0.0.2

Initial release with beautify and minify functionality for Airtable formulas.


### 0.1.0

Major update with Airtable-matching colors, intelligent diagnostics, and enhanced formatting:
- 🎨 Exact Airtable color scheme for syntax highlighting
- 🔍 Real-time error detection and smart diagnostics
- 💡 IntelliSense with auto-completion for all functions
- 🚀 v2 formatters with adaptive formatting and safe minification
- 📁 Extended file support for minified formulas

### 0.2.0

- 🚀 Context menu submenus for beautify styles and minify levels
- 🎨 JSON beautifier performance improvements to prevent freezes
- 🎨 Minify in-place behavior for `.min.formula` / `.ultra-min.formula`

