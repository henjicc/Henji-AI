# 阶段交接

## 交给第二阶段 2.1

- 第一阶段已通过，可进入“收口柔光操作契约”。
- 复用 `src/core/imageEdit/worker/protocol.ts` 的消息语义；2.1 可统一旧 `native-*` 后端命名，但不要重新定义第二套 Worker 协议。
- 公共契约应表达 WebGPU 主执行、Sharp 兼容降级、可识别的不支持参数和可取消边界。
- 继续保持 V2 文档和稳定操作 ID `image.diffusion`，不要把本阶段原型的 `radiusPixels` 直接写入正式文档；正式参数仍使用图片空间归一化半径。

## 交给第二阶段 2.2/2.3

- 正式多尺度引擎默认：预览 2MP、Tile 1536、Halo 64、全局散射 2048。
- 必须保留 URL 源缓存、validation error scope、GPU 提交完成后释放资源、最新 revision 和 ImageBitmap 关闭逻辑。
- 当前导出原型只保留一张全尺寸 FP16 中间纹理；2.2 不得扩展为六组全尺寸 FP16。
- 当前 Tile 边界误差 0 只覆盖线性化/回编码基线；加入真实模糊后必须重新验证 Halo、能量和视觉接缝。
- Device Lost 的事件和下次请求重建路径已实现，但真实强制丢失未自动触发；4.2 需补充故障注入或人工验收。

## 已知非阻塞项

- `GPUAdapter.isFallbackAdapter` 在当前 Chromium 返回不可用，记录为 `null`；可结合 adapter vendor/architecture 展示硬件信息。
- 浏览器没有可移植的 GPU 显存峰值读取 API；当前仅记录 Renderer JS Heap 与明确的资源上界。
- 全量 `npx tsc --noEmit` 仍有既有 `generationModelDescriptions.test.ts` 类型错误，与本阶段无关。

## 交给第三阶段 3.1

- 第二阶段已通过，可直接使用稳定操作 ID `image.diffusion`、`createDefaultDiffusionOperationParams()` 和严格解析器构建参数面板。
- UI 只编辑 V2 文档中的归一化参数，不得生成 `radiusPixels`、GPU Pass 或 Sharp 专用参数。
- 预览调用 `imageEditExecutionPort.execute({ purpose: 'preview', revision, ... })`，只采纳最新 revision，并在替换时关闭旧 `ImageBitmap`。
- 参数拖动应按依赖缓存设计分组：源图参数触发 Source，半径/方向触发 Pyramid，色调/细节只触发 Composite；历史仍按一次事务记录。

## 交给第三阶段 3.2/3.3

- `exportImageEditDocument()` 保留旧字符串签名；纯柔光文档已内部走统一端口并经 PAL 保存编码字节。
- 第二阶段故意未实现朝向/标注/裁剪 Worker 合成；统一执行器检测到非中性组合会明确报错，3.2 必须完成固定顺序合成后再解除限制。
- Sharp 能力限制和不可硬取消状态必须在 UI 如实呈现；不要显示虚假的“已硬取消”。
- 多宿主只依赖图片编辑执行端口和旧兼容包装，禁止直接调用 Worker、preload 或 IPC。

## 交给第四阶段 4.1/4.2

- 必须对正式多尺度 WGSL 重新执行点光源、阶梯、色块、透明边缘、Tile 接缝和三模式 Golden；第一阶段边界误差 0 仅是线性基线。
- 必须重新测 2MP 参数延迟、24MP 三格式耗时/内存/重开、取消边界与设备恢复故障注入。
- 当前自动验证未运行真实正式算法 GPU 画面；Electron 构建通过只证明 bundle/类型链路，不可替代 4.2 视觉与性能结论。

## 交给第四阶段 4.1

- 通用预设当前已具备稳定 ID：`black-mist-soft`、`white-mist-soft`、`glow-soft`；4.1 应以可追溯图像基线校准参数，必要时只修改核心 `diffusionPresets.ts`，不要在 Inspector 写参数分支。
- 预设名只使用“通用黑柔/白柔/辉光”，不得改成品牌或精确档位宣传。

## 交给第四阶段 4.2

- 重点验证真实 Electron 中 Worker 的合成顺序：旋转/镜像后柔光，随后矩形、箭头、文字、马赛克、局部模糊与裁剪；确认最终仅一次编码及 PNG/JPEG/WebP 重开。
- 必须人工操作柔光 Inspector：拖动任意滑块后仅产生一条撤销记录，撤销/重做恢复整份 V2 文档；切换面板、预设、启用、重置和移除操作均不应影响顶部标注工具栏。
- 预览以 2MP 帧作为底图并放大到原图坐标空间，需检查极大图下标注命中、裁剪框和马赛克坐标没有漂移；如有问题优先修正坐标适配，不能提升 Worker 预览预算规避。
- Sharp 组合文档现在会显示明确失败；若产品要求完整无 GPU 合成，后续必须实现等价兼容合成，不能把该错误改为静默降级。
- 未来独立画布节点只复用 `image.diffusion`、`compileDiffusionRecipe()`、默认值/解析器和 `imageEditExecutionPort`；本期未创建节点 UI 或修改节点注册表。

## 4.1 完成后交给第四阶段 4.2

- 以 `src/core/imageEdit/testing/diffusionCharts.ts` 的八张程序化输入和 `diffusionBaseline.ts` 的 `DIFFUSION_GOLDEN_INDEX` 运行正式 WebGPU 预览/导出与 Sharp 对比；九个预设必须都覆盖，不得替换为来源不明的照片。
- `DIFFUSION_QUALITY_THRESHOLDS` 中只有 `recipe-energy-conservation` 已冻结验证；其余项目均为 `pending-electron-runtime`，4.2 需记录真实计算结果或明确失败，不能仅执行配置单元测试就宣称质量通过。
- 新预设 ID 为 `black-mist|white-mist|glow` 的 `low|medium|high` 组合；历史 `*-soft` 会兼容解析为中档。Inspector 仅展示核心元数据，不包含预设 ID 的算法分支。
- 继续执行既有真实 Electron 性能、三格式重开、取消/Device Lost、合成顺序、多宿主和用户鼠标交互清单；人工操作结果未由 4.1 执行。

## 4.2 自动验收后交给用户/主控

- 已通过：8 个定向 Vitest 文件 34 项、Renderer Lint、Electron TypeScript、Electron ESLint、`electron:build`、`electron:smoke`（无 page/console error）和六组 DPI（无横向溢出）。
- 用户需在真实 `npm run electron:dev` 中依次打开工具箱、查看器、画布图片编辑器：切换九档预设和三种模式；拖动每个分组一个滑块后验证只产生一条撤销记录；验证折叠/宽度、预览无旧帧闪回、重做、启用、重置与移除。
- 用户需对含旋转/镜像、文字、箭头、像素/模糊马赛克及裁剪的图导出 PNG/JPEG/WebP，检查“朝向 → 柔光 → 标注 → 裁剪”、透明边缘、重新打开及画布应用后的节点图片；再验证禁用 WebGPU 时纯柔光降级、组合文档明确失败且原文档保留。
- 还需采集正式 WebGPU/Sharp 的八张程序化图 Golden、2MP 预热 P95、24MP 三格式耗时/内存/重开、Tile 接缝、Device Lost 与取消边界。现有 4.1 的 `pending-electron-runtime` 阈值在取得实测前不可勾选。
- 用户提交结果前，第四阶段处于阻塞状态；全量 TypeScript 的既有 `generationModelDescriptions.test.ts:38` 不属于柔光阻塞，但也未在本任务修复。

## 4.2 纠正后交给用户/主控

- 必须先完全退出当前 Electron 开发进程，再在包含本次改动的工作树运行 `npm run electron:dev`。`ChromiumSessionData` 在主进程启动前配置，不重启不会生效；不要手动删除任何 Cache 目录。
- 本次检查时发现仍有 Electron 进程从 `D:\VibeCode\Henji-AI` 启动；未主动终止。若现场窗口来自该目录，必须先将本次改动合入/切换到该工作树再重启，否则不会加载本次修复。
- 打开柔光 Inspector：四个下拉应为应用自定义面板，而非系统原生 `select`。用 Tab 聚焦后验证 ArrowUp/ArrowDown、Home/End、Enter/Space、Escape；禁用效果时控件不可操作，重新启用后可恢复。
- 使用至少 6000×4000 图片连续调节强度和散射参数：预览应保持约 2MP，并且日志应出现 `image_edit.execution.preview.budget`（6000×4000 对应 1732×1154）；导出后仍应为原始 6000×4000 尺寸。
- 如再次看到 Sharp 状态，读取日志窗口中同一 `requestId` 的 `image_edit.worker.initialize.completed` 与 `image_edit.execution.webgpu.unavailable`：前者的 `reason` 才是实际原因。cache 0x5 不能单独作为“显卡/GPU 不可用”的结论。
- 若看到 `webgpu-device-recovery-exhausted`，等待下一次预览以触发 Worker 重建；若持续复现，保留日志事件的原因码、adapterName、backend 和发生时间给主控。Sharp 预览是近似效果；含朝向、标注或裁剪的文档仍会明确拒绝 Sharp 合成，不得通过静默降级绕过。
- 继续完成既有 4.2 Golden、24MP、三格式重开、Device Lost 和所有鼠标/画布验收；本次纠正不替代这些未完成项。

## 4.2 WebGPU 启动纠正后交给用户/主控

- 请先完全退出当前 `npm run electron:dev`，再从本 worktree 重启。开发态现在使用 worktree 专属的 Electron `userData` 和 `ChromiumSessionData`；这不会读取、修改或迁移原项目及其他 worktree 的数据，也不要求手动删除 Cache。
- 现场的 0x5 是 GPU/网络缓存目录被拒绝访问；此前仅隔离 `sessionData`，没有消除开发 worktree 共享 `userData` 的竞争。新实例应不再复用该共享缓存。它是已修复的缓存根因，但不能据此假定 WebGPU 一定可用。
- 若仍出现 Sharp，日志窗口以同一 `requestId` 查询 `image_edit.worker.initialize.completed`：`initializationFailureCode` 会精确指向 `webgpu-api-unavailable`、`webgpu-adapter-unavailable`、`webgpu-device-request-failed`、`webgpu-canvas-format-unavailable`、`webgpu-baseline-pipeline-failed` 或 `webgpu-diffusion-pipeline-failed`；`initializationFailureDetail` 是不含路径的截断诊断。主进程同时会记录 `webgpu.gpu_info.completed`。
- 不要从截图、缓存日志或显卡型号推断成功；只有 Worker 返回 `available: true`、adapter/backend 与限制并实际完成一次预览，才能确认 WebGPU 路径恢复。仍需继续完成既有 Golden、性能、格式和鼠标/画布验收。
