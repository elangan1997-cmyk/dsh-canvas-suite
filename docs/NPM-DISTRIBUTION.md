# npm 独立插件分发

`dsh-canvas-workbench` 是给已经安装 DSH Desktop/DSH Web 的电脑使用的轻量插件，不包含 DSH Desktop、Python 运行时、模型文件、账号或 API Key。

## 构建

在仓库根目录运行：

```bash
node scripts/build-npm-package.mjs
cd dist/npm/dsh-canvas-workbench-1.5.4
npm pack --pack-destination ..
```

构建器从 `canvas-workbench/` 复制运行文件，并生成 npm 专用的 `package.json` 与 `cordis.patch.yml`。源码仍保留 `@local/canvas-workbench` 身份，因此不会改变完整安装包和现有本地同步流程。

## 安装

正式发布后：

```bash
dsh plugin --profile web add dsh-canvas-workbench
```

从 GitHub Release 下载 `.tgz` 后也可离线安装插件代码：

```bash
dsh plugin --profile web add /绝对路径/dsh-canvas-workbench-1.5.4.tgz
```

安装后完全退出并重新打开 DSH Desktop。插件自身可离线安装，但图片模型调用仍需要用户配置的 API 网络，或已经登录的 `dsh-codex`。

## 发布

发布者先在自己的终端完成 npm 登录：

```bash
npm login
npm whoami
cd dist/npm/dsh-canvas-workbench-1.5.4
npm publish --access public
```

不要把 npm Token、API Key、OAuth 文件或个人项目加入包。发布前应执行仓库检查和 `npm pack --dry-run`，并核对包内容清单。
