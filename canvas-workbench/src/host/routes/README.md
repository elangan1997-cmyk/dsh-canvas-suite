# routes/

按领域拆分 41 条路由（清单见 docs/refactor/BASELINE.md §6）：health / project / asset(materials, image, preview, import, rename, restore, archive) / generation(image, edit-image, remove-background, vectorize) / text(ocr-image, export-text-psd) / export / settings(image-settings, image-setup, system-appearance)。

形式：`export function registerXxxRoutes(router, services)`。旧路径必须原样保留（禁止 3）。
