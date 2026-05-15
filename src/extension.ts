import * as vscode from 'vscode';

type CompanionState = {
  changedFiles: number;
  sessionMinutes: number;
  lastTestMinutes?: number;
  isBusy: boolean;
  message: string;
  reminders: string[];
  commands: CompanionCommand[];
  character?: CompanionCharacter;
};

type CompanionCommand = {
  label: string;
  command: string;
};

type CompanionTone = 'calm' | 'strict' | 'light';
type CompanionPlacement = 'sidebar' | 'panel';
type CompanionAnimationName = 'idle' | 'walk' | 'sit' | 'sleep' | 'busy';

type CompanionAnimation = {
  row: number;
  frames: number;
  fps: number;
};

type CompanionCharacter = {
  name?: string;
  spritesheetUri: string;
  backgroundUri?: string;
  frameWidth: number;
  frameHeight: number;
  scale: number;
  animations: Partial<Record<CompanionAnimationName, CompanionAnimation>>;
};

export function activate(context: vscode.ExtensionContext): void {
  const sidebarProvider = new CompanionViewProvider(context, 'sidebar');
  const panelProvider = new CompanionViewProvider(context, 'panel');

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CompanionViewProvider.sidebarViewType, sidebarProvider),
    vscode.window.registerWebviewViewProvider(CompanionViewProvider.panelViewType, panelProvider),
    vscode.commands.registerCommand('codeCompanion.open', () => sidebarProvider.open()),
    vscode.commands.registerCommand('codeCompanion.openBottom', () => panelProvider.open()),
    vscode.commands.registerCommand('codeCompanion.refresh', () => {
      sidebarProvider.refresh();
      panelProvider.refresh();
    }),
    vscode.commands.registerCommand('codeCompanion.createConfig', async () => {
      await createCompanionConfig(context);
      sidebarProvider.refresh();
      panelProvider.refresh();
    }),
    vscode.commands.registerCommand('codeCompanion.openConfigFolder', () => openCompanionConfigFolder(context)),
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
        return;
      }

      if (message.type === 'openConfigFolder') {
        openCompanionConfigFolder(this.context);
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
    const config = vscode.workspace.getConfiguration('codeCompanion');
    const changedFiles = await this.getGitChangedFiles();
    const warnDirtyFilesOver = config.get<number>('warnDirtyFilesOver', 8);
    const remindCommitAfterChangedFiles = config.get<number>('remindCommitAfterChangedFiles', 5);
    const remindTestAfterMinutes = config.get<number>('remindTestAfterMinutes', 120);
    const showWorkTimeAfterMinutes = config.get<number>('showWorkTimeAfterMinutes', 60);
    const tone = config.get<CompanionTone>('tone', 'calm');
    const sessionMinutes = Math.floor((Date.now() - this.startedAt) / 60000);
    const lastTestAt = this.context.globalState.get<number>('lastTestAt');
    const lastTestMinutes = lastTestAt ? Math.floor((Date.now() - lastTestAt) / 60000) : undefined;
    const character = await this.loadCharacterConfig();
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
      commands,
      character
    };
  }

  private render(webview: vscode.Webview, state: CompanionState): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css'));
    const nonce = crypto.randomUUID();
    const config = vscode.workspace.getConfiguration('codeCompanion');
    const characterName = state.character?.name ?? config.get<string>('characterName', 'Companion');
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
    const backgroundUri = this.placement === 'panel' ? state.character?.backgroundUri : undefined;
    const playgroundStyle = backgroundUri
      ? ` style="--playground-background: url('${escapeCssUrl(backgroundUri)}')"`
      : '';
    const sprite = state.character
      ? this.renderSpriteSheet(state.character)
      : characterUri
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
          <button id="config-folder-button">Config</button>
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
        <button id="refresh-button">Refresh</button>
        <button id="config-folder-button">Config</button>`
      : '';

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Code Companion</title>
</head>
<body>
  <main class="shell shell-${this.placement}${state.isBusy ? ' is-busy' : ''}">
    <section class="companion" aria-label="Code Companion">
      <div class="playground${backgroundUri ? ' has-background' : ''}"${playgroundStyle}>
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
    const spriteAnimations = {
      idle: ${this.getAnimationScriptValue(state.character, state.character?.animations.idle)},
      walk: ${this.getAnimationScriptValue(state.character, state.character?.animations.walk)},
      sit: ${this.getAnimationScriptValue(state.character, state.character?.animations.sit)},
      sleep: ${this.getAnimationScriptValue(state.character, state.character?.animations.sleep)},
      busy: ${this.getAnimationScriptValue(state.character, state.character?.animations.busy)}
    };
    const setSpriteAnimation = (name) => {
      if (!sprite?.classList.contains('sheet') || !spriteAnimations[name]) {
        return;
      }

      const animation = spriteAnimations[name];
      sprite.style.setProperty('--sprite-row', animation.row);
      sprite.style.setProperty('--sprite-frames', animation.frames);
      sprite.style.setProperty('--sprite-duration', animation.duration + 'ms');
      sprite.style.setProperty('--sprite-y', animation.y + 'px');
      sprite.style.setProperty('--sprite-x-end', animation.xEnd + 'px');
    };
    const clearMotions = () => {
      sprite?.classList.remove(...motions);
      setSpriteAnimation('idle');
    };
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
      const step = Math.max(36, Math.min(120, Math.round(playgroundWidth * (0.1 + Math.random() * 0.12))));
      const previousLeft = companionLeft;
      let nextLeft = companionLeft + (step * companionDirection);

      if (nextLeft >= maxLeft) {
        nextLeft = maxLeft;
      } else if (nextLeft <= 0) {
        nextLeft = 0;
      }

      companionLeft = Math.round(nextLeft);
      const movementDirection = companionLeft < previousLeft ? -1 : 1;
      if (nextLeft >= maxLeft) {
        companionDirection = -1;
      } else if (nextLeft <= 0) {
        companionDirection = 1;
      } else if (Math.random() < 0.28) {
        companionDirection *= -1;
      }

      setSpriteAnimation('walk');
      sprite.classList.add('is-walking');
      sprite.classList.toggle('is-facing-left', movementDirection < 0);
      sprite.style.setProperty('--companion-left', companionLeft + 'px');
      window.setTimeout(() => sprite.classList.remove('is-walking'), 8200);
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
      if (motion === 'is-sitting') {
        setSpriteAnimation('sit');
      } else if (motion === 'is-napping') {
        setSpriteAnimation('sleep');
      } else {
        setSpriteAnimation('idle');
      }
      sprite.classList.add(motion);
      window.setTimeout(clearMotions, 2600);
    };

    if (ambientMotion) {
      setSpriteAnimation('idle');

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
      setSpriteAnimation('busy');
      setBusy();
      vscode.postMessage({ type: 'refresh' });
    });
    document.getElementById('config-folder-button')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openConfigFolder' });
    });
    document.querySelectorAll('[data-command]').forEach((button) => {
      button.addEventListener('click', () => {
        clearMotions();
        setSpriteAnimation('busy');
        setBusy();
        vscode.postMessage({ type: 'runCommand', command: button.dataset.command });
      });
    });
  </script>
</body>
</html>`;
  }

  private renderSpriteSheet(character: CompanionCharacter): string {
    const idle = character.animations.idle ?? { row: 0, frames: 1, fps: 1 };
    const width = character.frameWidth * character.scale;
    const height = character.frameHeight * character.scale;
    const duration = Math.round(1000 / idle.fps * idle.frames);
    const style = [
      `--sprite-image: url('${escapeCssUrl(character.spritesheetUri)}')`,
      `--sprite-frame-width: ${character.frameWidth}px`,
      `--sprite-frame-height: ${character.frameHeight}px`,
      `--sprite-scale: ${character.scale}`,
      `--sprite-width: ${width}px`,
      `--sprite-height: ${height}px`,
      `--sprite-row: ${idle.row}`,
      `--sprite-y: ${idle.row * character.frameHeight * -1}px`,
      `--sprite-frames: ${idle.frames}`,
      `--sprite-x-end: ${idle.frames * character.frameWidth * -1}px`,
      `--sprite-duration: ${duration}ms`
    ].join('; ');

    return `<div class="sprite sheet" data-sprite style="${style}" aria-hidden="true"><span class="sprite-sheet-frame"></span></div>`;
  }

  private getAnimationScriptValue(character?: CompanionCharacter, animation?: CompanionAnimation): string {
    if (!character || !animation) {
      return 'undefined';
    }

    return JSON.stringify({
      row: animation.row,
      frames: animation.frames,
      duration: Math.round(1000 / animation.fps * animation.frames),
      y: animation.row * character.frameHeight * -1,
      xEnd: animation.frames * character.frameWidth * -1
    });
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

  private async loadCharacterConfig(): Promise<CompanionCharacter | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const configUris = [
      ...(workspaceFolder ? [vscode.Uri.joinPath(workspaceFolder.uri, '.code-companion', 'character.json')] : []),
      vscode.Uri.joinPath(this.context.extensionUri, '.code-companion', 'character.json')
    ];

    for (const configUri of configUris) {
      try {
        const rawConfig = await vscode.workspace.fs.readFile(configUri);
        const parsedConfig = JSON.parse(Buffer.from(rawConfig).toString('utf8')) as unknown;

        return this.parseCharacterConfig(parsedConfig, configUri);
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private parseCharacterConfig(value: unknown, configUri: vscode.Uri): CompanionCharacter | undefined {
    if (!isRecord(value)) {
      return undefined;
    }

    const frameWidth = positiveNumber(value.frameWidth);
    const frameHeight = positiveNumber(value.frameHeight);
    const scale = positiveNumber(value.scale) ?? 1;
    const spritesheet = typeof value.spritesheet === 'string' ? value.spritesheet.trim() : '';
    const background = typeof value.background === 'string' ? value.background.trim() : '';

    if (!frameWidth || !frameHeight || !spritesheet) {
      return undefined;
    }

    return {
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : undefined,
      spritesheetUri: this.resolveCharacterResourceUri(configUri, spritesheet),
      backgroundUri: background ? this.resolveCharacterResourceUri(configUri, background) : undefined,
      frameWidth,
      frameHeight,
      scale,
      animations: this.parseAnimations(value.animations)
    };
  }

  private parseAnimations(value: unknown): Partial<Record<CompanionAnimationName, CompanionAnimation>> {
    const animations: Partial<Record<CompanionAnimationName, CompanionAnimation>> = {};

    if (!isRecord(value)) {
      return animations;
    }

    for (const name of ['idle', 'walk', 'sit', 'sleep', 'busy'] as const) {
      const animation = value[name];

      if (!isRecord(animation)) {
        continue;
      }

      const row = nonNegativeNumber(animation.row);
      const frames = positiveNumber(animation.frames);
      const fps = positiveNumber(animation.fps);

      if (row !== undefined && frames && fps) {
        animations[name] = { row, frames, fps };
      }
    }

    return animations;
  }

  private resolveCharacterResourceUri(configUri: vscode.Uri, resourcePath: string): string {
    const isAbsolutePath = /^[a-zA-Z]:[\\/]/.test(resourcePath) || resourcePath.startsWith('/');
    const resourceUri = isAbsolutePath
      ? vscode.Uri.file(resourcePath)
      : vscode.Uri.joinPath(vscode.Uri.joinPath(configUri, '..'), resourcePath);

    return this.view?.webview.asWebviewUri(resourceUri).toString() ?? resourceUri.toString();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function escapeCssUrl(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function createCompanionConfig(context: vscode.ExtensionContext): Promise<void> {
  const configRoot = getConfigRoot(context);

  if (!configRoot) {
    vscode.window.showWarningMessage('Open a workspace folder before creating Code Companion config.');
    return;
  }

  const configDir = vscode.Uri.joinPath(configRoot, '.code-companion');
  const assetsDir = vscode.Uri.joinPath(configDir, 'assets');
  const configUri = vscode.Uri.joinPath(configDir, 'character.json');
  const keepUri = vscode.Uri.joinPath(assetsDir, '.gitkeep');

  await vscode.workspace.fs.createDirectory(assetsDir);

  if (!(await fileExists(configUri))) {
    await vscode.workspace.fs.writeFile(configUri, Buffer.from(defaultCharacterConfig(), 'utf8'));
  }

  if (!(await fileExists(keepUri))) {
    await vscode.workspace.fs.writeFile(keepUri, Buffer.from('', 'utf8'));
  }

  await vscode.window.showTextDocument(configUri);
  vscode.window.showInformationMessage('Code Companion config is ready. Put spritesheet and background images in .code-companion/assets.');
}

async function openCompanionConfigFolder(context: vscode.ExtensionContext): Promise<void> {
  const assetsDir = await ensureCompanionAssetsDir(context);

  if (!assetsDir) {
    return;
  }

  await vscode.commands.executeCommand('workbench.files.action.focusFilesExplorer');
  await vscode.commands.executeCommand('revealInExplorer', assetsDir);
}

async function ensureCompanionAssetsDir(context: vscode.ExtensionContext): Promise<vscode.Uri | undefined> {
  const configRoot = getConfigRoot(context);

  if (!configRoot) {
    vscode.window.showWarningMessage('Open a workspace folder before opening Code Companion config.');
    return undefined;
  }

  const assetsDir = vscode.Uri.joinPath(configRoot, '.code-companion', 'assets');
  await vscode.workspace.fs.createDirectory(assetsDir);
  return assetsDir;
}

function getConfigRoot(context: vscode.ExtensionContext): vscode.Uri | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (workspaceFolder) {
    return workspaceFolder.uri;
  }

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    return context.extensionUri;
  }

  return undefined;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function defaultCharacterConfig(): string {
  return `${JSON.stringify({
    name: 'My Cat',
    frameWidth: 96,
    frameHeight: 96,
    scale: 1,
    spritesheet: 'assets/companion.png',
    background: 'assets/background.png',
    animations: {
      idle: { row: 0, frames: 6, fps: 3 },
      walk: { row: 1, frames: 6, fps: 3 },
      sit: { row: 2, frames: 6, fps: 2 },
      sleep: { row: 3, frames: 6, fps: 2 },
      busy: { row: 4, frames: 6, fps: 5 }
    }
  }, null, 2)}\n`;
}
