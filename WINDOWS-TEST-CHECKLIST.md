# Windows 初级版验收清单

请在干净的 Windows 10 或 Windows 11 用户账户中测试。

## 安装

- [ ] 先启动一次 DSH Desktop，再退出
- [ ] 解压 ZIP 后运行 `windows-installer/install.ps1`
- [ ] 安装器显示两层插件均已同步
- [ ] 重启 DSH 后设计模式和画布入口出现
- [ ] `windows-installer/health-check.ps1` 不报缺文件

## 基础画布

- [ ] 新建项目无需手输路径
- [ ] 导入已有项目可打开 Windows 文件夹选择器
- [ ] 外部拖入一张图片只出现一张
- [ ] 连续粘贴两张图片都能出现
- [ ] 移动、缩放、删除后切换聊天再回来状态不复活
- [ ] 刷新和重启后恢复上次项目及画布内容
- [ ] 多选两张图片发送至聊天，输入框显示 2 张附件
- [ ] 点击“导出 PNG”得到可打开图片
- [ ] “打开项目文件夹”和“在文件夹中显示”调用资源管理器

## 链接文件和降级

- [ ] 拖入 PSD/AI/SVG/PDF 不让画布白屏
- [ ] 无预览转换器时显示占位预览而非永久加载
- [ ] 未安装 Python 时基础画布仍正常
- [ ] 未安装 Adobe 时点击编辑给出明确错误，画布仍正常
- [ ] 已关联 Photoshop/Illustrator 时能打开对应源文件

## 反馈材料

请附上 Windows 版本、DSH 版本、失败截图、复现步骤和日志：

```text
%USERPROFILE%\.dsh\logs\dsh-canvas-windows.log
```

## Adobe 桥接（v1.8 分支；2026-09-18 起）

在装有 Photoshop / Illustrator 的 Windows 10/11 上逐项验证（代码层已做 Windows 适配：路径分隔符自适应、
远程驱动走 PowerShell COM、CEP 开关注册表；**以下均未实机验证过**）：

- [ ] DSH 启动后 `~/.dsh/canvas-workbench/adobe-bridge/bridge.json` 出现且 20 秒内刷新 `updatedAt`
- [ ] 画布「更多 → 🔗 刷新桥接脚本副本」后 `%USERPROFILE%\.dsh\canvas-workbench\adobe-bridge\scripts\` 有 7 个 .jsx
- [ ] CEP 面板：`%APPDATA%\Adobe\CEP\extensions\com.dsh.canvasbridge\` 存在；注册表 `HKCU\Software\Adobe\CSXS.6~12` 各有 `PlayerDebugMode=1`；重启 PS ≤2024 / AI 后「窗口 → 扩展(旧版/扩展功能) → DSH 画布桥接」打开，状态灯读到 bridge.json
- [ ] 菜单脚本：以管理员运行 `node scripts\install-adobe-bridge.mjs` 后 PS/AI 的「文件 → 脚本」出现 DSH 项
- [ ] **远程驱动（PowerShell COM，重点）**：画布「取 Ps 图层」→ PowerShell 无报错、图 3 秒内上画布；若失败看 bridge-log.jsonl 与 `powershell -NoProfile -Command "(New-Object -ComObject Photoshop.Application).DoJavaScriptFile('<一个测试jsx>')"n` 手动复现
- [ ] 画布「→Ps」→ 运行中的 PS 直接置入并归位；PSD（顶层含组）落地为前缀项、图片落地为组
- [ ] 中文项目路径：项目在含中文/空格的目录时收件/发件/置入都正常（openDocSafe 有 ASCII 副本兜底）
- [ ] 长路径：项目在 %USERPROFILE% 深层目录（总长 > 260 字符）时观察是否异常
