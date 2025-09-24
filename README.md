# Airtable Formula VSCode Extension 🧮✨

Beautify and compress Airtable formulas in VS Code with syntax-aware formatting, whitespace control, and smart line breaking.

![Airtable Formula](https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/refs/heads/main/images/gallery-banner.png)

## Features

- **Beautify**: Format Airtable formulas with proper indentation and line breaks
- **Minify**: Compress formulas to reduce size while maintaining functionality  
- **Syntax Highlighting**: Full support for `.formula` files
- **Multiple Styles**: Choose from ultra-compact, compact, readable, JSON, and cascade formatting
- **Customizable**: Configure indentation, line length, quote style, and minification levels

## Usage

1. Install the extension
2. Create a file with `.formula` extension
3. Write your Airtable formula
4. Right-click and select "Airtable Formula: Beautify" or "Minify"
5. Or use the title bar buttons when viewing a formula file

## Extension Settings

This extension contributes the following settings:

* `airtableFormula.scriptRoot`: Path to formula scripts directory
* `airtableFormula.beautify.style`: Formatting style (ultra-compact, compact, readable, json, cascade)
* `airtableFormula.beautify.indentSize`: Indentation size
* `airtableFormula.beautify.maxLineLength`: Maximum line length
* `airtableFormula.beautify.quoteStyle`: Quote style preference
* `airtableFormula.minify.level`: Minification level
* `airtableFormula.minify.preserveReadability`: Preserve whitespace for readability

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
