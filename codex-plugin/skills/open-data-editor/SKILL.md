---
name: open-data-editor
description: Use when the user wants to open, start, or use the local Data Editor from Codex.
---

# Open Data Editor

Use this skill when the user wants the standalone `data-editor` experience inside Codex.

## Goal

Make the local editor available without the user needing to remember the URL or manually start the dev server.

## Preferred Execution Surface

- Prefer the Browser plugin over the normal text-only reply path.
- Use the Codex in-app browser directly through Browser + `node_repl` when available.
- Treat plain-text replies with a URL as fallback behavior only when Browser control is unavailable in the current session.

## Workflow

1. Resolve the project root in this order:
   - Prefer `%USERPROFILE%\.codex\data-editor-plugin-config.json` if it exists and contains `projectRoot`.
   - Otherwise, prefer the current workspace root when it contains `data/`.
   - Otherwise, search parent directories of the current workspace for the same markers.
   - If no valid root is found, ask the user for the project root instead of guessing.
2. Resolve the standalone Data Editor root in this order:
   - Prefer `%USERPROFILE%\.codex\data-editor-plugin-config.json` if it exists and contains `editorRoot`.
   - Otherwise, prefer `C:\Code\data-editor` when it contains `package.json`.
   - Otherwise, ask the user for the Data Editor root instead of guessing.
3. Check whether `http://127.0.0.1:8787/api/health` is already responding.
4. If the editor is not responding, start the local app from `<editorRoot>`:
   - command: `npm run open -- --project <projectRoot> --adapter nocturnel`
   - this command should prefer the built static app for fast startup and only fall back to `npm run dev` when `dist/` is missing
5. Re-check `http://127.0.0.1:8787/api/health` until the service is ready or a clear startup error is found.
6. Open `http://127.0.0.1:8787/` in the Codex in-app browser only after the service is ready.
7. Return the verified URL and health result.

## Browser Path

When Browser is available, the open step should be executed through the Codex in-app browser control path instead of waiting to finish a normal answer first. The intended behavior is:

1. Acquire the `iab` browser.
2. Create or reuse a visible in-app browser tab.
3. Navigate that tab to `http://127.0.0.1:8787/` after readiness is verified.

## Notes

- Prefer the Codex in-app browser over external browsers.
- Keep the root set to the resolved `projectRoot` so the editor points at the real project data.
- If the server is already running, do not restart it unless the user asks.
- If the user asks to debug editor behavior after opening it, continue working against the same local URL.
- Favor stable service readiness over perceived latency: verify first, open second.
- If Browser control is unavailable in the current session, explicitly say that and fall back to a plain text URL or manual open instruction.
- If the user explicitly wants the latest unbuilt editor frontend while developing `data-editor`, use `npm run dev -- --project <projectRoot> --adapter nocturnel` instead of the fast open path.
- The optional config file format is:

```json
{
  "editorRoot": "C:\\Code\\data-editor",
  "projectRoot": "C:\\Code\\Nocturnel"
}
```
