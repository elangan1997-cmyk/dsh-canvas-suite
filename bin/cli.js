#!/usr/bin/env node
/* dsh设计画布工作台 —— 命令行入口
 * 用法: npx github:elangan1997-cmyk/dsh-canvas-suite plug|unplug
 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const cmd = (process.argv[2] || '').toLowerCase();

if (cmd === 'plug' || cmd === 'install' || cmd === 'i') {
  const r = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, '..', 'plugin-bundle', 'plug-plugins.ps1')
  ], { stdio: 'inherit', windowsHide: false });
  process.exit(r.status || 0);
}

if (cmd === 'unplug' || cmd === 'uninstall' || cmd === 'remove') {
  const r = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, '..', 'plugin-bundle', 'unplug-plugins.ps1')
  ], { stdio: 'inherit', windowsHide: false });
  process.exit(r.status || 0);
}

console.log('');
console.log('  dsh设计画布工作台 (dsh-design-canvas-workbench)');
console.log('');
console.log('  用法:');
console.log('    dsh-plug        装入插件（canvas-workbench + dsh-codex，已有则跳过）');
console.log('    dsh-unplug      拔出插件（备份到 %LOCALAPPDATA%\\DSH\\unplugged）');
console.log('    dsh-design-canvas-workbench plug|unplug   等价写法（npx 场景）');
console.log('');
console.log('  前提: 已安装 DSH Desktop，且 DSH 已完全退出（含系统托盘）。');
console.log('');
process.exit(cmd ? 1 : 0);
