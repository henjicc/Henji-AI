# 决策记录

## D001：Worker 协议与资源归属

- 使用可判别联合类型覆盖初始化、预览、导出、进度、取消、Device Lost、错误和销毁。
- Renderer 只采纳最新 revision；过期和被替换的 `ImageBitmap` 由客户端显式关闭。
- URL 图片在 Worker 中按 URL 缓存已解码源，Blob 为单次任务资源。

## D002：WebGPU 资源约束

- 外部图片目标纹理必须带 `COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT`。
- 临时 Buffer/Texture 在 `queue.onSubmittedWorkDone()` 后才允许销毁。
- Pipeline 和关键 Pass 使用 validation error scope，避免校验错误静默产出透明图。

## D003：首版尺寸与格式

- 预览像素上限：2,000,000。
- Tile：1536；Halo：64；全局散射最长边：2048。
- 默认输出 PNG；JPEG/WebP 为显式选择，有损质量仍待产品确认。
- 选择 1536 而非实测略快的 2048，是为了在 Tile 调用次数和后续多 Pass 瞬时资源之间保留余量。

## D004：Sharp 降级边界

- Sharp 只支持 `mode`、`strength`、`radiusPixels`；其他参数返回 `unsupported-parameters`，不静默忽略。
- 预览默认不超过 1MP；导出允许原尺寸。
- Sharp 不支持处理中硬取消，只允许排队取消、超时和过期结果丢弃。
