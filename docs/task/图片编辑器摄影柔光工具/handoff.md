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
