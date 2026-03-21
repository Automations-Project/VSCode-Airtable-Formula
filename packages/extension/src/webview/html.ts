import * as vscode from 'vscode';
import * as path from 'path';

export function getWebviewHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const webviewDist = path.join(context.extensionPath, 'dist', 'webview');
  const mainJsUri  = webview.asWebviewUri(vscode.Uri.file(path.join(webviewDist, 'main.js')));
  const mainCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webviewDist, 'index.css')));
  const nonce = generateNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${mainCssUri}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${mainJsUri}"></script>
</body>
</html>`;
}

function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
