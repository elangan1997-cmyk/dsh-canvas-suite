# host/

Host 半边：文件系统、Python、子进程、模型调用、Provider、项目持久化。

目标：`host/index.js` 只做「取 DSH ctx → 初始化 Service/Registry → 注册 Router → 安装 Chat Router → dispose」，200-400 行（§11）。

当前来源：`lib/index.js` 单个 `apply(ctx)` 函数（429-2256 行，41 条 `/dsh-canvas/*` 路由全部内联）。
