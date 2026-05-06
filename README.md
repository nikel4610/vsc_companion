# Code Companion

A personal VSCode companion extension for work habits, reminders, and project routines.

## Goals

- Show a companion UI in the sidebar Webview.
- Show a companion view in the bottom Panel for a less intrusive roaming character.
- Show Git changed file count and workspace status.
- Show reminders for test runs, commit checks, and work session time.
- Run common project commands from Webview buttons.
- Allow character image and message tone customization through settings.

## Settings

- `codexCompanion.characterName`: companion display name
- `codexCompanion.characterPath`: workspace-relative or absolute image path
- `codexCompanion.tone`: `calm`, `strict`, or `light`
- `codexCompanion.warnDirtyFilesOver`: changed file warning threshold
- `codexCompanion.remindCommitAfterChangedFiles`: commit checklist reminder threshold
- `codexCompanion.remindTestAfterMinutes`: test reminder threshold in minutes
- `codexCompanion.showWorkTimeAfterMinutes`: work session reminder threshold in minutes
- `codexCompanion.ambientMotion`: subtle idle motions in the companion panel
- `codexCompanion.commands`: command buttons shown in the Webview

## Development

```bash
npm install
npm run compile
npm run watch
npm run lint
npm test
```

If PowerShell blocks `npm.ps1`, use `npm.cmd run compile` or the equivalent `npm.cmd` command.

Press `F5` in VSCode to run the Extension Development Host.
