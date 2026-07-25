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
