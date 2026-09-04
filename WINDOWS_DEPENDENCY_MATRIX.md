# Windows 依赖矩阵

构建目标：Windows 10/11 x64、普通用户权限、首次安装不要求 Node.js/Python/Git/npm/pip。

| 组件 | 运行时来源 | 发布包位置 | 必需 | 缺失时行为 |
|---|---|---|---|---|
| DSH Desktop/Electron | 当前可启动的 DSH 安装 | `app/` | 是 | 安装失败 |
| Canvas Workbench | 本仓库 | `app/resources/app/node_modules/@local/canvas-workbench` | 是 | 安装失败 |
| Home Explorer | 本仓库 | `app/resources/app/node_modules/@local/home-explorer` | 是 | 文件浏览入口不可用 |
| dsh-codex | 当前 DSH 用户 profile | `app/resources/app/runtime/plugins/dsh-codex` | 是（Codex 路线） | 构建时提示；`-AllowMissingCodex` 可生成 API-only 包 |
| Electron 内置 Node | DSH/Electron | `app/` | 是 | 无需系统 Node/npm |
| Portable Python | 构建机 Python 3.12 +锁定 site-packages | `support/canvas-workbench/python-runtime` | 是（PSD/去背） | 诊断为受限，基础画布仍可打开 |
| rembg 模型 | `.dsh/canvas-workbench/rembg-models` | `support/canvas-workbench/rembg-models` | 推荐 | 去背不可用 |
| ImageTracerJS | `.dsh/canvas-workbench/imagetracer-runtime` | `support/canvas-workbench/imagetracer-runtime` | 推荐 | 转矢量不可用 |
| Tesseract.js | `.dsh/canvas-workbench/tesseract-runtime` | `support/canvas-workbench/tesseract-runtime` | 推荐 | 回退到聊天视觉模型 |
| Adobe Photoshop/Illustrator | 用户电脑安装 | 不打包 | 否 | 显示未检测到，可手动选择 |
| API Key/代理凭据 | 用户配置 | 不打包 | 否 | 由用户在 DSH 中配置 |

## 路径与权限

- 程序默认安装到 `%LOCALAPPDATA%\Programs\DeepSeek Harness`，不需要管理员权限。
- 用户项目和凭据仍在 `%USERPROFILE%\.dsh`；运行日志在 `%LOCALAPPDATA%\DSH\Logs`。
- 安装器不修改系统 PATH，不覆盖用户项目，不把密钥写入发布包。

