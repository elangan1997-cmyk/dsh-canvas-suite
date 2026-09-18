/*
  DSH 画布桥接 · 一键：置入画布返回件（Illustrator，无界面）
  ---------------------------------------------------------------------------
  用法：画布里点过「→Ai」之后（AI 当时没开、或自动置入失败时）→ 文件 → 脚本 → DSH桥接-置入返回件-Illustrator；返回件置入当前文档并归位。
  不弹窗、不阻塞 Illustrator；只有失败才弹一句提示。等价于 DSH 画布里的按钮（那条路根本不用进 Illustrator）。
  
  实现：无头模式载入同目录的面板脚本，直接调 DSH_BRIDGE.ai.*（协议 canvas-workbench/adobe-bridge/PROTOCOL.md）。
*/
#target illustrator
$.global.DSH_BRIDGE_HEADLESS = true;
$.evalFile(new File(new File($.fileName).parent.fsName + '/DSH画布桥接-Illustrator.jsx'));
(function () {
  var B = DSH_BRIDGE;
  try {
    var n = B.ai.importPending('place');
    B.log('ai', '一键置入画布返回件：' + n + ' 项');
  } catch (e) {
    var msg = String(e && e.message ? e.message : e);
    B.log('ai', '一键置入画布返回件失败：' + msg);
    alert('DSH 画布桥接 · 置入画布返回件失败\n' + msg);
  }
})();
