# t154：P4-5 主画布随手摆整理

状态：画布侧实现、静态门禁、正式 Electron 截图和指定目录完整回归已验收；助手三候选算法接线需总管理者处理。总管理者负责审查与 Git；本单禁止 Git 写操作，不修改 SDK、共享 creativeIntent 内核或其他任务源码。

## 范围与设计

- 宿主为主画布，多选工具条新增“整理”；三个候选为按边缘对齐、等距排列、网格规整。没有新增白板或演示节点。
- 正式节点与连线由原画布文档实例持有；候选只在 ReactFlow 受控节点投影中替换位置，切换、钉住、取消均不写 store 或磁盘。项目、选区或几何改变使候选失效。
- 每个 parentId 单独在容器局部坐标求解；节点 origin 纳入真实边缘。只改位置，原尺寸、data、连线、extent、父子关系原样保留。锁定使用已有 draggable=false；为防止间接移动锁定后代，以及父子同时整理的二次偏移，含锁定或选中后代的祖先固定。
- 钉住保留原位置。多硬锁冲突或容器装不下时，整份候选不可应用并解释恢复办法；不偷偷放宽、不裁掉目标、不缩放节点。
- 应用委托 applyCanvasNodePropertyPatches；位置补丁整批走现有 onNodesChange，一步撤销。保存失败仍沿画布原恢复通道，保留内存修改，不重放整理。
- 规模基准为 240 个混合尺寸节点，不设产品数量上限。钉点列表使用已安装 react-virtuoso；空闲不计算几何序列化，预览只在节点改变时检查一次，不给每个节点加全图选择器、RAF 或 Worker。

## 选型依据

复用 P1 已选定的 @lume/kiwi 与 src/core/creativeIntent/layout.ts（等式消元 + Cassowary），不引入第二套求解器。比较现有图片布局宿主：图片输入是像素仿射，不能直接借图片文档状态；本单只适配画布容器坐标和约束。网格按列最大宽、行最大高生成锚点后仍交共享求解器验证硬锁；不改 creativeIntent 目录。UI 复用原多选工具条、UiPanel/UiOptionButton/Dropdown，未新增通用组件。仅预览布局求解，不调用模型或付费服务。

## 助手覆盖分级

位置写入属于现有通用实体覆盖核对：canvas.node.position 已有字段声明、权限、执行器、稳定引用和通用事务；界面和助手写入复用 canvasMutationService。新增结果测试证明三节点位置写入、保存读回及一次普通撤销。没有新增专用 Agent 工具。

限制：当前算法候选和临时钉点仅是界面会话状态，未新增可发现的“生成整理候选”算法声明；助手可以经现有实体读写整理位置，但不能直接调用此次三候选求解。若总管理者要求助手直接获取相同候选，需要由持有 core/application-control 注册入口的任务补接正式算法声明；本单不越界修改该目录，也不把覆盖门禁通过当作该路线已通。

## 设计自查

1. **助手只凭名称和说明能否用对？** 既有“节点位置”支持通用读改与结构化回读；本单验证了整批位置应用。三候选算法发现仍需上节登记接线，不能声称已全覆盖。
2. **能否 AI 先做、人只确认？** 界面先由共享本地算法生成候选，人选方案、钉住再确认；无付费生成。AI 直接发起候选的接线边界如上。
3. **产物能否直接流进其他工作区？** 原节点内容、文档和媒体引用不变，沿既有画布节点桥继续流转；位置只是画布布局，不冒充图片或其他媒体产物。

## 验证记录

- 精确布局 5 项通过：真实边缘、混合尺寸、硬锁/钉点、分容器/越界、240 项完整覆盖、不可用目标；首次宿主测试 1 项错误期望已修正。
- 共享写入、反射、工具条直接消费者 4 文件 29 项通过；初轮 TS 控件参数与 afterEach 返回类型已修正。
- 两条 tsc、改动文件 ESLint、check:dependency-graph、check:surface、check:ui-residue、check:colors、check:icons 已通过。
- check:assistant-capabilities 首轮默认并发因内存不足退出；改为按原脚本顺序执行三个组成检查并限制 Vitest 工作者后，结构检查通过、覆盖检查 13 项通过、不变量检查 206 项通过。没有跳过检查项。
- 指定目录回归首次因系统提交内存不足退出；普通 Node 还会被 mcpWriteIntegration 的原生 SQLite ABI 前置条件拒绝。最终轮改用 Electron 的 Node 模式、每文件隔离进程且一次一个工作者，保留三个目录和全部测试，不修改仓库测试配置。
- 最终完整目录回归退出码 0：233 文件、1207 项通过，0 失败（2026-10-11，783.94 秒）。仓库已有 `imageEditSavePerformance.benchmark.test.ts` 的 1 项 4K/8K 性能基准按默认 runIf 条件跳过，需要显式 HENJI_IMAGE_SAVE_BENCH=1；本单没有增加 skip，也未执行无关的重型图片性能基准。本单布局 5 项、服务 3 项、预览 Hook 2 项均包含在最终成功轮次中。
- 正式 Electron 第一轮因过期产物被拒绝；重新生成运行产物后，截图发现整理按钮使用了错误的 i18n namespace，已修正。一次场景选择器误选画布同名标题，改为定位钉点下拉浮层后通过。
- 正式 Electron 场景 `canvas-tidy` 已通过：8 张截图、0 失败，使用隔离临时数据；截图锁已释放。证据：`.reality/t154-ui-pinning/index.md`、`evidence.json`，日志 `.reality/t154-ui-pinning.log`。实际六步为 01 粗摆 → 02 边缘对齐 → 03 网格 → 04 钉住 → 05 应用 → 06 一步撤销；额外保留钉点菜单和最终状态截图。
- 8 张截图均逐张目视检查：混合尺寸卡片顶部对齐，网格行距为浮动标题留空；钉住“构图参考”后该卡片保持原位置；组内锁定卡片始终不动；连线跟随端点且保留原连接；应用关闭面板，一次撤销还原完整粗摆。视口为 zoom=0.64、pan=(120,15)，场景逐步断言预览不写盘、应用保存、结构不变及撤销的 DOM 坐标与落盘坐标恢复一致。
- 截图后钉点名称统一复用既有 resolveNodeDisplayName，补齐未自定义名称节点的类型名称；该文字回退调整 ESLint 与最终渲染层 tsc 均通过（`t154-eslint-name.log`、`t154-tsc-delivery.log`），不改变已验收场景的节点名称、布局或交互。没有为此重复构建和截图。
- 本单运行构建计划的原有 electron-vite 最后一步，使用原构建锁；没有运行 SDK 生成步骤，没有启动开发实例。构建与完整目录回归串行，避免同时占用内存。
- 首次工具进程曾因系统提交内存不足报 Windows 1455；未关闭用户程序。类型检查曾发现并行图片测试缺 baseDigest 及 Promise 类型错误，未修改他人文件。

运行证据保存在忽略目录 `.reality/`，不属于待提交文件：`t154-tsc-final.log`、`t154-tsc-electron.log`、`t154-eslint-accepted.log`（全部本单源码）、`t154-eslint-last.log`（最后翻译与场景调整）、`t154-dependencies.log`、`t154-surface.log`、`t154-residue.log`、`t154-colors.log`、`t154-icons.log`、`t154-check-assistant-capabilities-structure.log`、`t154-check-application-control-coverage.log`、`t154-check-application-control-invariants.log`。最终完整回归日志为 `t154-suite-electron.log`。

完整目录回归的实际入口：Electron 可执行文件在 `ELECTRON_RUN_AS_NODE=1` 下执行 `node_modules/vitest/vitest.mjs run src/features/canvas src/features/application-control src/tests --silent --pool=forks --maxWorkers=1 --minWorkers=1 --poolOptions.threads.maxThreads=2 --poolOptions.threads.minThreads=1`，每文件隔离且限制堆为 1536 MB。没有跳过原生集成、没有将不兼容的 SQLite 测试改为假实现。

## 文件范围

- src/features/canvas/application/canvasTidyLayout.ts：容器坐标、几何、候选约束适配。
- src/features/canvas/application/canvasTidyLayout.test.ts：几何、锁、容器和规模测试。
- src/features/canvas/application/canvasTidyService.ts：只读草稿、过期检查和正式应用。
- src/features/canvas/application/canvasTidyService.test.ts：保存、撤销、通用实体写入回归。
- src/features/canvas/application/canvasMutationService.ts：整批位置补丁共享历史入口。
- src/features/canvas/hooks/useCanvasTidy.ts：候选生命周期与无持久化预览。
- src/features/canvas/hooks/useCanvasTidy.test.tsx：只读投影、取消与失效回归。
- src/features/canvas/ui/CanvasTidyPanel.tsx：候选、虚拟钉点列表与应用取消。
- src/features/canvas/ui/MultiNodeActionToolbar.tsx：多选整理按钮。
- src/features/canvas/ui/SelectedNodeOverlay.tsx：入口回调接线。
- src/features/canvas/Canvas.tsx：正式画布预览和面板挂载。
- src/i18n/locales/zh-CN/ui.json、src/i18n/locales/en-US/ui.json：只追加 canvasTidy 文案。
- scripts/lib/uiInspectionSceneCanvasTidy.cjs：正式画布六步截图和持久化断言。
- scripts/lib/uiInspectionScenes.cjs：只追加本单场景一行。
- docs/task/超级关键帧/任务/P4-5-canvas-tidy.md：本任务记录。
- docs/task/超级关键帧/02-实施拆分.md：只追加 P4-5 本单状态。
