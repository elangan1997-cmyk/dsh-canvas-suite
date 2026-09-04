# Windows 打包进度

更新时间：2026-09-02

## 已完成

- 完成 DSH 安装目录、Electron Host、Cordis/profile、Canvas 运行时和用户数据路径审计。
- 增加 self-contained payload 构建器、单文件自解压引导、per-user 安装/修复/卸载和环境医生。
- Canvas/Home 作为 Electron ecosystem plugin 打入 `resources/app`；dsh-codex 打入 bundled runtime plugin。
- Python、模型、Tesseract.js、ImageTracerJS 支持随包复制；生成运行时文件清单和模型哈希。
- 已通过 PowerShell/Node/Python 静态语法检查。
- 已完成本机完整资源构建：`dist\DSH-Setup-x64-v0.1.1-rc.2-installer-r4.exe`，745,478,183 bytes，SHA-256 为 `66c70d2552f67b69af88c49bba7ba8f4bd0f951fa45fc41a54bff709f06c89a4`。
- 已核对 EXE 内嵌 payload：745,467,928 bytes，与 payload ZIP 完全一致；已完整解压 27,981 个条目，并验证主窗口实时显示解压百分比、文件计数和当前文件。
- 已通过发布隐私扫描：不含个人账号、API Key、项目/聊天记录、日志、source map、pyc 或开发机路径。
- 已验证安装时自动备份旧的真实插件目录并清理旧 junction，修复首次启动 `EEXIST`。

## 待发布前完成

- 在无开发工具的 Windows 10/11 干净账户执行网吧清单。
- 配置代码签名证书并归档第三方 license/NOTICE。
