#!/usr/bin/env node
/* dsh-unplug: 把 canvas-workbench + dsh-codex 插件从 DSH Desktop 拔出（备份后移除） */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const ps1 = path.join(__dirname, '..', 'plugin-bundle', 'unplug-plugins.ps1');
const r = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
  { stdio: 'inherit', windowsHide: false }
);
process.exit(r.status || 0);
