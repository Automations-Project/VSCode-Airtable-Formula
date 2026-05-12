export interface LsMarkdownString {
  kind: 'markdown' | 'plaintext';
  value: string;
}

export interface LsPosition {
  line: number;
  character: number;
}

export interface LsRange {
  start: LsPosition;
  end: LsPosition;
}

export interface LsDiagnostic {
  range: LsRange;
  message: string;
  severity: LsSeverity;
  code?: string | number;
  source?: string;
  relatedInformation?: Array<{
    location: { uri: string; range: LsRange };
    message: string;
  }>;
}

export interface LsCompletionItem {
  label: string;
  kind?: LsCompletionItemKind;
  detail?: string;
  documentation?: string | LsMarkdownString;
  insertText?: string;
  filterText?: string;
  sortText?: string;
  commitCharacters?: string[];
}

export interface LsHover {
  contents: LsMarkdownString;
  range?: LsRange;
}

// D-09: Numeric values mirror vscode.DiagnosticSeverity exactly — convert.ts casts directly
// Note: using regular enum (not const enum) for vitest/esbuild compatibility at test time
export enum LsSeverity {
  Error       = 0,
  Warning     = 1,
  Information = 2,
  Hint        = 3,
}

// D-09: Numeric values mirror vscode.CompletionItemKind exactly — convert.ts casts directly
// Verified against @types/vscode CompletionItemKind enum ordering
// Note: using regular enum (not const enum) for vitest/esbuild compatibility at test time
export enum LsCompletionItemKind {
  Text          = 0,
  Method        = 1,
  Function      = 2,
  Constructor   = 3,
  Field         = 4,
  Variable      = 5,
  Class         = 6,
  Interface     = 7,
  Module        = 8,
  Property      = 9,
  Unit          = 10,
  Value         = 11,
  Enum          = 12,
  Keyword       = 13,
  Snippet       = 14,
  Color         = 15,
  File          = 16,
  Reference     = 17,
  Folder        = 18,
  EnumMember    = 19,
  Constant      = 20,
  Struct        = 21,
  Event         = 22,
  Operator      = 23,
  TypeParameter = 24,
}
