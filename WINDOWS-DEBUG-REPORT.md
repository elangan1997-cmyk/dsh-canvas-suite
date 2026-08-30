# Windows Debug Report

## Environment

- Date: 2026-08-31 (Asia/Shanghai)
- DSH URL: `http://127.0.0.1:3080/`
- Active profile: `web`
- Installed canvas-workbench before repair: `1.4.0-windows-preview.1`
- Installed home-explorer: `1.1.0`
- Node.js: `24.16.0`
- Python: `3.12`
- Git: `2.54.0`

Secrets, chat contents, and user asset paths are intentionally omitted.

## WIN-001 Canvas iframe fails to parse and renders blank

- Severity: blocker
- Environment: Windows, DSH web profile, canvas-workbench 1.4.0-windows-preview.1
- Preconditions: enable Design Mode and open the existing test canvas project
- Minimal reproduction: Design Mode → project menu → open test project
- Expected: the saved canvas and its image elements render
- Actual: the shell reports the project as loaded, but the iframe is blank
- Console/service error: `SyntaxError: Unexpected token '.'` from `about:srcdoc`
- Root cause: the embedded iframe source contained `e.deltaY>0?.9:1.1`. Without separation after the ternary question mark, Chromium parses `0?.9` as malformed optional chaining and rejects the complete embedded script before startup.
- Modified files: `canvas-workbench/lib/client.js`, `tests/check-portability.mjs`
- Automatic check: `node --check` and portability check passed before installation
- Real UI regression: passed after installation and DSH reload; iframe controls and saved images render
- Status: passed

## WIN-002 Windows PowerShell 5.1 cannot parse localized installer

- Severity: blocker
- Environment: Windows PowerShell 5.1, repository installer scripts encoded as UTF-8 without BOM
- Minimal reproduction: run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows-installer/install.ps1 -NoScheduledTask`
- Expected: installer synchronizes both runtime copies and the recovery distribution
- Actual: Chinese text is decoded as mojibake, followed by unterminated-string and unexpected-brace parser errors
- Root cause: Windows PowerShell 5.1 does not reliably treat BOM-less localized scripts as UTF-8
- Modified files: all `windows-installer/*.ps1` files now use UTF-8 with BOM; `tests/check-portability.mjs` verifies the BOM
- Automatic check: PowerShell 5.1 parser and portability checks passed
- Real UI regression: installer synchronized web/desktop runtime copies successfully
- Status: passed

## WIN-003 Programmatic canvas changes disappear after reload

- Severity: critical data loss
- Minimal reproduction: copy a selected image or paste an image, wait for autosave, then reload
- Expected: the new element remains in the shared project
- Actual: the new element is visible and exportable in the live iframe but disappears after reload
- Root cause: Excalidraw programmatic `api.updateScene()` mutations were assumed to trigger the same persistence callback as direct pointer edits. The parent never received a guaranteed fresh snapshot for copy/paste and related programmatic operations.
- Fix: add an explicit `publishCanvasChange()` snapshot notification after programmatic mutations; assign unique names to copied images.
- Automatic check: added persistence-notification markers to portability checks
- Real UI regression: copy and paste snapshots wrote to `canvas.json`; reload preserved the new elements
- Status: passed

## WIN-004 Windows managed-asset path mismatch causes recursive copies

- Severity: critical disk growth / data corruption
- Minimal reproduction: load a managed image whose `dshSourcePath` uses a Windows drive path and allow project synchronization to run
- Expected: paths already inside `<project>\\assets` are recognized as managed and left in place
- Actual: the client compares a backslash path to a forward-slash `/assets/` prefix, repeatedly rematerializes the same image, and nests the previous full path into each new file name
- Root cause: separator and case normalization were missing from managed-path containment checks; the rename endpoint had the same separator-sensitive containment issue
- Fix: normalize drive paths to forward slashes and lower case before containment/deduplication; use resolved normalized paths on the host
- Test-data recovery: DSH was stopped; 1,016 generated files from the dedicated `TEST` project were moved (not deleted) to `D:\\dsh-画布\\TEST-quarantine-20260831`; `canvas.json` was backed up and its two original managed paths restored
- Automatic check: Windows managed-path marker added to portability checks
- Real UI regression: managed paths no longer recursively rematerialize; asset count remained stable except for one intentional copy per test action
- Status: passed

## WIN-005 Rename and project polling race removes the renamed element

- Severity: critical data loss / stale cross-chat state
- Minimal reproduction: duplicate a managed image, rename it, then open the same canvas project from a new chat
- Expected: the renamed image remains live and every chat reads the same four-image project snapshot
- Actual: the original chat temporarily keeps four images in memory, while `canvas.json` and a newly opened chat contain only three; the renamed element is marked `isDeleted`
- Root cause: the host renames the managed file before the iframe publishes the updated `dshSourcePath`. A project-files poll already in flight can compare its fresh disk listing with the stale element path and misclassify the renamed image as externally deleted.
- Fix: guard elements while their rename is in flight, update the known disk-path set, publish the rename-result scene explicitly, then release the guard and persist the new snapshot.
- Automatic check: `node --check`, portability check, diff check, and source/web/desktop SHA-256 equality passed
- Real UI regression: the fault was reproduced and diagnosed in the real UI; post-fix click regression awaits one manual local-page refresh because browser automation access to `127.0.0.1` was blocked after the DSH restart
- Status: fixed in code and installed; final UI confirmation pending

## WIN-006 Windows Adobe buttons use the default file association

- Severity: serious functional mismatch
- Expected: `Ps 编辑` always starts Photoshop and `AI 编辑` always starts Illustrator
- Actual: both endpoints used the Windows default file association, so raster images could open in Photos and SVG files could open in a browser while the canvas reported Adobe success
- Root cause: the Windows branch delegated to the generic system opener instead of resolving the requested Adobe executable
- Fix: discover installed Adobe product directories under both Program Files roots and launch the matching executable directly; return an honest missing-product error when unavailable
- Environment result: Illustrator 2022 is installed and launched successfully with a harmless SVG; Photoshop is not installed on this computer
- Model image editing: `dsh-codex 0.2.5` is installed and OAuth-authenticated; the image engine health is `ready: true`. The fallback API is not configured. DSH/Node must inherit the active Clash proxy (`127.0.0.1:7890`) for token refresh and image requests.
- Automatic check: JavaScript syntax, portability, and diff checks passed
- Status: fixed, installed, and DSH restarted; runtime health passed; final button click confirmation pending

## Test Matrix

| Area | Static check | Real UI |
|---|---|---|
| DSH startup and Design Mode shell | n/a | passed |
| Embedded canvas startup | passed | passed after reload/restart |
| Project load and persistence | passed | copy and paste remained after reload |
| Drag/drop and paste deduplication | partial | consecutive paste added exactly one element per paste; OS drag still pending |
| Selection and send to chat | n/a | single selection and two-image selection attached to the current draft without sending |
| Move, resize, duplicate, rename, delete | partial | duplicate passed; rename race fixed and installed, final refresh confirmation pending; destructive delete awaits explicit confirmation |
| PNG export | n/a | passed; generated PNG opened and contained all live elements |
| PSD/AI/SVG/PDF fallback | partial | Illustrator 2022 executable launch passed; Photoshop unavailable on this host; endpoint targeting fixed |
| Image engine degradation and retry | partial | no engine is currently ready; static fallback path is intact, UI confirmation pending |
| PowerShell 5.1 installer parsing | passed | passed |
| Programmatic mutation persistence | passed | passed across reload |
| Windows managed asset containment | passed | passed; no recursive growth after repair |
| Cross-chat A→B→A shared state | partial | exposed WIN-005; post-fix confirmation pending after local-page refresh |
