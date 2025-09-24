# Change Log

All notable changes to the "airtable-formula" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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