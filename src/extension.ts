import * as vscode from 'vscode';

type CompanionState = {
  changedFiles: number;
  message: string;
};

export function activate(context: vscode.ExtensionContext): void {
  const provider = new CompanionViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CompanionViewProvider.viewType, provider),
    vscode.commands.registerCommand('codexCompanion.refresh', () => provider.refresh())
  );
}

export function deactivate(): void {}

class CompanionViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'codexCompanion.view';

  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.render(webviewView.webview, this.getState());
    webviewView.webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message.type === 'refresh') {
        this.refresh();
      }
    });
  }

  refresh(): void {
    if (!this.view) {
      return;
    }

    this.view.webview.html = this.render(this.view.webview, this.getState());
  }

  private getState(): CompanionState {
    const changedFiles = vscode.workspace.textDocuments.filter((document) => document.isDirty).length;
    const config = vscode.workspace.getConfiguration('codexCompanion');
    const warnDirtyFilesOver = config.get<number>('warnDirtyFilesOver', 8);

    const message = changedFiles >= warnDirtyFilesOver
      ? '변경 중인 파일이 많아요. 한 번 정리하고 가는 게 좋겠습니다.'
      : changedFiles > 0
        ? '작업 중인 파일이 있어요. 흐름은 괜찮습니다.'
        : '작업 공간이 조용합니다. 다음 작업을 시작해도 좋습니다.';

    return { changedFiles, message };
  }

  private render(webview: vscode.Webview, state: CompanionState): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
    const nonce = crypto.randomUUID();
    const characterName = vscode.workspace.getConfiguration('codexCompanion').get<string>('characterName', 'Companion');

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Codex Companion</title>
</head>
<body>
  <main class="shell">
    <section class="companion" aria-label="Codex Companion">
      <div class="sprite" aria-hidden="true">
        <div class="face">
          <span></span>
          <span></span>
        </div>
      </div>
      <div class="bubble">
        <p class="name">${escapeHtml(characterName)}</p>
        <p>${escapeHtml(state.message)}</p>
      </div>
    </section>
    <section class="stats" aria-label="Workspace status">
      <div>
        <span class="label">Dirty files</span>
        <strong>${state.changedFiles}</strong>
      </div>
    </section>
    <button nonce="${nonce}" onclick="acquireVsCodeApi().postMessage({ type: 'refresh' })">Refresh</button>
  </main>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

