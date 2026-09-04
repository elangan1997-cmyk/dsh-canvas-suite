# DSH Windows 发布打包审计

审计日期：2026-09-02  
目标：把现有 DSH Desktop、Canvas Suite 和必要运行时组成可迁移的 Windows x64 发布包。

## 真实架构结论

- **桌面框架：Electron。** 当前安装目录包含 `DeepSeek Harness.exe`、Electron Chromium DLL/Pak 文件，Electron 主进程位于 `resources/app/lib/main.js`。
- **Host：Node.js 通过 Electron 自带运行时启动。** Electron 主进程以 `ELECTRON_RUN_AS_NODE=1` 启动 DSH Web Host 子进程，使用随机 loopback 端口，并由 `HttpHarnessTransport` 代理到渲染器。
- **本地 HTTP：有。** DSH Web Host 和 Canvas 插件均注册 `/dsh-canvas/*`、`/dsh-home-explorer/*` 等同源路由；不是独立公网服务，优先绑定 `127.0.0.1`。
- **插件装载：Cordis profile + Electron 插件目录。** DSH Desktop 通过 `runtime/host.patch.yml`、`plugins.cordis.yml` 和 `resources/app/node_modules` 发现插件。Canvas Suite 已按 Electron ecosystem plugin 方式打进发布包，不再依赖开发仓库绝对路径。
- **Canvas 插件：DSH 内部插件。** `canvas-workbench` 提供 Host (`lib/index.js`) 和 Web client (`lib/client.js`)，内嵌 Excalidraw/React 生产资源；`home-explorer` 是同样结构的可选文件浏览器插件。
- **Python：子进程能力，不是 DSH 启动硬依赖。** PSD、背景移除、图像处理脚本通过 Host 的受限 subprocess 启动 Python。发布包将构建机 Python 3.12 的标准库与锁定的图像包合并为可迁移 `python-runtime`；旧版用户目录运行时仍可回退。
- **本地模型/工具：可选增强。** rembg + `isnet-general-use.onnx`、psd-tools、Tesseract.js、ImageTracerJS 可随发布包提供；没有这些资源时基础画布仍可启动并给出诊断状态。
- **Node/npm：Build-time only。** ImageTracerJS 已支持使用 Electron 内置 Node；发布运行不执行 `npm install`。系统 `node`、`npm`、`pnpm` 不属于安装前置条件。
- **Photoshop/Illustrator：Optional Integration。** 通过注册表、标准路径和手动路径检测；没有 Adobe 时 DSH 主体不阻断。UXP `.ccx` 当前仓库没有可打包的 Adobe 插件，不能虚构已支持的静默安装。
- **网络/API：配置由用户提供。** 不打包任何 API Key、OAuth Cookie 或代理凭据。系统代理通过 Electron/环境变量传递；网络不可用不应阻止离线画布启动。

## 发现的打包风险与处理

| 风险 | 证据 | Release 处理 |
|---|---|---|
| 依赖开发机 `.dsh` profile | `resources/app/lib/main.js` 读取 `%USERPROFILE%\\.dsh` | Canvas/文件浏览器复制进 app ecosystem；Codex 复制进 bundled runtime plugin；首次启动创建用户数据目录 |
| Python venv 含开发者绝对路径 | `pyvenv.cfg` 指向开发机 Python | 生成无 `pyvenv.cfg` 的可迁移 `python-runtime`，使用合并标准库/site-packages |
| ImageTracer 依赖系统 Node/npm | `vectorize_image.py` 原来调用 `shutil.which('node')` | 优先 `DSH_NODE_EXECUTABLE`，由 Electron 内置 Node 执行；已存在运行时不安装 npm |
| 打包时覆盖用户数据 | 旧安装包含项目和凭据 | Installer 只替换程序目录和 Canvas 运行时，保留 `.dsh` 其余内容；卸载默认保留用户数据 |
| 无管理员权限 | 网吧/公司账户常见 | 默认安装到 `%LOCALAPPDATA%\\Programs\\DeepSeek Harness`，不修改系统 PATH、不关闭安全软件 |
| 未签名 SmartScreen | 当前环境没有签名证书/`signtool` | 生成 SHA-256；发布流水线预留 Authenticode 签名步骤，当前包明确为 unsigned build |
| Adobe 版本差异 | 机器可能没有 Photoshop | 只在可检测到 Adobe 时启用联动，显示实际版本/不可用原因 |

## 本次新增交付

- `windows-installer/build-release.ps1`：从当前 DSH 安装目录生成 self-contained payload、运行时清单和不受 IExpress 光盘容量限制的单文件自解压 EXE。
- `windows-installer/sfx-stub.cs`：Windows .NET Framework 自解压引导，仅提取匿名 payload 并调用安装脚本。
- `windows-installer/install-release.ps1`：默认 per-user 安装、Repair 复用、快捷方式、首次启动。
- `windows-installer/doctor.ps1`：UI/命令行可调用的环境诊断，输出 `%LOCALAPPDATA%\\DSH\\Logs\\environment.json`。
- `windows-installer/uninstall-release.ps1`：卸载程序但默认保留用户项目、配置和凭据。
- `release-manifest.json`：记录 DSH、插件、运行时、模型哈希和构建来源。

## 未能在当前环境完成的项目

- 当前仓库不包含 DSH Desktop 的原始源码和官方 Electron 构建链，因此 Release 构建以本机已安装且可启动的 DSH Desktop 为输入；不能凭空重建上游 DSH。
- 当前环境无 Authenticode 证书、Photoshop UXP `.ccx`、干净 Windows VM；这些项目已写入发布检查清单，不能宣称已经现场验证。

## 本机实际构建结果

- 产物：`dist\DSH-Setup-x64-v0.1.1-rc.2-installer-r4.exe`
- 大小：745,478,183 bytes
- SHA-256：`66c70d2552f67b69af88c49bba7ba8f4bd0f951fa45fc41a54bff709f06c89a4`
- 已核对内嵌 payload：745,467,928 bytes，与构建前 ZIP 字节数完全一致；DSH/Electron、Canvas、Home、dsh-codex、根安装入口、便携 Python 和 rembg 模型均存在。
- 已完整解压 27,981 个条目；主窗口实时显示准备百分比、解压百分比/文件计数/当前文件及安装阶段。
- 已通过发布隐私扫描：无登录令牌、API Key、项目/聊天数据、日志、source map、Python 字节码、开发机用户名路径。
- 已通过旧插件冲突测试：真实插件目录迁移到 `.dsh\plugin-link-backups`，旧 junction 清理，无关目录保持不动。
- 已通过：Node/Python/PowerShell 语法检查、可移植性检查、图像引擎 mask forwarding 检查、图像合成 seam 检查、环境医生 JSON 运行。
