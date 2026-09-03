# Mac 构建缓存（不提交）

完整 Mac 安装包需要双架构 CPython、ISNet ONNX 模型和 ImageTracerJS 运行时。它们体积较大，已在仓库 `.gitignore` 中排除，不进入 Git 历史。

在 macOS 上从仓库构建时直接运行：

```bash
./mac-installer/build-macos-installer.sh
```

脚本会按 `runtime-requirements.txt` 和固定 SHA-256 下载并校验依赖，缓存写入本目录。发布时请将生成的 DMG/PKG 及 `.sha256` 文件作为 GitHub Release 资产上传，而不是把缓存目录强行提交到仓库。
