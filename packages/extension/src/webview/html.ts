import { randomBytes } from 'node:crypto';
import type * as vscode from 'vscode';

/** A fresh, unguessable nonce for one document (128 bits from the OS CSPRNG). */
export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * Strict CSP for the dashboard. Scripts run only with the document's nonce.
 * Styles load only from the extension's own resources (a stylesheet file), so
 * neither `<style>` blocks nor `style=""` attributes are allowed. The webview
 * needs no network, frames, plugins or form posts.
 */
export function buildWebviewCsp(
  webview: Pick<vscode.Webview, 'cspSource'>,
  nonce: string,
): string {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "connect-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    "form-action 'none'",
  ].join('; ');
}

export function getWebviewHtml(
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
  nonce: string = createNonce(),
): string {
  // Built from the extension URI itself (not vscode.Uri.file) so this module has
  // no runtime dependency on the `vscode` API and stays unit-testable.
  const resource = (file: string) => {
    const root = context.extensionUri;
    return webview.asWebviewUri(
      root.with({ path: `${root.path.replace(/\/$/, '')}/dist/webview/${file}` }),
    );
  };
  const csp = buildWebviewCsp(webview, nonce);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${resource('index.css')}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${resource('main.js')}"></script>
</body>
</html>`;
}
