import { describe, expect, it } from 'vitest';
import { buildWebviewCsp, createNonce, getWebviewHtml } from '../webview/html.js';

// A minimal stand-in for vscode.Uri: html.ts only calls `.with({ path })`, and
// the host's asWebviewUri returns something that stringifies to a resource URL.
function fakeUri(path: string) {
  return {
    path,
    with: (change: { path: string }) => fakeUri(change.path),
    toString: () => `vscode-webview://test${path}`,
  };
}

function render(nonce?: string) {
  const webview = {
    cspSource: 'vscode-webview://test',
    asWebviewUri: (uri: { path: string }) => fakeUri(uri.path),
  };
  const context = { extensionUri: fakeUri('/ext') };
  return getWebviewHtml(webview as never, context as never, nonce);
}

describe('webview CSP', () => {
  it('uses resource-only styles and nonce-only scripts', () => {
    const csp = buildWebviewCsp(
      { cspSource: 'vscode-webview://test' } as never,
      'nonce-value',
    );

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain('img-src vscode-webview://test data:');
    expect(csp).toContain('font-src vscode-webview://test');
    expect(csp).toContain('style-src vscode-webview://test');
    expect(csp).toContain("script-src 'nonce-nonce-value'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('does not let a style or script directive fall back to the resource origin for scripts', () => {
    const csp = buildWebviewCsp({ cspSource: 'vscode-webview://test' } as never, 'n');
    const script = csp.split('; ').find(directive => directive.startsWith('script-src'));

    expect(script).toBe("script-src 'nonce-n'");
  });

  it('creates a different cryptographic nonce for each document', () => {
    const first = createNonce();
    const second = createNonce();

    expect(first).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(second).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(second).not.toBe(first);
  });
});

describe('webview document', () => {
  it('puts the CSP and the same nonce on the single external boot script', () => {
    const html = render('abc123');

    expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="');
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html.match(/<script\b[^>]*>/gi)).toEqual([
      '<script nonce="abc123" src="vscode-webview://test/ext/dist/webview/main.js">',
    ]);
  });

  it('has no executable inline script, inline style, or style attribute', () => {
    const html = render();

    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi)) {
      expect(script[1]).toBe('');
    }
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).toContain('href="vscode-webview://test/ext/dist/webview/index.css"');
  });

  it('generates a fresh nonce per document when none is supplied', () => {
    const nonceOf = (html: string) => /<script nonce="([^"]+)"/.exec(html)?.[1];

    expect(nonceOf(render())).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(nonceOf(render())).not.toBe(nonceOf(render()));
  });
});
