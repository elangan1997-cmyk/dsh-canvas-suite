# DSH 画布套件 macOS 安装包

本目录是 Mac 完整版安装器工程。构建产物是一个一体化 DMG，包含：

- 官方签名、未修改的 `DSH Desktop.app`（由同一 PKG 安装）
- 最新 `canvas-workbench` 画布与 DSH 2.x 兼容版 `dsh-codex`
- Apple Silicon + Intel 双架构 Python 图像运行时
- ISNet 去背景模型、VTracer 与 ImageTracerJS
- 中文安装与卸载说明
- 可直接交给本机 Agent 执行的完整安装、配置、验收与回滚说明
- 可选的 Dockyard Codex 会员推理安装入口（固定到已检查 commit，用户确认后才安装）

画布插件安装到 `/Library/Application Support/DSH Canvas Suite/`，再同步到当前登录用户的 DSH Profile。独立文件浏览器不再随包安装；项目目录操作由画布插件自身提供。安装器不会收集或打包 API Key、OAuth 凭据、聊天记录和画布项目。

## 构建

```bash
./mac-installer/build-macos-installer.sh
```

可通过环境变量覆盖 DSH 应用路径和输出目录：

```bash
DSH_APP_PATH="/Applications/DSH Desktop.app" OUTPUT_DIR="$PWD/dist" \
  ./mac-installer/build-macos-installer.sh
```

## 产物与 GitHub 发布

- `dist/DSH-Canvas-Suite-<版本>-macOS-Complete.pkg`
- `dist/DSH-Canvas-Suite-<版本>-macOS-Complete.dmg`
- SHA-256 校验文件

未配置 Apple Developer Installer 证书时，PKG 本身不会签名；DMG 内的 DSH Desktop 仍保留官方签名与公证票据。公开分发前应使用自己的 Developer ID Installer 对 PKG 签名并完成公证。

运行时缓存（CPython、ONNX 模型和 ImageTracerJS）约 1GB，已由 `.gitignore` 排除，不会提交到 Git 历史。发布完整版本时，将本地构建出的 DMG、PKG 与 SHA-256 文件上传到 GitHub Release；源码仓库只保留可复现的安装脚本、插件和公开元数据。

从源码重新构建时，`prepare-macos-bundle.sh` 会按清单下载双架构运行时和模型，并支持通过 `MAC_BUNDLE_CACHE` 指定缓存目录。没有外网时，可把已取得的缓存目录作为构建输入，但不要将 API Key、OAuth 或用户项目复制进去。

## 网络策略

- 国内网络：基础画布、PSD/PDF/SVG/AI 预览、去背景和转矢量不需要首次下载；图像生成只需填写可访问的 OpenAI 兼容 API。
- 国外网络：除 API 外，可选 `Codex 统一路由`，使用 ChatGPT/Codex OAuth。
- 安装包不设置代理、DNS 或固定网关，也不包含任何用户凭据。

## 更新

优先从 GitHub Releases 下载最新 DMG，安装器会在写入 Profile 前备份现有插件和 patch；DSH Desktop.app 不在插件目录内修改。仅更新源码/开发副本时，在仓库根目录运行 `./sync-local-plugins.sh`，或安装后运行 `/Library/Application Support/DSH Canvas Suite/sync-local-plugins.sh`。
