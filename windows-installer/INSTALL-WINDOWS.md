# Windows installation

1. Install and launch DSH Desktop once, then fully quit DSH.
2. Extract the complete ZIP to a normal local folder. Do not run it inside the ZIP preview.
3. Double-click `install.cmd` in this folder.
4. Restart DSH Desktop, enable Design Mode, and open Canvas.

The installer copies both DSH runtime layers, updates detected profiles, stores a recoverable distribution under `%USERPROFILE%\.dsh\canvas-suite\distribution`, and registers a login repair task for DSH updates.

If the canvas entry disappears after a DSH update, run `install.cmd` again. Run `health-check.cmd` to collect a health report.

Logs: `%USERPROFILE%\.dsh\logs\dsh-canvas-windows.log`

See the repository `README.md` for the Chinese overview and `WINDOWS-TEST-CHECKLIST.md` for the acceptance checklist.
