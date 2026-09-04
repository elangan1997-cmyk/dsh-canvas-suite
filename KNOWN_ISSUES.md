# 已知限制

- DSH Desktop 上游源码不在本仓库；构建器必须以一份本机已安装且可运行的 DSH Desktop 为输入。
- Windows 自解压安装包当前未签名，首次运行可能出现 SmartScreen 提示；发布流水线应增加 Authenticode 签名。
- 没有 Photoshop/Illustrator 或未授权 UXP 时，Adobe 编辑按钮会显示不可用；这不是安装失败。
- 如果构建机缺少 Python、rembg 模型或其他 Canvas 运行时，构建器会跳过对应资源并在 `release-manifest.json` 标记；正式包应使用完整资源构建。
- 网络、系统代理、DeepSeek/Codex 登录状态属于用户环境，安装器不代替登录。
