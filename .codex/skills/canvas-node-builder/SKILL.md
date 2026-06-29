---
name: canvas-node-builder
description: Henji-AI 画布（ReactFlow）新增/改造节点时使用。指导如何选择节点实现方式（GenerationNodeShell 复用 / 标准行组件拼装 / 纯展示节点）、如何在 nodeRegistry.ts 中声明 CanvasNodeDefinition、如何组装 ModelInputRow/MediaInputRow/NodeParamRows、特殊节点如何在标准行组件之上叠加专属面板。触发场景：用户要求"新建一个画布节点"、"加一个 XX 节点"、"这个节点 UI 不规范/不一致，按标准改一下"、"这个节点的图片/视频/音频输入要怎么接"。
---

# Canvas Node Builder

## 这套体系是什么

Henji-AI 画布节点不是各写各的 UI，而是从一组标准化"参数行组件"拼装出来，结构和分层细节见 [CLAUDE.md](../../../CLAUDE.md) 的「核心架构原则 9」与「关键约束 13」。本 skill 提供落地这两条规则的具体步骤、字段取值依据和真实代码片段。

核心组件（`src/features/canvas/params/`）：

| 组件 | 职责 |
|---|---|
| `ModelInputRow` | 模型选择行（标签 + MODEL 端口 + 模型 chip） |
| `MediaInputRow` | 媒体输入行（图片/视频/音频；本地上传 + 缩略图 + 拖拽排序 + 上游连线只读态） |
| `NodeParamRows` | 标量参数逐行渲染，按 `schema.order` 排序，每参数一行 |
| `NodeInputRows` | 上面三者的编排容器：模型行 → 媒体行 → 参数行 |

壳层（`src/features/canvas/nodes/shared/GenerationNodeShell.tsx`）：标题/价格/提示词框/`NodeInputRows`/端口/resize 全部内置，新增一个"标准生成节点"时大概率只需要传 props，不需要写 UI。

## 第一步：判断节点该怎么实现

```
节点有"生成"动作（调模型出图/视频/音频），且没有独有交互？
  → 直接复用 GenerationNodeShell（见下方"路径 A"），新文件约 20~30 行

节点有生成动作，但有独有交互（比如分镜的格子编辑器、特殊预览区）？
  → 自己写节点组件，但内部拼装 ModelInputRow/MediaInputRow/NodeParamRows（见"路径 B"）

节点没有参数/生成行为，纯展示或纯数值源（如 ImageNode 展示节点、IntSourceNode）？
  → 不套用本 skill 的行组件体系，照搬同类节点已有写法即可
```

判断"是否需要 'rows' 端口形态"：节点只要声明 `ports.target.accepts` 含 `image`/`video`/`audio` 中任意一种，就必须在 `connectivity` 里加 `targetHandleMode: 'rows'`，并用 `MediaInputRow` 渲染对应媒体行——**禁止**新增节点手写单一 `id="target"` 的 Handle 来接收媒体（旧节点遗留的 legacy 写法，不要再复制）。

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
6. 跑 `npm run gen:model-manifest && npm run check:model-i18n && npm run lint`。

价格徽标、生成按钮、提示词框、端口、resize 全部由 `GenerationNodeShell` 内置，**不要**在这层重新实现任何一项。

## 路径 B：自定义节点 + 拼装标准行组件

适用于"有独有交互的生成节点"，比如分镜生成节点（格子编辑器）。完整真实案例和踩坑点见 [references/special-node-pattern.md](references/special-node-pattern.md)，这里只给装配公式。

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
- **数量上限**：`resolveInputLimits(effectiveModelId, modelParamValues).images.max` 决定 `MediaInputRow` 的 `maxCount`，同时决定要不要渲染这一行（`max > 0` 才渲染）。
- **生成按钮**：`nodeRegistry.ts` 里该节点的 `capabilities.toolbarGenerate: true`，节点内部 `useEffect(() => canvasEventBus.subscribe('generation/run', ({nodeId}) => { if (nodeId === id) void handleGenerate() }), [...])`。**不要**在节点内容区画一个"生成"按钮——AI 图片/视频节点都没有，生成由选中节点后浮出的顶部工具条触发。
- **连接端口**：`nodeRegistry.ts` 加 `connectivity.targetHandleMode: 'rows'`；如果这是从 legacy 单一 `target` Handle 迁移过来的旧节点类型，必须同时检查 `nodeMigrations.ts` 的 `migrateLegacyTargetHandle` 是否已覆盖该类型（它按 `ports.target.accepts` 只有一种媒体类型时自动迁移旧边，多媒体类型节点需要单独处理，不要假设自动生效）。

## 检查清单（改完自查）

- [ ] 价格徽标在 `NodeHeader` 的 `rightSlot`，不在内容区
- [ ] 没有手写的模型选择 chip / 媒体缩略图 / 逐行参数布局（这些是 `ModelInputRow`/`MediaInputRow`/`NodeParamRows` 的职责）
- [ ] 没有手写单一 `id="target"` 的 Handle 来接收媒体（`targetHandleMode: 'rows'` + `MediaInputRow` 替代）
- [ ] 没有节点内置"生成"按钮（`capabilities.toolbarGenerate` + `canvasEventBus` 替代）
- [ ] `nodeRegistry.ts` 的 `CanvasNodeDefinition` 字段填全，对照 [references/node-registry-fields.md](references/node-registry-fields.md)
- [ ] 跑 `npm run gen:model-manifest && npm run check:colors && npm run check:model-i18n && npm run lint && npx tsc --noEmit -p tsconfig.json`
