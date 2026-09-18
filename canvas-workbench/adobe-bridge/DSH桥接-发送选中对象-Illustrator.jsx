/*
  DSH 画布桥接 · 一键：发送选中对象 → 画布（Illustrator，无界面）
  ---------------------------------------------------------------------------
  用法：选中对象 → 文件 → 脚本 → DSH桥接-发送选中对象-Illustrator；约 3 秒后透明 PNG 出现在画布。
  不弹窗、不阻塞 Illustrator；只有失败才弹一句提示。等价于 DSH 画布里的按钮（那条路根本不用进 Illustrator）。
  分辨率沿用面板里的选择（默认 150 dpi）。
  实现：无头模式载入同目录的面板脚本，直接调 DSH_BRIDGE.ai.*（协议 canvas-workbench/adobe-bridge/PROTOCOL.md）。
*/
#target illustrator
(function () { var d = new File($.fileName).parent.fsName; var s = d.indexOf('\\') >= 0 ? '\\' : '/'; $.global.DSH_BRIDGE_HEADLESS = true; $.evalFile(new File(d + s + 'DSH画布桥接-Illustrator.jsx')); })();
(function () {
  var B = DSH_BRIDGE;
  try {
    var n = B.ai.sendSelection(Number(B.ai.prefs.dpi) || 150);
    B.log('ai', '一键发送选中对象 → 画布：' + n + ' 项');
  } catch (e) {
    var msg = String(e && e.message ? e.message : e);
    B.log('ai', '一键发送选中对象 → 画布失败：' + msg);
    alert('DSH 画布桥接 · 发送选中对象 → 画布失败\n' + msg);
  }
})();
