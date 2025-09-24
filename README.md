# Airtable Formula VSCode Extension 🧮✨

Beautify and compress Airtable formulas in VS Code with syntax-aware formatting, whitespace control, and smart line breaking.

![Airtable Formula](images/airtable-formula.png)

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

- VS Code 1.104.0 or later

## Release Notes

### 0.0.1

Initial release with beautify and minify functionality for Airtable formulas.
