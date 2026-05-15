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

- `codeCompanion.characterName`: companion display name
- `codeCompanion.characterPath`: workspace-relative or absolute image path
- `codeCompanion.tone`: `calm`, `strict`, or `light`
- `codeCompanion.warnDirtyFilesOver`: changed file warning threshold
- `codeCompanion.remindCommitAfterChangedFiles`: commit checklist reminder threshold
- `codeCompanion.remindTestAfterMinutes`: test reminder threshold in minutes
- `codeCompanion.showWorkTimeAfterMinutes`: work session reminder threshold in minutes
- `codeCompanion.ambientMotion`: subtle idle motions in the companion panel
- `codeCompanion.commands`: command buttons shown in the Webview

## Character spritesheet

Run `Code Companion: Create Config` from the Command Palette to create the workspace config folder. It creates `.code-companion/character.json` and `.code-companion/assets/` without overwriting an existing config file.

Run `Code Companion: Open Config Folder` to open the image folder directly.

The Webview also includes a `Config` button that opens `.code-companion/assets/`.

The `spritesheet` and `background` paths are resolved relative to `.code-companion/character.json`.

Recommended layout:

- PNG with transparent background
- Total size: `576x480`
- Grid: 6 columns by 5 rows
- Frame size: `96x96`
- No visible grid lines, text, shadows, or background color
- Keep ears, tail, feet, and every outline fully inside each `96x96` frame
- Keep the same foot baseline for standing frames
- Keep the character centered consistently across frames
- Draw the default character facing right; the extension flips it for left movement

Rows:

- Row 0: `idle`, 6 frames
- Row 1: `walk`, 6 frames
- Row 2: `sit`, 6 frames
- Row 3: `sleep`, 6 frames
- Row 4: `busy`, 6 frames

Expected files:

```text
.code-companion/
  character.json
  assets/
    companion-new.png
    background.png
```

```json
{
  "name": "My Cat",
  "frameWidth": 96,
  "frameHeight": 96,
  "scale": 1,
  "spritesheet": "assets/companion-new.png",
  "background": "assets/background.png",
  "animations": {
    "idle": { "row": 0, "frames": 6, "fps": 3 },
    "walk": { "row": 1, "frames": 6, "fps": 3 },
    "sit": { "row": 2, "frames": 6, "fps": 2 },
    "sleep": { "row": 3, "frames": 6, "fps": 2 },
    "busy": { "row": 4, "frames": 6, "fps": 5 }
  }
}
```

For smoother animation, the `walk` row should show a clear right-facing walk cycle with stable foot contact points. If the character appears to slide or walk backward, regenerate or reorder the walk frames before tuning movement speed in code.

The `background` field is optional. If omitted or invalid, the playground keeps the default transparent floor. Background images are shown only in the bottom Panel view; the sidebar keeps a compact character-only view.

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
