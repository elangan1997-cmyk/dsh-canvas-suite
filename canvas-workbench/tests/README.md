# canvas-workbench/tests/

`unit/`（path normalize、migration、asset schema、job 状态机、provider registry、text block normalize、font resolver、image metadata）
`integration/`（project open/save、asset import、生成 mock、文字识别 mock、python tool、job 生命周期）
`migration/`（旧项目 schemaVersion 升级）
`smoke/`（对应 docs/refactor/REGRESSION-v1.7.0.md 的可自动化子集）

仓库根目录现有 `tests/check-portability.mjs` 继续作为静态门禁保留。
