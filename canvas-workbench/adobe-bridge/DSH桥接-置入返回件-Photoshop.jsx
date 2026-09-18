/*
  DSH 画布桥接 · 一键：置入画布返回件（Photoshop，无界面）
  ---------------------------------------------------------------------------
  用法：画布里点过「→Ps」之后（PS 当时没开、或自动置入失败时）→ 文件 → 脚本 → DSH桥接-置入返回件-Photoshop；返回件作为智能对象置入当前文档并归位。
  不弹窗、不阻塞 Photoshop；只有失败才弹一句提示。等价于 DSH 画布里的按钮（那条路根本不用进 Photoshop）。
  同样可在动作面板录成功能键。
  实现：无头模式载入同目录的面板脚本，直接调 DSH_BRIDGE.ps.*（协议 canvas-workbench/adobe-bridge/PROTOCOL.md）。
*/
#target photoshop
(function () { var d = new File($.fileName).parent.fsName; var s = d.indexOf('\\') >= 0 ? '\\' : '/'; $.global.DSH_BRIDGE_HEADLESS = true; $.evalFile(new File(d + s + 'DSH画布桥接-Photoshop.jsx')); })();
(function () {
  var B = DSH_BRIDGE;
  try {
    var n = B.ps.importPending('place');
    B.log('ps', '一键置入画布返回件：' + n + ' 项');
  } catch (e) {
    var msg = String(e && e.message ? e.message : e);
    B.log('ps', '一键置入画布返回件失败：' + msg);
    alert('DSH 画布桥接 · 置入画布返回件失败\n' + msg);
  }
})();
