#!/usr/bin/env node
// Committed launcher for the `airtable-user-lsp` bin.
//
// The real entry lives in dist/ (built by tsup). Pointing the bin map at the
// build artifact breaks `pnpm install` on fresh checkouts — the file doesn't
// exist yet, so pnpm warns and skips creating the bin link (visible as a
// WARN on every CI install). This shim is checked into git, so the link is
// always created; it defers to the built entry at run time. The entry reads
// process.argv itself, so --stdio/--tcp pass through unchanged.
import('../dist/index.mjs').catch((err) => {
  const msg = String(err?.message ?? err);
  if (err?.code === 'ERR_MODULE_NOT_FOUND' && /dist[\\/]index\.mjs/.test(msg)) {
    console.error('[airtable-user-lsp] dist/index.mjs missing — run `pnpm -F airtable-user-lsp build` first.');
  } else {
    console.error('[airtable-user-lsp] failed to start:', msg);
  }
  process.exit(1);
});
