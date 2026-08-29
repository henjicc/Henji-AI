---
name: canvas-node-builder
description: Henji-AI 画布（ReactFlow）新增/改造节点时使用。指导如何选择普通生成节点、节点内工具工作台、标准行拼装或纯展示节点，如何声明 CanvasNodeDefinition，以及如何让遮罩、打光、镜头等特殊交互各自不同但保持统一骨架。普通模型 schema 会被标准生成节点自动读取；只改供应商、模型参数、显隐、计价或请求构建时不使用本 skill。
---

# Canvas Node Builder

## 这套体系是什么

Henji-AI 画布节点不是各写各的 UI，而是从一组标准化"参数行组件"拼装出来，结构和分层细节见 [docs/rules/canvas.md](../../../docs/rules/canvas.md)。本 skill 提供落地这两条规则的具体步骤、字段取值依据和真实代码片段。

核心组件（`src/features/canvas/params/`）：

| 组件 | 职责 |
|---|---|
| `ModelInputRow` | 模型选择行（标签 + MODEL 端口 + 模型 chip） |
| `MediaInputRow` | 媒体输入行（图片/视频/音频；本地上传 + 缩略图 + 拖拽排序 + 上游连线只读态） |
| `NodeParamRows` | 标量参数逐行渲染，按 `schema.order` 排序，每参数一行 |
| `NodeInputRows` | 上面三者的编排容器：模型行 → 媒体行 → 参数行 |

壳层（`src/features/canvas/nodes/shared/GenerationNodeShell.tsx`）：标题/价格/提示词框/`NodeInputRows`/端口/resize 全部内置，新增一个"标准生成节点"时大概率只需要传 props，不需要写 UI。

## 先判断是否真的需要改画布

- 标准生成节点通过 `GenerationNodeShell -> NodeInputRows -> NodeParamRows -> NodeParamControl` 读取模型注册源。新增/修改模型参数、显隐、联动、计价和 builder 后，画布通常会自动更新，不需要节点文件同步一份参数。
- 不要因为“这个模型能在画布里选择”就新增节点组件、修改 `nodeRegistry.ts`，或在节点里写模型 ID 分支。
- 只有以下情况才继续使用本 skill：新增节点类型；改变节点端口/媒体行/结果节点；增加节点内容区的独有交互；或共享 `NodeParamControl` 无法表达已经确认的新参数类型。
- 新增复合/特殊参数面板但仍属于模型 schema 时，先保证 `ParamRenderer` 与 `NodeParamControl` 共用同一个注册面板和值结构；这属于共享参数呈现，不是节点专属面板。只有确实需要节点 DOM/画布交互时才走路径 B。
- 模型 schema 中的特殊参考图、遮罩、PDF 等上传参数必须由共享 `NodeParamControl` 呈现上传入口，不能在画布退化成 URL 文本框，也不能为单个模型复制上传 UI；供应商上传仍由生成运行时统一完成。

## 第一步：判断节点该怎么实现

```
节点有"生成"动作（调模型出图/视频/音频），且没有独有交互？
  → 直接复用 GenerationNodeShell（见下方"路径 A"），新文件约 20~30 行

节点有生成动作，并且核心价值是独有的可视化交互（遮罩、打光、镜头、分镜、图层）？
  → 使用节点内 Tool Workbench：主工作面 + 紧凑检查器（见"路径 B"）

节点是从图片顶部工具栏创建的固定用途转换，但没有独有可视化交互？
  → 复用 GenerationNodeShell 的 workbench 布局，不退回纵向长表单

节点没有参数/生成行为，纯展示或纯数值源（如 ImageNode 展示节点、IntSourceNode）？
  → 不套用本 skill 的行组件体系，照搬同类节点已有写法即可
```

判断“单一主输入还是参数行”时，看输入是否需要独立的行内状态，不要只看媒体类型：

- 整个节点只有一个上游输入槽，而且这个输入只负责把一个值送进节点，不需要在节点内展示上传列表、缩略图、排序、多值或参数编辑 → 只在节点左侧放一个节点级 `id="target"` Handle，不再为它渲染 `MediaInputRow` 或同名参数行；当前注册表用历史命名 `targetHandleMode: 'legacy'` 表示这种节点级单端口形态。
- 节点有多个可区分输入，或这个输入本身需要承担本地上传、缩略图、排序、多值、逐项连接状态等交互 → 使用 `targetHandleMode: 'rows'`，由 `MediaInputRow` 或对应的专属行 UI 承载。
- `ports.target.accepts` 只声明连接类型，不能单独决定是否需要参数行。标准生成节点通常需要本地上传和媒体状态，因此仍走 `rows`；纯查看、转换或消费节点的唯一主输入通常走节点级单端口。

判断“参数组如何呈现”：`panel` / `composite` 只能在节点中占一行摘要触发器，详细内容用 `ParamGroupTrigger` 打开节点布局流之外的浮动特殊面板；禁止在节点内部直接展开整组参数并撑高节点。组内只有已经连线、需要持续显示连接状态的参数保留为紧凑行。打开和关闭面板前后，ReactFlow 测量高度必须不变。

端口必须复用 `NODE_PORT_*_CLASS` 与已登记的媒体/数据类型语义 token，不要在节点调用点任意挑尺寸或颜色。视觉核心保持轻量（当前 8 CSS px），用透明扩展区维持至少 24 CSS px 的可点范围；未连接端口空闲时隐藏，只在对应行/节点悬浮或正在连线时短暂显现，已连接端口保持可见。端口或 token 改动后，除静态检查外必须查看真实 Electron 画布截图。

## 路径 A：完全复用 GenerationNodeShell

适用于"标准生成节点"：一个提示词框 + 模型/媒体/参数行 + 生成出一个结果节点。AI 图片/视频/音频节点都是这样实现的。

1. **`canvasNodes.ts`**：加节点类型常量到 `CANVAS_NODE_TYPES`，加 `XxxNodeData` 接口（继承/对齐 `GenerationNodeShellData`），需要的话加类型守卫。
2. **`nodeRegistry.ts`**：加一个 `CanvasNodeDefinition`，参考 `imageEditNodeDefinition`（约第 159 行起）。关键字段取值见 [references/node-registry-fields.md](references/node-registry-fields.md)，别凭空猜字段含义。
3. **`nodes/XxxNode.tsx`**：整份组件只是 `GenerationNodeShell` 套了一层 props，参考：

```tsx
// src/features/canvas/nodes/ImageEditNode.tsx（完整文件，约 20 行）
export const ImageEditNode = memo(({ id, data, selected, width, height }: ImageEditNodeProps) => (
  <GenerationNodeShell
    id={id}
    nodeType={CANVAS_NODE_TYPES.imageEdit}
    data={data as GenerationNodeShellData}
    selected={selected}
    width={width}
    height={height}
    icon={<Sparkles className="h-4 w-4" />}
    promptPlaceholderKey="node.imageEdit.promptPlaceholder"
    promptRequiredKey="node.imageEdit.promptRequired"
    apiKeyRequiredKey="node.imageEdit.apiKeyRequired"
    resultTitleKey="node.imageEdit.resultTitle"
    resultNodeExtraData={{ resultKind: 'generic' }}
  />
));
```

4. **`nodes/index.ts`**：把新组件加进 `nodeTypes` 映射（key 是 `CANVAS_NODE_TYPES` 里的值）。
5. **i18n**：补 `node.menu.xxx`、`node.xxx.promptPlaceholder/promptRequired/apiKeyRequired/resultTitle` 等 key（zh-CN / en-US 都要）。
6. 按 `docs/rules/testing.md` 选择最小验证：运行节点/注册表精确测试；只有改到模型 catalog 或翻译时才运行 `gen:catalog` / `check:model-i18n`，不要默认跑全量 lint。

价格徽标、生成按钮、提示词框、端口、resize 全部由 `GenerationNodeShell` 内置，**不要**在这层重新实现任何一项。

## 路径 B：自定义节点 + 拼装标准行组件

适用于"有独有交互的生成节点"，比如分镜生成节点（格子编辑器）。完整真实案例和踩坑点见 [references/special-node-pattern.md](references/special-node-pattern.md)，这里只给装配公式。

### Tool Workbench 统一骨架

从图片顶部工具栏创建、且任务本身需要直接操纵图片或空间关系的节点，必须把核心编辑器放进节点，不以 Modal、独立面板或“调整…”按钮作为主流程。不同工具可以拥有不同工作面，但共享以下结构：

1. **单一外壳**：只由节点根绘制 Card；内部工作面与检查器使用留白、暗色 inset 和最多一条纵向分隔线，禁止卡片套卡片。
2. **横向优先**：默认宽节点、适中高度；左侧或上方较大区域承载图片/遮罩/灯位/相机/分镜，右侧或下方窄区域承载紧凑参数。禁止把普通参数行继续一层层堆成高节点。
3. **核心操作就地完成**：创建后自动选中即可编辑；遮罩绘制、灯位选择、相机轨道、图层排序等不得要求再次打开外部编辑器。
4. **公共 chrome 一致**：`NodeHeader`、价格、端口、运行状态、resize、工具栏生成入口继续复用；特殊化只发生在节点内容区。
5. **参数分层**：高频控制常驻检查器；低频模型 schema 参数进入同一检查器的滚动区或单行浮动触发器。模型/媒体/参数语义仍复用现有组件或 schema，不在专属工作面复制数据契约。
6. **重内容按需挂载**：Canvas/WebGL/高频 pointer 编辑器只在节点被选中或正在编辑时挂载；未选中时显示静态源图与设置摘要。拖动过程保留组件局部状态，交互结束再写画布 store，避免全画布刷新。
7. **尺寸语义统一**：默认采用约 `640~760px` 宽、`300~420px` 高的横向工作台；允许用户 resize，但专属工作面不得用 padding/margin 改变 ReactFlow 测量盒。

如果能力只做固定模型转换、没有专属可视化交互，仍使用同一横向 workbench 布局：左侧预览源图，右侧放提示词与标准参数区；不要为了“特殊”复制模型和参数组件。

**目录约定**：专属 UI（格子编辑器、特殊预览面板等）放 `nodes/<节点名>/` 子目录，节点主文件 `nodes/XxxNode.tsx` 只做编排和接线，不在专属面板里重新实现模型选择/媒体上传/参数渲染。

**节点主文件的标准骨架**：

```tsx
<div /* 节点外壳 */>
  <NodeHeader
    titleText={resolvedTitle}
    editable
    onTitleChange={...}
    rightSlot={effectiveModel && (
      <PriceEstimate
        providerId={effectiveModel.meta.provider}
        modelId={effectiveModelId}
        params={modelParamValues}
        variant="badge"
      />
    )}
  />

  {/* 专属面板：本节点独有的交互区域，比如格子编辑器 */}
  <XxxSpecialPanel ... />

  {/* 标准行区：模型行 → 媒体行（按需）→ 参数行，三者都是现成组件，不要重写 */}
  <div className="flex shrink-0 flex-col gap-1.5">{/* NODE_ROW_GAP_CLASS */}
    <ModelInputRow
      mediaType="image"
      modelId={selectedModelId}
      overrideModelId={overrideModelId}
      storedParams={nodeData.params}
      onModelChange={handleModelChange}
      onParamsChange={handleParamsChange}
      incomingImages={effectiveImages}
    />
    {imageRowMax > 0 && (
      <MediaInputRow
        nodeId={id}
        mediaKind="image"
        label={t('node.mediaRow.image')}
        maxCount={imageRowMax}
        inlineValue={mediaInputs.image ?? []}
        onInlineChange={handleImageInputChange}
      />
    )}
    <NodeParamRows
      nodeId={id}
      schema={modelParamSchema}
      values={modelParamValues}
      setParam={setParam}
      excludeParamIds={['prompt', 'text']}
    />
  </div>

  <Handle type="source" id="source" position={Position.Right} ... />
  <NodeResizeHandle ... />
</div>
```

**必须配套的状态/逻辑**（缺一个就会出现"看起来标准但行为不对"的 bug）：

- **模型覆盖**：用 `getConnectedParamIds`/`collectInputValues`（`graphValueResolver.ts`）算出 `overrideModelId`，`effectiveModelId = overrideModelId ?? selectedModelId`，所有 schema/生成逻辑用 `effectiveModelId`，节点自身存储字段仍用 `selectedModelId`。完整写法照抄 `GenerationNodeShell.tsx` 第 207-254 行或 `StoryboardGenNode.tsx`。
- **本地上传双态**：节点 data 加 `mediaInputs?: Partial<Record<RowMediaKind, string[]>>` 字段；`effectiveImages = incomingImages.length > 0 ? incomingImages : (mediaInputs.image ?? [])`；所有"用图片做什么"的逻辑（生成参数、智能宽高比检测、@引用列表）都要用 `effectiveImages`，不要漏改成只用 `incomingImages`。
- **`useNodeModelParams` 要传 `media`**：调用处补上 `media: { images: effectiveImages, videos: effectiveVideos, audios: effectiveAudios }`（按节点实际支持的媒体类型取舍），否则 `modelParamValues` 里不会有 `images`/`videos`/`audios`，模型 schema 里依赖"是否已上传图片/视频"的 `visible.condition`/`pricing.calculator`/`linkage` 在画布里会静默失效（不报错，只是永远判断成"没有媒体"）。只有节点自己持有真实媒体状态时才传；如果是另一个共享同一份 `storedParams` 的次要 `useNodeModelParams` 实例（如参数摘要 chip），不要传。详见 [references/special-node-pattern.md](references/special-node-pattern.md) 第 2 点。
- **数量上限**：`resolveInputLimits(effectiveModelId, modelParamValues).images.max` 决定 `MediaInputRow` 的 `maxCount`，同时决定要不要渲染这一行（`max > 0` 才渲染）。
- **生成按钮**：`nodeRegistry.ts` 里该节点的 `capabilities.toolbarGenerate: true`，节点内部 `useEffect(() => canvasEventBus.subscribe('generation/run', ({nodeId}) => { if (nodeId === id) void handleGenerate() }), [...])`。**不要**在节点内容区画一个"生成"按钮——AI 图片/视频节点都没有，生成由选中节点后浮出的顶部工具条触发。
- **连接端口**：先按上面的“单一主输入还是参数行”判定。需要媒体行时在 `nodeRegistry.ts` 加 `connectivity.targetHandleMode: 'rows'`；只有一个无行内状态的主输入时使用节点级 `target` Handle。端口形态发生迁移时，再检查 `nodeMigrations.ts` 是否需要同步处理已有边。

## 检查清单（改完自查）

- [ ] 价格徽标在 `NodeHeader` 的 `rightSlot`，不在内容区
- [ ] 没有手写的模型选择 chip / 媒体缩略图 / 逐行参数布局（这些是 `ModelInputRow`/`MediaInputRow`/`NodeParamRows` 的职责）
- [ ] 已按“单一主输入还是参数行”判断端口形态；唯一且无行内状态的输入没有被重复画成参数行，需要上传/多值/排序等状态的输入没有误用节点级单端口
- [ ] 没有节点内置"生成"按钮（`capabilities.toolbarGenerate` + `canvasEventBus` 替代）
- [ ] `panel` / `composite` 使用单行触发器和节点外浮动面板，开关面板不改变节点高度
- [ ] 接入点复用共享尺寸与语义 token；空闲未连接时隐藏，交互时显现，已连接时保持可见，缩放后仍不过分抢眼
- [ ] 节点自身的 `useNodeModelParams` 调用传了 `media`（除非它是共享 `storedParams` 的次要实例）
- [ ] `nodeRegistry.ts` 的 `CanvasNodeDefinition` 字段填全，对照 [references/node-registry-fields.md](references/node-registry-fields.md)
- [ ] 已按 `docs/rules/testing.md` 跑节点/注册表精确测试及本次真正涉及的颜色、模型 i18n、类型专项检查；没有无理由叠加全量命令
