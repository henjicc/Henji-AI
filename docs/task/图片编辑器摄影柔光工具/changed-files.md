# 第一阶段修改文件

## Worker WebGPU

- `src/core/imageEdit/worker/protocol.ts`：强类型请求/事件协议。
- `src/core/imageEdit/worker/imageEditWorker.ts`：Worker 调度、revision、进度、取消和错误。
- `src/core/imageEdit/worker/webgpuRuntime.ts`：设备、FP16 Pass、预览与分块导出。
- `src/core/imageEdit/worker/webgpuRuntimeSupport.ts`：WebGPU 结构类型与底层资源辅助。
- `src/core/imageEdit/worker/webgpuCapabilities.ts`：稳定采集相关设备限制。
- `src/core/imageEdit/worker/exportPrototype.ts`：预览预算、Tile/Halo 和全局图计划。
- `src/core/imageEdit/worker/baseline.wgsl`：线性化与 sRGB 回编码基线。
- `src/core/imageEdit/webgpu.ts`：扩展 FP16、fallback adapter 和限制探针。
- `src/core/imageEdit/index.ts`：导出 Worker 公共契约。

## Renderer 客户端

- `src/features/imageEdit/execution/workerImageEditClient.ts`：Worker 客户端、最新 revision 和 ImageBitmap 生命周期。
- `src/features/imageEdit/index.ts`：导出 Worker 客户端。

## Sharp 降级

- `electron/main/services/image/diffusion-fallback.ts`：明确能力边界的 Sharp 降级原型与结构化日志。

## 测试

- `src/core/imageEdit/worker/exportPrototype.test.ts`
- `src/features/imageEdit/execution/workerImageEditClient.test.ts`
- `electron/main/services/image/diffusion-fallback.test.ts`
- `electron/main/services/image/diffusion-fallback.benchmark.test.ts`

## 任务记录

- `00-任务总览.md`、`01-实施方案.md`、`重要记录.md`
- `任务/第一阶段-技术可行性验证/1.1-验证工作线程实时预览.md`
- `任务/第一阶段-技术可行性验证/1.2-验证原尺寸导出与降级.md`
- `progress.md`、`decisions.md`、`handoff.md`、`changed-files.md`、`test-report.md`

临时 Electron 诊断入口和构建产物已删除，未保留截图、日志或安装包。

# 第二阶段修改文件

## 公共契约与配方

- `src/core/imageEdit/diffusionParams.ts`：纯柔光默认值、严格解析和非空判断。
- `src/core/imageEdit/diffusionRecipe.ts`：六层归一化配方、模式响应、能量、色调与细节编译。
- `src/core/imageEdit/execution.ts`：可判别预览/编码结果、正式后端、诊断、进度、取消和能力。
- `src/core/imageEdit/operations.ts`、`documentCodec.ts`、`index.ts`：兼容导出、重复内置操作校验和公共入口。
- `src/core/imageEdit/worker/protocol.ts`：配方、revision、质量、进度、取消和降级能力消息。

## Worker WebGPU

- `src/core/imageEdit/webgpu/deviceManager.ts`：设备生命周期、丢失通知和异步 Pipeline 校验。
- `src/core/imageEdit/webgpu/texturePool.ts`：按描述符复用纹理并执行预算回收。
- `src/core/imageEdit/webgpu/diffusionRenderer.ts`：Source/Pyramid/Composite 多 Pass、六层缓存失效与资源释放。
- `src/core/imageEdit/webgpu/exportRenderer.ts`：2048 全局散射、1536/64 Tile、重基准、交叉混合和一次编码。
- `src/core/imageEdit/shaders/diffusion.wgsl`、`shaders.ts`：正式线性光多尺度 WGSL 与版本。
- `src/core/imageEdit/worker/webgpuRuntime.ts`、`webgpuRuntimeSupport.ts`、`imageEditWorker.ts`：正式渲染、分块导出、边界取消和设备恢复接线。

## 统一执行与 Sharp 降级

- `src/features/imageEdit/execution/imageEditExecution.ts`：统一后端选择、两次恢复、Sharp 降级、诊断和日志。
- `src/features/imageEdit/execution/workerImageEditClient.ts`、`browserImageEditExecution.ts`、`src/features/imageEdit/index.ts`：显式 requestId、共享配方和旧导出兼容。
- `electron/main/services/image/diffusion-fallback.ts`：公共配方到 Sharp 子集映射、能力限制和结构化日志。
- `src/platform/contracts/image.ts`、`src/platform/adapters/electron/image.ts`：Sharp 降级 PAL。
- `electron/preload/index.ts`、`electron/preload/api.d.ts`、`electron/main/ipc/image.ts`：最小白名单和严格解析。

## 测试与任务记录

- `src/core/imageEdit/imageEdit.test.ts`、`worker/exportPrototype.test.ts`：配方、模式、缓存失效、Tile 重基准和兼容契约。
- `electron/main/services/image/diffusion-fallback.test.ts`：共享配方降级及明示能力限制。
- `docs/task/图片编辑器摄影柔光工具/` 下总览、第二阶段任务、进度、决策、交接、变更和测试记录。

# 第三阶段修改文件

## 编辑器与参数面板

- `src/features/imageEdit/editor/ImageEditorDocumentContext.ts`、`ImageEditorDocumentProvider.tsx`、`useImageEditorSession.ts`、`ImageEditor.tsx`：通用 V2 文档控制器、一次事务历史、实时预览状态与预览底图坐标适配。
- `src/features/imageEdit/tools/diffusion/DiffusionInspector.tsx`、`diffusionUiMapping.ts`、`tools/registry.ts`：辉光/柔光工具注册、六组专家参数、预设、启停、重置、移除与状态提示。
- `src/core/imageEdit/diffusionPresets.ts`、`src/core/imageEdit/index.ts`：核心通用预设定义与公共导出。
- `src/i18n/locales/zh-CN/ui.json`、`src/i18n/locales/en-US/ui.json`：柔光 Inspector 中英文文案。

## 合成、执行与保存

- `src/features/imageMark/render/canvasAdapter.ts`、`orientedImage.ts`、`drawMarks.ts`：DOM/OffscreenCanvas 共用朝向、马赛克、局部模糊和标注光栅化。
- `src/core/imageEdit/worker/protocol.ts`、`worker/imageEditWorker.ts`、`worker/webgpuRuntime.ts`、`webgpu/exportRenderer.ts`：Worker 合成描述、朝向输入、标注裁剪后处理和一次最终编码。
- `src/features/imageEdit/execution/imageEditExecution.ts`、`workerImageEditClient.ts`、`browserImageEditExecution.ts`：统一合成请求、Sharp 明示能力限制与编码字节命令保存。
- `src/features/imageMark/editor/MarkEditor.tsx`：低分辨率柔光预览按原图逻辑坐标呈现，避免标注与裁剪重复朝向。

## 宿主与测试

- `src/features/assistant/imageEditAdapter.ts`、`hostActions.ts`：助手更新 V2 文档时保留柔光及未知操作。
- `src/features/imageEdit/editor/useImageEditorSession.test.tsx`、`src/features/assistant/imageEditAdapter.test.ts`：事务撤销与助手保留操作回归测试。
- `docs/task/图片编辑器摄影柔光工具/` 下总览、第三阶段任务、进度、决策、交接、变更和测试记录。

# 第四阶段 4.1 修改文件

## 预设与 Inspector

- `src/core/imageEdit/diffusionPresets.ts`：九档通用预设、来源/授权/适用范围元数据、公开参数映射与旧 ID 兼容读取。
- `src/features/imageEdit/tools/diffusion/DiffusionInspector.tsx`：按核心元数据展示预设及多语言说明，不再按预设 ID 写 UI 分支。
- `src/i18n/locales/zh-CN/ui.json`、`src/i18n/locales/en-US/ui.json`：预设选择与无品牌方法参考提示。

## 质量基线与测试

- `src/core/imageEdit/testing/diffusionCharts.ts`：八张程序化质量测试图。
- `src/core/imageEdit/testing/diffusionBaseline.ts`：Golden 索引、数值/感知阈值和校验函数。
- `src/core/imageEdit/testing/diffusionCharts.test.ts`、`diffusionBaseline.test.ts`：测试图覆盖、预设追溯、模式差异和 Golden/阈值登记测试。

## 任务记录

- `docs/task/图片编辑器摄影柔光工具/` 下总览、4.1/4.2 任务、重要记录、进度、决策、交接、变更和测试记录。

# 第四阶段 4.2 修改文件

## 统一验收记录

- `docs/task/图片编辑器摄影柔光工具/00-任务总览.md`、`任务/第四阶段-标定与统一验收/4.2-完成统一测试与验收.md`：自动验收结果、阻塞状态、环境与未验证项。
- `progress.md`、`decisions.md`、`handoff.md`、`changed-files.md`、`test-report.md`、`重要记录.md`：测试结果、既有全量 TypeScript 基线、用户交接步骤和最终阻塞原因。

本任务未新增运行时代码；构建自动生成的 `resources/model-manifest.json` 与 `resources/progress-seeds.json` 均为既有 Git 忽略产物，未纳入改动。

# 第四阶段 4.2 纠正修改文件

## 预览与降级执行

- `src/core/imageEdit/execution.ts`：收紧可观测 WebGPU 降级原因类型。
- `src/core/imageEdit/worker/webgpuRuntime.ts`：预览先以原生 ImageBitmap 预缩放到像素预算，再进入朝向/WebGPU 渲染；导出路径不变。
- `src/features/imageEdit/execution/imageEditExecution.ts`：区分 WebGPU API、adapter、初始化和恢复耗尽；记录预览预算、恢复和 Sharp 降级结构化日志。
- `src/features/imageEdit/execution/workerImageEditClient.ts`：初始化能力日志补充 backend、fallback adapter 与失败原因。
- `src/features/imageEdit/editor/ImageEditor.tsx`、`ImageEditorDocumentContext.ts`：把稳定降级原因传给 Inspector，而不硬编码 Sharp 状态。

## 统一 UI 与 Electron 启动

- `src/components/ui/Dropdown.tsx`：现有通用 Dropdown 增加标签关联、ARIA、键盘导航和焦点状态。
- `src/features/imageEdit/tools/diffusion/DiffusionInspector.tsx`：模式、预设、档位、质量改用统一 Dropdown；补齐折叠区、状态与禁用语义。
- `src/i18n/locales/zh-CN/ui.json`、`src/i18n/locales/en-US/ui.json`：增加四类降级提示文案。
- `electron/main/chromium-session-data.ts`、`electron/main/index.ts`：在 `ready` 前配置并验证独立 Chromium session-data 目录，不删除旧缓存。

## 测试与任务记录

- `src/components/ui/Dropdown.test.ts`：覆盖自定义下拉的键盘打开、选择与 ARIA 状态。
- `src/features/imageEdit/execution/imageEditExecution.test.ts`：覆盖四类 WebGPU 降级诊断分类。
- `src/features/imageEdit/execution/workerImageEditClient.test.ts`：覆盖 Worker 初始化失败原因的传递。
- `docs/task/图片编辑器摄影柔光工具/` 下 `4.2`、`progress.md`、`decisions.md`、`handoff.md`、`changed-files.md`、`test-report.md`：纠正计划、验证结果和手动验收交接。

## 4.2 WebGPU 启动纠正

- `electron/main/chromium-session-data.ts`：开发态按 worktree 摘要隔离 `userData`，再配置独立 Chromium session-data；不会接触其他 worktree/原项目数据。
- `electron/main/webgpu-runtime.ts`、`electron/main/index.ts`：在 `ready` 前配置 WebGPU/高性能 GPU 启动开关，并在 GPU 信息可用后记录安全的主进程特性状态。
- `src/core/imageEdit/worker/protocol.ts`、`webgpuRuntimeSupport.ts`、`webgpuRuntime.ts`：将 Worker 初始化失败拆分为安全阶段码与脱敏详情。
- `src/features/imageEdit/execution/workerImageEditClient.ts`、`imageEditExecution.ts`：以 requestId 记录 Worker 失败阶段、adapter/backend 与限制，并保持现有稳定降级提示。
- `src/features/imageEdit/execution/imageEditExecution.test.ts`、`workerImageEditClient.test.ts`：覆盖初始化失败阶段码的稳定降级分类与协议传递。
