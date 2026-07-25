# 任务进度

## 第一阶段：技术可行性验证

- 状态：已完成
- 完成日期：2026-07-25
- 已完成任务：1.1 验证工作线程实时预览、1.2 验证原尺寸导出与降级
- 阶段结论：真实 Electron 42 Worker WebGPU、FP16 预览、24MP 分块导出、三格式编码/保存重开和 Sharp 降级均可行，无需 Sidecar。
- 已冻结默认值：预览 2MP、Tile 1536、Halo 64、全局散射最长边 2048、默认 PNG。
- 阶段交接：2.1 收口柔光操作契约
- 当前阻塞：无

## 关键指标

- 参考环境：AMD Ryzen 9 5900X、NVIDIA GeForce RTX 4090、Electron 42.5.0 / Chromium 148。
- 2MP 预览：预热平均 10.13ms、P95 13.2ms、估算 98.7 FPS。
- 24MP WebGPU：PNG 939.8ms、JPEG 557.7ms、WebP 1453.4ms。
- 24MP Sharp：PNG 394.3ms、JPEG 412.2ms、WebP 1053.6ms；RSS 约 632～635MB。
- Tile 拼接：1536 Tile + 64 Halo 的边界采样最大通道误差 0。

## 第二阶段：核心引擎实现

- 状态：已完成
- 完成日期：2026-07-25
- 已完成任务：2.1 收口柔光操作契约、2.2 实现多尺度图形处理引擎、2.3 实现导出取消与降级执行
- 阶段结论：共享六层参数配方、Worker WebGPU 多尺度预览/分块导出、边界取消、设备恢复与 Sharp 明示降级均已落地，无 Sidecar、Raw Pixel IPC 或全尺寸 JavaScript 像素循环。
- 自动验证：4 个定向测试文件共 20 项通过；Renderer/Main ESLint、Electron TypeScript、颜色/i18n 检查和 Electron 构建通过。
- 下一任务：3.1 接入柔光参数面板
- 当前阻塞：无
- 后续统一验收：正式 WGSL Golden、真实 Device Lost、24MP 正式算法性能/内存与三格式重开统一在 4.2 执行。

## 第三阶段：编辑器与宿主接入

- 状态：已完成，待主控提交
- 完成日期：2026-07-25
- 已完成任务：3.1 接入柔光参数面板、3.2 打通标注裁剪与文件保存、3.3 收口多宿主与节点契约
- 阶段结论：共享 `ImageEditDocumentController` 支持任意 V2 操作的创建、事务更新、重置、启停、移除与一次撤销；“辉光/柔光”检查器完整暴露六组专家参数、预览/降级状态及通用预设。
- 合成结论：Worker 在 WebGPU 柔光后通过 OffscreenCanvas 叠加标注并裁剪，严格固定为“朝向 → 柔光/辉光 → 标注 → 裁剪”，最终只调用一次 `convertToBlob()`；无柔光文档继续使用原 Canvas 兼容导出。
- 宿主结论：工具箱、查看器、画布编辑工具与智能助手均流转整份 V2 文档；助手更新可保留既有 `image.diffusion` 与未知操作，旧 `markDoc` 仍只作为标注影子。
- 自动验证：6 个定向测试文件共 27 项通过；定向 ESLint、颜色与模型 i18n 检查、Electron TypeScript 通过。全量 `npx tsc --noEmit` 仅保留既有 `generationModelDescriptions.test.ts:38` 错误。
- 下一任务：4.1 建立通用预设与图像基线；完成后再进入 4.2 统一验收。
- 当前阻塞：无；Sharp 在包含朝向、标注或裁剪的柔光文档上明确报出合成能力不足，绝不静默丢弃操作。

## 第四阶段：标定与统一验收

- 状态：阻塞（待用户真实 Electron 验收）
- 当前完成任务：4.1 建立通用预设与图像基线
- 4.1 结论：黑柔、白柔、辉光各有低/中/高九档无品牌公共参数预设，记录了版本、双语说明、公开方法参考、授权边界与非承诺项；第三阶段 `*-soft` ID 向中等档兼容映射。
- 基线：八张小尺寸程序化 RGBA 测试图、九项 Golden 输入/断言索引、九项质量阈值已经登记；能量守恒阈值已在纯配方层冻结，其余正式 WGSL/Sharp 指标明确标记为待真实 Electron 运行时验证。
- 自动验证：定向 Vitest 3 文件共 16 项通过；Renderer Lint、Electron TypeScript、颜色/i18n 检查通过。
- 4.2 自动验收：8 个定向测试文件共 34 项、Renderer Lint、Electron TypeScript、Electron ESLint、Electron 构建、smoke 与六组 DPI 均通过；全量 `npx tsc --noEmit` 仍仅有既有 `generationModelDescriptions.test.ts:38` 错误。
- 环境：Windows 10 专业版 10.0.19045、AMD Ryzen 9 5900X、63.9 GiB RAM、NVIDIA GeForce RTX 4090、驱动 610.47、Electron 42.5.0。
- 当前阻塞：真实 Electron 正式 WGSL/Sharp 的 Golden、PSF/色彩/边缘/Tile 感知指标、2MP/24MP 性能和内存、Device Lost 故障注入、三格式 Worker 合成重开，以及用户鼠标/画布交互验收尚未执行。不得以 mock 或早期线性原型替代。

### 4.2 纠正工作（2026-07-25）

- 状态：自动纠正完成；第四阶段仍阻塞，未进入新阶段。
- 已完成：将 2MP 预算前移到 Worker 的原生预缩放，避免全尺寸源纹理进入预览 GPU；原图归一化参数和原尺寸导出保持不变。
- 已完成：Sharp 状态改为 API 未启用、adapter 不可用、初始化失败、设备恢复耗尽四种可理解提示；执行层记录 `preview.budget`、`webgpu.unavailable`、`webgpu.recovery.start`、`fallback.sharp.start` 结构化日志。
- 已完成：柔光面板四个选择器改用统一 `Dropdown`，通用控件补齐键盘、焦点、标签和禁用语义；本面板无业务层原生控件。
- 已完成：Electron 在启动前设置独立 Chromium session-data 目录，不删除旧缓存；cache 0x5 仅作为缓存权限诊断，不影响 Worker 对 GPU 能力的独立判断。
- 待用户验证：重启 `npm run electron:dev`，确认新下拉样式/键盘、2MP 大图调参、日志实际降级原因，以及其余 4.2 的 Golden、导出与画布交互清单。

### 4.2 WebGPU 启动纠正（2026-07-25）

- 状态：自动纠正完成；第四阶段仍阻塞，未进入新阶段。
- 已确认的独立问题：先前只隔离 `sessionData`，开发态不同 worktree 仍共享 Electron `userData`，因此仍会竞争 Chromium `GPUCache`；这解释了现场 `cache_util_win.cc:25` 的 0x5 缓存访问拒绝。缓存错误本身不能单独推出 Worker WebGPU 不可用。
- 已完成：开发态 `userData` 按 worktree 的不可逆摘要隔离，打包应用数据不变；随后再创建独立 `ChromiumSessionData`。不会读取、迁移或删除原项目/其他 worktree 的用户数据。
- 已完成：在 `ready` 前显式请求 WebGPU 与高性能 GPU，并记录主进程 GPU 特性状态；若命令行显式禁用 GPU 则尊重该选择并记录原因。
- 已完成：Worker 初始化失败改为可识别阶段码，覆盖 Worker Canvas API、WebGPU API、adapter、设备创建、Canvas 格式、基础 Pipeline、柔光 Pipeline 与未知失败；日志带 requestId、adapter/backend、限制与脱敏详情。
- 自动验证：`npm run lint`、`npx tsc -p tsconfig.electron.json --noEmit`、Electron ESLint 与 2 个定向 Vitest 文件 6 项均通过。
- 待用户验证：完全重启当前 worktree 的 Electron 后，确认不再出现共享缓存 0x5；若仍降级，提供同一 requestId 的 `image_edit.worker.initialize.completed` 中 `initializationFailureCode`/`initializationFailureDetail`，以定位精确阶段。
