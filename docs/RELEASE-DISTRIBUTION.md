# DSH画布工作台：发布与校验

## 两种发布资产

| 资产 | 适用人群 | 内容 | 发布位置 |
| --- | --- | --- | --- |
| `DSH-Setup-x64-*.exe` | 没有 DSH Desktop 的设计人员 | DSH Desktop、画布、文件浏览器和 Windows 本地运行时 | GitHub Release asset |
| `DSH-Canvas-Workbench-*.zip` | 已有 DSH Desktop 的用户 | `@local/canvas-workbench`、Windows/macOS 一键安装脚本和清单 | GitHub Release asset |

完整 EXE 约 745MB，超过 GitHub 普通仓库单文件 100MB 限制，必须作为 Release asset 上传，不能 `git push` 到源码目录。插件 ZIP 也作为 Release asset 上传，源码仓库只保存脚本和说明。

## 发布前检查

1. 运行插件语法检查和现有 Windows 验收清单。
2. 对 EXE 计算 SHA-256，并把 `.sha256` 作为同一 Release asset 上传。
3. 对插件 ZIP 计算 SHA-256，并把 `.sha256` 一并上传。
4. 检查包内不存在 `auth.json`、`.openai-codex-auth.json`、`.credentials.yaml`、日志、source map、Python 字节码和开发者绝对路径。
5. 在干净的 Windows 用户目录执行完整安装包的 `-NoLaunch`/健康检查，再在已有 DSH 的环境执行独立插件 `-CheckOnly`。

## 版本和命名

Release 名称使用 `DSH画布工作台 v<版本>`；资产保持 ASCII 文件名，避免不同系统下载器对中文文件名处理不一致。README 和 Release 说明中显示中文产品名。

## 个人配置边界

完整安装包只安装程序和插件，不复制开发者的 DSH 配置。新用户首次启动后自行登录 DSH 或填写自己的 API；已有用户的项目、登录状态和 API 凭据由安装脚本保留。
