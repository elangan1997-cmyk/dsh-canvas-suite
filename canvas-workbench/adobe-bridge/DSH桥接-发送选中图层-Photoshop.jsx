/*
  DSH 画布桥接 · 一键：发送选中图层 → 画布（Photoshop，无界面）
  ---------------------------------------------------------------------------
  用法：选中图层 → 文件 → 脚本 → DSH桥接-发送选中图层-Photoshop；约 3 秒后图出现在画布。
  不弹窗、不阻塞 Photoshop；只有失败才弹一句提示。等价于 DSH 画布里的按钮（那条路根本不用进 Photoshop）。
  快捷键：动作面板 → 新建动作（分配 F2 等功能键）→ 开始录制 → 点一次这个菜单项 → 停止录制。以后选中图层按 F2 即可。
  「合并为一张」沿用面板里的勾选（~/.dsh/canvas-workbench/adobe-bridge/panel-prefs.json）。
  实现：无头模式载入同目录的面板脚本，直接调 DSH_BRIDGE.ps.*（协议 canvas-workbench/adobe-bridge/PROTOCOL.md）。
*/
#target photoshop
$.global.DSH_BRIDGE_HEADLESS = true;
$.evalFile(new File(new File($.fileName).parent.fsName + '/DSH画布桥接-Photoshop.jsx'));
(function () {
  var B = DSH_BRIDGE;
  try {
    var n = B.ps.sendSelection(!!B.ps.prefs.merged);
    B.log('ps', '一键发送选中图层 → 画布：' + n + ' 项');
  } catch (e) {
    var msg = String(e && e.message ? e.message : e);
    B.log('ps', '一键发送选中图层 → 画布失败：' + msg);
    alert('DSH 画布桥接 · 发送选中图层 → 画布失败\n' + msg);
  }
})();
