# Change Log

All notable changes to the "airtable-formula" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
- **🎨 Airtable-Matching Color Scheme**: Exact syntax highlighting colors matching Airtable's interface
  - Functions: Green (#7fe095)
  - Field References: Purple (#b2aefc)
  - Values: Cyan (#61ebe1)
- **🔍 Intelligent Diagnostics**:
  - Real-time error detection for unclosed parentheses, brackets, and quotes
  - Function validation - detects missing parentheses after function names
  - Comment warnings (comments are invalid in Airtable formulas)
  - Accurate error positioning with related information
- **💡 IntelliSense Support**:
  - Auto-completion for all Airtable functions
  - Function signatures with parameter hints
  - Smart triggers on `(`, `{`, and quotes
- **🚀 Version Selection**:
  - Choose between v1 (stable) and v2 (enhanced) for both beautifier and minifier
  - v2 Beautifier: Smart adaptive formatting, comment removal, JSON-aware optimization
  - v2 Minifier: Safe mode to prevent tokenization issues on long lines
- **📝 New Formatting Styles**:
  - `smart` style (v2): Adaptive formatting based on formula complexity
  - `safe` minification level (v2): Prevents tokenization issues
- **📁 Extended File Support**:
  - Support for `.min.formula` and `.ultra-min.formula` extensions
  - Increased tokenization limit to 250,000 characters per line
- **🔧 Enhanced Error Reporting**:
  - Better parenthesis mismatch detection
  - Links between opening and closing bracket errors
  - Function-specific error messages

### Changed
- Default to v2 versions for both beautifier and minifier (with v1 fallback)
- Improved diagnostics to not flag `{}` as errors (used in JSON string building)
- Enhanced formatting algorithms for better JSON string concatenation handling

### Fixed
- Syntax highlighting for minified files
- False positive errors for empty field references `{}`
- Better handling of long single-line formulas in minified files

## [0.0.2] - 2025-09-24

### Added
- Initial release of Airtable Formula VSCode extension
- **Beautify functionality**: Format Airtable formulas with proper indentation and line breaks
- **Minify functionality**: Compress formulas to reduce size while maintaining functionality
- **Syntax highlighting**: Full support for `.formula` files with custom language definition
- **Multiple formatting styles**: Ultra-compact, compact, readable, JSON, and cascade styles
- **Customizable settings**: Configure indentation, line length, quote style, and minification levels
- **VSCode marketplace assets**: Extension icon and gallery banner for marketplace presentation
- **Context menu integration**: Right-click options for beautify/minify in formula files
- **Title bar buttons**: Quick access buttons when viewing formula files
- **File operations**: Batch beautify/minify operations on multiple files

### Technical
- Removed redundant activationEvents (VSCode generates them automatically)
- Added repository configuration for marketplace compatibility
- Configured extension icon and gallery banner
- Updated README with comprehensive documentation