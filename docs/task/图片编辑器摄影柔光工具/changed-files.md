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
