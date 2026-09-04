# DSH Desktop + Canvas Suite Windows Release

## 安装包内容

- DSH Desktop/Electron 完整程序目录。
- Canvas Workbench、Home Explorer 和 dsh-codex 路由插件。
- 可迁移 Python 运行时、PSD/去背依赖、rembg 模型、Tesseract.js、ImageTracerJS（构建机检测到的资源）。
- 环境医生、安装/修复/卸载脚本、`release-manifest.json` 和 SHA-256 校验文件。
- 发布包经过隐私清理：不包含构建机登录状态、API Key、项目/聊天记录、代理凭据、日志或开发机路径；每台电脑首次使用时由用户自行登录或填写 API。
- 升级安装会处理旧版残留的 Canvas/Home/dsh-codex 插件目录或链接；真实目录移入 `.dsh\plugin-link-backups`，避免首次启动出现 `EEXIST`。

## 使用方式

双击 `DSH-Setup-x64-v*.exe`，默认按当前用户安装，不需要管理员权限。安装器不会删除 `%USERPROFILE%\.dsh` 中的项目和凭据；卸载也默认保留用户数据。把安装包复制到其他电脑不会带走本机的登录配置。

## 重要限制

- 当前仓库没有 DSH Desktop 上游源码和官方签名证书，安装包由本机已安装的可启动 DSH 组装，属于 unsigned build。
- Photoshop/Illustrator 及其 UXP 插件不随包提供，需用户另行安装；Adobe 不存在时画布主体仍可用。
- 当前环境没有干净 Windows 虚拟机，因此网吧/新电脑清单尚未由本机代替执行。
