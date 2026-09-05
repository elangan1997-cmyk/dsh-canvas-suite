#!/usr/bin/env node
/* dsh-plug: 把 canvas-workbench + dsh-codex 插件装进已安装的 DSH Desktop */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const ps1 = path.join(__dirname, '..', 'plugin-bundle', 'plug-plugins.ps1');
const r = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
  { stdio: 'inherit', windowsHide: false }
);
process.exit(r.status || 0);
