# DSH Canvas Suite 当前架构审计

更新时间：2026-09-02

## 当前流程

1. `canvas-workbench/lib/client.js` 在画布 iframe 中维护 tldraw 画布快照，并通过同源 HTTP 调用 host。
2. 图片编辑面板从图片元素读取原始数据和项目路径；框选文字时将屏幕坐标逆变换为原图像素坐标。
3. `POST /dsh-canvas/ocr-image` 读取当前聊天模型。单个选区会生成放大裁剪图、蓝框整图和辅助图，再请求视觉模型返回 JSON；失败时回退 Tesseract.js/Python OCR。
4. 视觉模型结果由 `visionBlocks()` 归一化为像素坐标，并生成 `erasePrompt`/`erasePlan`。
5. `POST /dsh-canvas/export-text-psd` 调用当前画布图片引擎生成清理背景，再由 `scripts/export_text_psd.py` 生成 PSD 草稿；可用 Photoshop 时通过 COM/ExtendScript 写入原生文字层。
6. 画布状态保存到项目目录 `canvas.json`，图片资产落盘到项目 `assets` 或聊天原图目录；操作日志经 `/dsh-canvas/log` 提供。

## 代码目录

- `lib/client.js`：画布 UI、选择框、文字编辑面板、聊天/画布桥接。
- `lib/index.js`：host 路由、项目/资产、VLM 调用、图片引擎、PSD/Adobe 调度。
- `lib/image-engine.js`：dsh-codex/API 图片路由、尺寸读取、重试。
- `lib/ocr-engine.js`：Tesseract.js 本地 OCR 和候选几何。
- `scripts/prepare_text_vision_crop.py`：选区放大、蓝框标注和辅助图。
- `scripts/export_text_psd.py`：PSD 草稿和隐藏 OCR 预览层。
- `scripts/prepare_text_mask.py`、`composite_edit.py`：历史遮罩/局部合成工具；当前文字导出已不再使用硬矩形合成。

## 主要数据结构（现状）

- 画布快照使用 tldraw `elements/files/appState`。
- 文字编辑会话目前以 `{ elementId, dataURL, width, height, selection, selections, blocks, erasePrompt, erasePlan }` 保存在 React 状态中。
- `selections` 已数组化，元素为原图像素 `x/y/width/height`；旧版 `selection` 仍兼容。
- `blocks` 是 `TextObject` 的兼容扁平表示，包含 `text/x/y/width/height/fontSize/fontPostScript/color/enabled`。
- `erasePlan.regions` 保存文字和背景描述，但尚未完整保存 selection ID、component ID、polygon 和置信度分层。

## 坐标链

当前鼠标坐标通过图片 DOM 的 `getBoundingClientRect()`、`naturalWidth/naturalHeight` 逆变换到原图像素；缩放、平移、CSS/DPI 不直接进入 PSD。

视觉模型历史上出现过三种坐标约定：0–1、0–1000、裁剪图局部坐标。当前 `visionBlocks()` 会检测全量结果是否处于 0–1 并转换到 0–1000，再转换到原图像素；单选区放大图通过 `cropMapping` 映射回原图。

## 现有 PSD 创建方式

Python 先创建 8-bit RGB PSD，始终保留隐藏 `Original artwork (preserved)`；清理成功时显示 `Clean background (image2)`。OCR 栅格预览组默认隐藏。Photoshop JSX 再创建每个独立文字层，并读取实际 bounds 进行缩放/平移校准；Windows 使用像素单位和本机字体映射。

## 现有 VLM / 图片模型调用

- VLM 当前承担文字内容、粗略位置、字号/字体类别和背景提示词；这是精度风险来源。
- 图片模型由画布设置选择 dsh-codex 或 API。文字背景清理提示词来自 VLM 的 `erasePrompt`，当前完整原图直接交给图片模型；失败时保留原图。
- OCR 只在 VLM 失败时兜底，但本地 OCR 的几何可以继续复用为检测结果。

## 现有 Mask / Inpaint

`prepare_text_mask.py` 支持字形/区域遮罩和羽化，`composite_edit.py` 支持源图保护。此前矩形 mask 造成明显接缝，当前文字重建路径已按产品要求改为直接采用图片模型完整输出；这些脚本保留给普通图片编辑和后续组件级修复路由。

## 已发现的问题

1. VLM 可能返回 0–1 坐标，旧换算会导致 `0,0、1×1、字号8`；已加入自动尺度检测。
2. VLM 返回的坐标不能作为最终几何真值；应逐步引入 Text Detector/Fusion，使用 detector bbox/polygon。
3. 单个请求发送多个蓝框时，部分模型会合并区域或返回空 JSON；当前前端已按选区顺序串行调用并合并结果，后续应升级为邻近区域 Context Cluster。
4. 字体目前是视觉类别到本机字体的启发式映射，尚未有 Windows 字体扫描、候选渲染和 IoU 拟合。
5. Photoshop 文字层已有一次 bounds 校准，但尚未做多轮 Typography Solver/Validation。
6. Selection、TextObject、VisualComponent、RepairCluster 尚未全部以独立 ID 和状态对象建模。
7. 背景修复尚未有纯色/渐变/CV/生成模型的 Background Router 和残留验收。

## 可复用能力

- 画布原图坐标逆变换、连续多选框 UI、项目持久化和操作日志。
- 当前聊天模型路由和图片引擎路由。
- Tesseract.js/Python OCR 的 bbox 结果。
- `prepare_text_vision_crop.py` 的高清选区和蓝框标注。
- PSD 草稿、原图隐藏层、独立文字层和 Photoshop COM 调度。
- 图片编辑的遮罩尺寸对齐、超时/重试和源图保护工具。

## 增量改造边界

按需求文档的 P0→P1 顺序推进：先统一 `Selection[]`/原图坐标和稳定的 `TextObject` 追踪，再接入检测几何与 VLM 内容融合；随后再增加组件/多层 mask、背景路由、字体匹配、Typography Solver 和自动验收。不会删除现有画布、聊天、PNG、项目和 Adobe 兼容功能。
