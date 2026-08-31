# Canvas Workbench

面向 DSH 的可插拔无限画布插件。画布本体、项目文件同步、图片输出卡片和图片编辑共用同一插件；DSH 更新时只需重新同步本地插件副本，不会覆盖项目 `assets/`、`outputs/` 或画布快照。

## 图片引擎

在画布右上角选择“更多 → 图像引擎设置”，二选一：

- `dsh-codex`：使用独立的 ChatGPT/Codex OAuth。安装后运行：

  ```sh
  dsh plugin --profile web add dsh-codex
  ~/.dsh/profiles/web/node_modules/.bin/dsh-openai-codex login
  ```

- `API`：兼容现有 image2 网关，从本机 `~/.codex-pixel/auth.json` 读取密钥。密钥不会进入项目、前端或 Git。

两种引擎不会静默互相切换。设置面板会显示安装、登录和 API 凭据状态；后端健康接口为 `/dsh-canvas/health`，设置接口为 `/dsh-canvas/image-settings`。

## 本地同步与检查

在工作区根目录运行：

```sh
./sync-local-plugins.sh          # 同步 node/desktop 两层本地插件
./sync-local-plugins.sh --check  # 语法、副本、兼容层和 DSH HTTP 检查
```

脚本采用临时目录和原子替换，DSH 正在启动时不会读到半份插件。DSH 本身没有稳定的更新后钩子，因此建议在 DSH 更新后重新运行一次 `--check`；已有项目数据不受影响。

## Windows 初级版

Windows 10/11 解压分发包后运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\windows-installer\install.ps1
```

初级版优先保证无限画布、项目持久化、外部拖入、剪贴板粘贴、聊天图片明确加入画布、多选发送聊天、PNG 导出以及资源管理器打开/定位。文字识别首次按需在用户目录安装隔离的 Tesseract.js（不需要系统 tesseract.exe）；Python、rembg、VTracer、Photoshop 和 Illustrator 均为渐进增强：缺少环境时只关闭对应能力，不得阻断画布渲染。

Windows PSD/AI 编辑通过系统文件关联打开；Photoshop 原生文字层自动化第一版仍只在 macOS 提供。详细说明见 `windows-installer/安装说明.md`。

## 兼容原则

宿主只依赖 `webServer`、`subprocess`、`llm`、`attachments` 和 `slots`，会对会话输入、模型选择等可选能力做探测。缺失可选能力时仅关闭对应按钮，不阻断画布渲染。`dsh-codex` 通过运行时动态导入，未安装时仍可使用 API 路由和基础画布。系统调用集中在 `lib/platform.js`，避免 Windows 缺少 macOS 命令时拖垮插件。
