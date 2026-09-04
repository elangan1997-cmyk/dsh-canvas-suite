# 第三方依赖与许可核对

发布包会原样携带当前 DSH Desktop 安装中的 Electron/Node 依赖，以及本仓库插件依赖。运行时资源来自当前用户已安装的 DSH Canvas 运行目录：

- Python 3.12 标准库、Pillow、NumPy、SciPy、rembg、psd-tools 等；许可证和 NOTICE 应随正式发布包一并归档。
- rembg 的 `isnet-general-use.onnx` 模型；发布清单记录 SHA-256。
- Tesseract.js 及其语言包、ImageTracerJS 运行时。

构建脚本不从网络下载依赖，也不把 API Key、OAuth Cookie 或代理密码放进安装包。正式对外发布前应对 `app/node_modules` 和 Python site-packages 生成完整 license/NOTICE 清单，并由发布者确认各依赖的再分发条款。

