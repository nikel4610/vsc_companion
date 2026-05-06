import * as vscode from 'vscode';

type CompanionState = {
  changedFiles: number;
  sessionMinutes: number;
  lastTestMinutes?: number;
  isBusy: boolean;
  message: string;
  reminders: string[];
  commands: CompanionCommand[];
};

type CompanionCommand = {
  label: string;
  command: string;
};

type CompanionTone = 'calm' | 'strict' | 'light';
type CompanionPlacement = 'sidebar' | 'panel';

export function activate(context: vscode.ExtensionContext): void {
  const sidebarProvider = new CompanionViewProvider(context, 'sidebar');
  const panelProvider = new CompanionViewProvider(context, 'panel');

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CompanionViewProvider.sidebarViewType, sidebarProvider),
    vscode.window.registerWebviewViewProvider(CompanionViewProvider.panelViewType, panelProvider),
    vscode.commands.registerCommand('codexCompanion.open', () => sidebarProvider.open()),
    vscode.commands.registerCommand('codexCompanion.openBottom', () => panelProvider.open()),
    vscode.commands.registerCommand('codexCompanion.refresh', () => {
      sidebarProvider.refresh();
      panelProvider.refresh();
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      sidebarProvider.refresh();
      panelProvider.refresh();
    })
  );
}

export function deactivate(): void {}

class CompanionViewProvider implements vscode.WebviewViewProvider {
  static readonly sidebarViewType = 'codeCompanion.view';
  static readonly panelViewType = 'codeCompanion.panelView';

  private view?: vscode.WebviewView;
  private readonly startedAt = Date.now();
  private busyUntil = 0;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly placement: CompanionPlacement
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [])
      ]
    };

    webviewView.webview.html = this.render(webviewView.webview, await this.getState());
    webviewView.webview.onDidReceiveMessage((message: { type?: string; command?: string }) => {
      if (message.type === 'refresh') {
        this.refresh();
        return;
      }

      if (message.type === 'runCommand' && message.command) {
        this.runCommand(message.command);
      }
    });
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    this.view.webview.html = this.render(this.view.webview, await this.getState());
  }

  async open(): Promise<void> {
    const viewContainer = this.placement === 'panel'
      ? 'workbench.view.extension.codeCompanionPanel'
      : 'workbench.view.extension.codeCompanion';

    await vscode.commands.executeCommand(viewContainer);
  }

  private async getState(): Promise<CompanionState> {
    const config = vscode.workspace.getConfiguration('codexCompanion');
    const changedFiles = await this.getGitChangedFiles();
    const warnDirtyFilesOver = config.get<number>('warnDirtyFilesOver', 8);
    const remindCommitAfterChangedFiles = config.get<number>('remindCommitAfterChangedFiles', 5);
    const remindTestAfterMinutes = config.get<number>('remindTestAfterMinutes', 120);
    const showWorkTimeAfterMinutes = config.get<number>('showWorkTimeAfterMinutes', 60);
    const tone = config.get<CompanionTone>('tone', 'calm');
    const sessionMinutes = Math.floor((Date.now() - this.startedAt) / 60000);
    const lastTestAt = this.context.globalState.get<number>('lastTestAt');
    const lastTestMinutes = lastTestAt ? Math.floor((Date.now() - lastTestAt) / 60000) : undefined;
    const commands = config.get<CompanionCommand[]>('commands', []).filter((command) => {
      return command.label.trim().length > 0 && command.command.trim().length > 0;
    });
    const reminders = this.getReminders({
      changedFiles,
      lastTestMinutes,
      remindCommitAfterChangedFiles,
      remindTestAfterMinutes,
      sessionMinutes,
      showWorkTimeAfterMinutes
    });

    return {
      changedFiles,
      sessionMinutes,
      lastTestMinutes,
      isBusy: Date.now() < this.busyUntil,
      message: this.getMessage(changedFiles, warnDirtyFilesOver, tone),
      reminders,
      commands
    };
  }

  private render(webview: vscode.Webview, state: CompanionState): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css'));
    const nonce = crypto.randomUUID();
    const config = vscode.workspace.getConfiguration('codexCompanion');
    const characterName = config.get<string>('characterName', 'Companion');
    const characterUri = this.getCharacterUri(webview, config.get<string>('characterPath', ''));
    const ambientMotion = config.get<boolean>('ambientMotion', true);
    const commandButtons = state.commands.map((command) => {
      return `<button class="command-button" data-command="${escapeHtml(command.command)}">${escapeHtml(command.label)}</button>`;
    }).join('');
    const visibleReminders = state.reminders.slice(0, this.placement === 'panel' ? 1 : state.reminders.length);
    const reminderItems = visibleReminders.map((reminder) => {
      return `<li>${escapeHtml(reminder)}</li>`;
    }).join('');
    const lastTestLabel = state.lastTestMinutes === undefined
      ? 'No record'
      : `${state.lastTestMinutes} min ago`;
    const sprite = characterUri
      ? `<img class="sprite image" data-sprite src="${characterUri}" alt="" />`
      : `<div class="sprite" data-sprite aria-hidden="true">
          <div class="cat">
            <span class="cat-tail"></span>
            <span class="cat-ear left"></span>
            <span class="cat-ear right"></span>
            <span class="cat-head">
              <span class="cat-eye left"></span>
              <span class="cat-eye right"></span>
              <span class="cat-mouth"></span>
            </span>
            <span class="cat-body"></span>
            <span class="cat-leg front"></span>
            <span class="cat-leg back"></span>
          </div>
        </div>`;

    const panelHud = this.placement === 'panel'
      ? `<aside class="pet-hud" aria-label="Workspace status">
          <div><span class="label">Git</span><strong>${state.changedFiles}</strong></div>
          <div><span class="label">Session</span><strong>${state.sessionMinutes}m</strong></div>
          <div><span class="label">Test</span><strong>${escapeHtml(lastTestLabel)}</strong></div>
          ${reminderItems ? `<ul>${reminderItems}</ul>` : ''}
          ${commandButtons ? `<div class="commands compact">${commandButtons}</div>` : ''}
          <button id="refresh-button">Refresh</button>
        </aside>`
      : '';
    const sidebarInfo = this.placement === 'sidebar'
      ? `<div class="bubble">
          <p class="name">${escapeHtml(characterName)}</p>
          <p>${escapeHtml(state.message)}</p>
        </div>
        <section class="stats" aria-label="Workspace status">
          <div>
            <span class="label">Git changed files</span>
            <strong>${state.changedFiles}</strong>
          </div>
          <div>
            <span class="label">Work session</span>
            <strong>${state.sessionMinutes} min</strong>
          </div>
          <div>
            <span class="label">Last test</span>
            <strong>${escapeHtml(lastTestLabel)}</strong>
          </div>
        </section>
        ${reminderItems ? `<section class="reminders" aria-label="Reminders"><ul>${reminderItems}</ul></section>` : ''}
        ${commandButtons ? `<section class="commands" aria-label="Project commands">${commandButtons}</section>` : ''}
        <button id="refresh-button">Refresh</button>`
      : '';

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Code Companion</title>
</head>
<body>
  <main class="shell shell-${this.placement}${state.isBusy ? ' is-busy' : ''}">
    <section class="companion" aria-label="Code Companion">
      <div class="playground">
        ${sprite}
      </div>
      ${panelHud}
    </section>
    ${sidebarInfo}
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const root = document.documentElement;
    const shell = document.querySelector('.shell');
    const sprite = document.querySelector('[data-sprite]');
    const playground = document.querySelector('.playground');
    const setBusy = () => {
      shell.classList.add('is-busy');
      window.setTimeout(() => shell.classList.remove('is-busy'), 8000);
    };
    const ambientMotion = ${ambientMotion ? 'true' : 'false'};
    const placement = '${this.placement}';
    const motions = placement === 'panel'
      ? ['is-sitting', 'is-stretching', 'is-tail-flicking', 'is-napping']
      : ['is-wandering', 'is-sitting', 'is-stretching', 'is-tail-flicking'];
    const clearMotions = () => sprite?.classList.remove(...motions);
    let companionLeft = 8;
    let companionDirection = 1;
    let playgroundWidth = 420;
    const clampCompanion = () => {
      if (!sprite || placement !== 'panel') {
        return;
      }

      const maxLeft = Math.max(0, playgroundWidth - sprite.clientWidth - 16);
      companionLeft = Math.min(companionLeft, maxLeft);
      sprite.style.setProperty('--companion-left', companionLeft + 'px');
    };
    const updatePlaygroundSize = () => {
      if (placement !== 'panel') {
        return;
      }

      root.style.setProperty('--panel-height', window.innerHeight + 'px');
      playgroundWidth = playground?.clientWidth ?? playgroundWidth;
      clampCompanion();
    };
    const moveCompanion = () => {
      if (!sprite || placement !== 'panel') {
        return;
      }

      updatePlaygroundSize();
      const maxLeft = Math.max(0, playgroundWidth - sprite.clientWidth - 16);
      const step = Math.max(70, Math.min(260, Math.round(playgroundWidth * (0.18 + Math.random() * 0.2))));
      let nextLeft = companionLeft + (step * companionDirection);

      if (nextLeft >= maxLeft) {
        nextLeft = maxLeft;
        companionDirection = -1;
      } else if (nextLeft <= 0) {
        nextLeft = 0;
        companionDirection = 1;
      } else if (Math.random() < 0.28) {
        companionDirection *= -1;
      }

      companionLeft = Math.round(nextLeft);
      sprite.classList.add('is-walking');
      sprite.classList.toggle('is-facing-left', companionDirection < 0);
      sprite.style.setProperty('--companion-left', companionLeft + 'px');
      window.setTimeout(() => sprite.classList.remove('is-walking'), 5400);
    };
    const playAmbientMotion = () => {
      if (!ambientMotion || !sprite || shell.classList.contains('is-busy')) {
        return;
      }

      clearMotions();
      if (placement === 'panel' && Math.random() < 0.65) {
        moveCompanion();
        return;
      }

      const motion = motions[Math.floor(Math.random() * motions.length)];
      sprite.classList.add(motion);
      window.setTimeout(clearMotions, 2600);
    };

    if (ambientMotion) {
      if (placement === 'panel') {
        sprite?.style.setProperty('--companion-left', companionLeft + 'px');
        updatePlaygroundSize();
        window.addEventListener('resize', updatePlaygroundSize);
        if (playground && 'ResizeObserver' in window) {
          new ResizeObserver(updatePlaygroundSize).observe(playground);
        }
      }

      window.setInterval(playAmbientMotion, placement === 'panel' ? 6500 : 11000);
      window.setTimeout(playAmbientMotion, placement === 'panel' ? 1400 : 2400);
    }

    document.getElementById('refresh-button').addEventListener('click', () => {
      clearMotions();
      setBusy();
      vscode.postMessage({ type: 'refresh' });
    });
    document.querySelectorAll('[data-command]').forEach((button) => {
      button.addEventListener('click', () => {
        clearMotions();
        setBusy();
        vscode.postMessage({ type: 'runCommand', command: button.dataset.command });
      });
    });
  </script>
</body>
</html>`;
  }

  private getMessage(changedFiles: number, warnDirtyFilesOver: number, tone: CompanionTone): string {
    if (changedFiles >= warnDirtyFilesOver) {
      return {
        calm: 'There are many changed files. It is a good point to organize them.',
        strict: 'Changed files are over the configured limit. Split the work into clear units now.',
        light: 'Changes are piling up. A quick cleanup pass would help.'
      }[tone];
    }

    if (changedFiles > 0) {
      return {
        calm: 'There are changed files. Group them into a useful commit unit when ready.',
        strict: 'You have active changes. Keep the commit boundary visible.',
        light: 'You have some changes. Small tidy commits will keep the flow smooth.'
      }[tone];
    }

    return {
      calm: 'The workspace is clean. You can start the next task.',
      strict: 'There are no changes. Pick the next target and proceed.',
      light: 'Workspace is clean. Good time to move to the next task.'
    }[tone];
  }

  private getReminders(options: {
    changedFiles: number;
    lastTestMinutes?: number;
    remindCommitAfterChangedFiles: number;
    remindTestAfterMinutes: number;
    sessionMinutes: number;
    showWorkTimeAfterMinutes: number;
  }): string[] {
    const reminders: string[] = [];

    if (options.changedFiles >= options.remindCommitAfterChangedFiles) {
      reminders.push('Commit check: review changed files and remove unrelated edits before committing.');
    }

    if (options.lastTestMinutes === undefined) {
      reminders.push('No test run has been recorded yet.');
    } else if (options.lastTestMinutes >= options.remindTestAfterMinutes) {
      reminders.push(`Last test run was ${options.lastTestMinutes} minutes ago.`);
    }

    if (options.sessionMinutes >= options.showWorkTimeAfterMinutes) {
      reminders.push(`Work session has been running for ${options.sessionMinutes} minutes. Review the current unit of work.`);
    }

    return reminders;
  }

  private async getGitChangedFiles(): Promise<number> {
    const gitExtension = vscode.extensions.getExtension('vscode.git');

    if (!gitExtension) {
      return 0;
    }

    if (!gitExtension.isActive) {
      await gitExtension.activate();
    }

    const gitApi = gitExtension.exports.getAPI(1);
    const changedFiles = new Set<string>();

    for (const repository of gitApi.repositories ?? []) {
      for (const change of [
        ...repository.state.workingTreeChanges,
        ...repository.state.indexChanges,
        ...repository.state.mergeChanges
      ]) {
        changedFiles.add(change.uri.fsPath);
      }
    }

    return changedFiles.size;
  }

  private getCharacterUri(webview: vscode.Webview, characterPath: string): string | undefined {
    const trimmedPath = characterPath.trim();

    if (!trimmedPath) {
      return undefined;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const isAbsolutePath = /^[a-zA-Z]:[\\/]/.test(trimmedPath) || trimmedPath.startsWith('/');
    const resourceUri = isAbsolutePath
      ? vscode.Uri.file(trimmedPath)
      : workspaceFolder
        ? vscode.Uri.joinPath(workspaceFolder.uri, trimmedPath)
        : undefined;

    return resourceUri ? webview.asWebviewUri(resourceUri).toString() : undefined;
  }

  private runCommand(command: string): void {
    if (/\btest\b/i.test(command)) {
      this.context.globalState.update('lastTestAt', Date.now());
    }

    this.busyUntil = Date.now() + 8000;
    const terminal = vscode.window.createTerminal('Code Companion');
    terminal.show();
    terminal.sendText(command);
    this.refresh();
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
