import * as vscode from 'vscode';

const TEMPLATES: Record<string, { prefix: string; fields: string[] }> = {
  'airtable-formula': {
    prefix: '# AT:',
    fields: ['appId', 'tableId', 'fieldId', 'fieldName'],
  },
  'airtable-script': {
    prefix: '// AT:',
    fields: ['appId', 'extensionId', 'scriptName'],
  },
  'airtable-automation': {
    prefix: '// AT:',
    fields: ['appId', 'automationId', 'actionId', 'automationName'],
  },
};

function buildSnippet(languageId: string): vscode.SnippetString | null {
  const tmpl = TEMPLATES[languageId];
  if (!tmpl) return null;
  const placeholders = tmpl.fields
    .map((field, i) => `${field}=\${${i + 1}:}`)
    .join(' ');
  return new vscode.SnippetString(`${tmpl.prefix} ${placeholders}\n\$0`);
}

export function registerFileTemplates(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(async (event) => {
      for (const uri of event.files) {
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size > 0) continue;
          const doc = await vscode.workspace.openTextDocument(uri);
          const snippet = buildSnippet(doc.languageId);
          if (!snippet) continue;
          const editor = await vscode.window.showTextDocument(doc);
          await editor.insertSnippet(snippet, new vscode.Position(0, 0));
        } catch {
          // ignore — file may have been deleted or stat failed
        }
      }
    }),
  );
}
