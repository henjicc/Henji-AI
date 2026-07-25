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

## D005：共享配方与纯参数解析

- `compileDiffusionRecipe()` 是 WebGPU 预览、WebGPU 导出、Sharp 降级和未来节点唯一的参数编译入口。
- 六层半径保持图片空间归一化；Tile 只在执行时重基准，公共文档不写 `radiusPixels`。
- 柔光参数解析拆为不依赖标注颜色/Renderer 别名的纯核心模块，原 `operations.ts` 入口继续抛出兼容错误类型。

## D006：多尺度缓存与原尺寸导出

- Source、Pyramid、Composite 使用独立签名失效；色调/细节调整只重做最终合成。
- 六层按 1/2/4/8/16/32 降采样，远距层不保留六组全尺寸 FP16。
- 导出先渲染最长边 2048 的全局结果，再按 1536 Tile + 64 Halo 渲染近距结果，以近三层归一化权重进行能量守恒交叉混合，最终只编码一次。

## D007：统一执行器与降级语义

- 正式后端只使用 `webgpu-worker`、`sharp`、`browser-canvas`。
- WebGPU 在 Pass/Tile 边界硬取消，Device Lost 最多自动恢复两次；耗尽后才降级 Sharp。
- Sharp 返回 `unsupportedParameters` 与 `hardCancellationSupported: false`，Abort 只能丢弃返回结果，不伪装成处理中硬取消。
- 第二阶段不越界实现标注/裁剪合成；遇到非中性组合明确拒绝静默跳过，交由 3.2 收口。

## D014：编辑器文档事务与 Inspector 边界

- `useImageEditorSession()` 新增通用 `ImageEditDocumentController`，由 Context 提供给所有 Inspector；Inspector 只变更 V2 文档，不直接访问 Worker、PAL 或 IPC。
- 连续滑块更新先实时写入当前文档，Pointer/Focus 事务在完成时仅压入一条历史快照；取消时回滚事务基线。
- 通用黑柔、白柔、辉光预设与应用逻辑放在核心 `diffusionPresets.ts`，UI 不维护第二套默认值、半径换算或参数校验。

## D015：柔光合成、保存与降级收口

- Worker 请求携带可判别的合成描述；原图解码后先在 OffscreenCanvas 应用朝向，WebGPU 柔光完成后在同一导出 Canvas 光栅化标注并裁剪，最后一次编码。
- 标注渲染改为 DOM/OffscreenCanvas 共用的最小适配层；字体、阴影与 `filter` 仍需在真实 Electron 的 4.2 人工验收中确认。
- WebGPU 不可用且文档包含朝向、标注或裁剪时，Sharp 明确拒绝该合成而不忽略任何操作；纯柔光仍可进入 Sharp 兼容路径。
- 柔光编码字节由 `persistImageBinary()` 命令经 PAL 保存，宿主只调用统一 `exportImageEditDocument()` 兼容入口。
