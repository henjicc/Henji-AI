# 画布模块

> 读取时机：改动 `src/features/canvas/**`、新增/改造画布节点、调节点 DOM 或绘制样式、排查画布卡顿。
>
> 与 skill `canvas-node-builder` 的分工：**skill 是新建节点的操作步骤与示例代码**；本文件是模块拆分约定、节点组成硬约束和平移渲染的实测结论。

## 模块拆分

- `src/features/canvas/Canvas.tsx` 只保留编排与接线，不承载复杂业务实现
- 画布行为优先放入 hooks：`hooks/useCanvasDuplication.ts`（复制/拖拽）、`hooks/useCanvasNodeMenu.ts`（节点菜单与连接交互）、`hooks/useCanvasShortcuts.ts`（快捷键）
- 画布 UI 叠层与展示抽离到 `src/features/canvas/ui/`（如 `CanvasOverlays.tsx`）
- 通用计算与连接预览逻辑放 `src/features/canvas/canvasUtils.ts`
- 新画布能力必须落在 `src/features/canvas/`

## 节点组成

新建/改造节点时从标准化的"参数行组件"拼装，不要从零写 UI。

标准行组件（`src/features/canvas/params/`）：

- `ModelInputRow` — 模型选择行
- `MediaInputRow` — 媒体输入行（图片/视频/音频；含本地上传、缩略图、拖拽排序、上游连线只读态）
- `NodeParamRows` — 标量参数逐行渲染（每参数一行，按 schema 自动生成，连线可覆盖）
- `NodeInputRows` — 上述三者的编排容器（模型行 → 媒体行 → 参数行）；价格徽标统一走 `NodeHeader` 的 `rightSlot`

规则：

- **通用生成节点**直接复用 `src/features/canvas/nodes/shared/GenerationNodeShell.tsx`（AI 图片/视频/音频节点都是如此），无需单独写节点组件；行为差异全部由 `domain/nodeRegistry.ts` 中的 `CanvasNodeDefinition` 声明驱动（该文件顶部有"新增画布节点 SOP"注释）
- **特殊节点**（如分镜生成的格子编辑器）在标准行组件基础上**叠加**专属面板，不是推倒重写；面板放节点同名子目录（如 `nodes/storyboardGen/`），节点主文件负责编排接线，不在面板里重复实现模型选择/参数行
- **媒体输入端口**：声明 `connectivity.targetHandleMode: 'rows'` + `ports.target.accepts` 后，媒体输入按类型生成专属端口并配 `MediaInputRow`；**禁止**手写单一 `id="target"` 的 Handle 来接收媒体
- **禁止**在新节点里重新实现模型选择 chip、媒体上传缩略图、逐行参数布局
- **复杂参数组不在节点内展开**：schema 的 `panel` / `composite` 统一渲染为单行摘要触发器，点击后在节点布局流之外打开浮动特殊面板；开关面板不得改变节点测量高度。只有已经连接到上游、需要持续展示连线状态的组内参数，才以紧凑参数行留在节点内。
- **端口保持轻量且按需显现**：端口颜色只能取登记的语义媒体/数据类型 token，视觉核心统一使用共享小尺寸与轻描边（当前为 8 CSS px），透明命中区至少 24 CSS px；禁止在节点调用点自造尺寸或颜色。未连接端口在空闲状态必须隐藏，只在对应行/节点悬浮或正在连线时短暂显现；已连接端口保持可见。新增或改动端口后，用 `check:canvas-visual` 与真实 Electron 截图同时检查空闲未连接、交互显现、已连接和缩放状态。

## 平移渲染性能（实测结论，不要重新推演）

真实瓶颈是高节点量下可见节点内容的逐帧绘制记录，**不是** JS、图片解码或连线动画。

**性能结论只能用 `npm run electron:pan-bench`**（真实内容连续单向扫掠、同启动交替采样）。`electron:canvas-stress` 的占位 fixture 与中心 ±30px 往返只承担功能/内存冒烟，**不能作为平移性能依据**。

三条禁令：

1. **禁止**给画布视口或节点添加 `will-change: transform`。非 1 倍画布缩放下它会钉死合成层光栅倍率并使文字发虚；位移吸附到整设备像素后仍有 1.68% 像素差，已排除分数像素解释。
2. **禁止**给节点内容添加 `content-visibility: auto`。本项目节点 DOM 嵌套较深，124 节点实测降至 8.4fps、p95 1197ms，是明确负优化。
3. `translate: 0 0 0` 的计算值会折叠为 `0px`，是空操作，**不能**用于"提升合成层"；非零 3D translate 会改变层叠上下文，也不得作为替代方案。

当前统一通过 `CanvasNodePaintFrame` 与 `.react-flow__node` 的 `contain: paint` + `overflow-clip-margin` 做两级绘制隔离。

新增/改造节点 DOM、浮动标题、端口或 resize 装饰时，必须用 `npm run check:canvas-visual` 复核实际可绘制溢出、节点盒、minimap 与连线几何；**禁止用 padding / margin 改变 `.react-flow__node` 的测量尺寸**。
