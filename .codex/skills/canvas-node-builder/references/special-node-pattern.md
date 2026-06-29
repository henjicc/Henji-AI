# 特殊节点参照案例：分镜生成节点

分镜生成节点（`StoryboardGenNode`）是目前仓库里"标准行组件 + 专属面板"模式的唯一真实案例。新建/改造其他有独有交互的生成节点时，照这个结构抄。

## 目录结构

```
src/features/canvas/nodes/
├── StoryboardGenNode.tsx              # 主文件：编排 + 接线，~480 行
└── storyboardGen/
    ├── StoryboardGridEditor.tsx       # 专属面板：格子网格 + 每格的 ReferenceTextarea
    ├── generation.ts                  # 专属面板取值 → 拼提示词 → 调生成
    ├── layout.ts                      # 节点/格子尺寸的纯计算函数（不含 JSX）
    └── shared.tsx                     # 小型纯展示子组件 + 像素常量
```

**反面教材**：这个目录曾经还有一个 `StoryboardParamsBar.tsx`，用 chip + 弹层模拟"模型选择 + 参数配置 + 生成按钮"，和 AI 图片/视频节点的逐行风格不一致，也不支持连线覆盖模型/参数、不支持数量上限——已经删除并替换成下面的标准行组件。改造同类节点时，发现这种"自己拼 UI 模拟标准行组件"的实现，直接删掉换成标准组件，不要保留兼容层。

## 主文件的真实结构（节选自 StoryboardGenNode.tsx）

```tsx
return (
  <div /* 节点外壳，h-full flex flex-col */>
    <NodeHeader
      titleText={resolvedTitle}
      editable
      onTitleChange={...}
      rightSlot={effectiveModel && (
        <PriceEstimate providerId={effectiveModel.meta.provider} modelId={effectiveModelId}
          params={modelParamValues} variant="badge" />
      )}
    />

    {/* 专属面板：格子网格，flex-1 占据剩余空间 */}
    <StoryboardGridEditor
      nodeData={nodeData}
      totalFrames={totalFrames}
      frameLayout={frameLayout}
      frameDescriptionDrafts={frameDescriptionDrafts}
      incomingImageItems={incomingImageItems}   // 用 effectiveImages 构建，不是 incomingImages
      onRowChange={handleRowChange}
      onColChange={handleColChange}
      onFrameDescriptionChange={handleFrameDescriptionChange}
    />

    {error && <div>{error}</div>}

    {/* 标准行区：shrink-0，自然高度 */}
    <div className="flex shrink-0 flex-col gap-1.5">
      <ModelInputRow mediaType="image" modelId={selectedModelId} overrideModelId={overrideModelId}
        storedParams={nodeData.params} onModelChange={handleModelChange}
        onParamsChange={handleParamsChange} incomingImages={effectiveImages} />
      {imageRowMax > 0 && (
        <MediaInputRow nodeId={id} mediaKind="image" label={t('node.mediaRow.image')}
          maxCount={imageRowMax} inlineValue={mediaInputs.image ?? []}
          onInlineChange={handleImageInputChange} />
      )}
      <NodeParamRows nodeId={id} schema={modelParamSchema} values={modelParamValues}
        setParam={setParam} excludeParamIds={['prompt', 'text']} />
    </div>

    <Handle type="source" id="source" position={Position.Right} ... />
    <NodeResizeHandle minWidth={baseFrameLayout.nodeWidth} minHeight={baseFrameLayout.nodeHeight} ... />
  </div>
);
```

要点：**没有手写的 `target` Handle**——图片输入完全交给 `MediaInputRow`（节点已声明 `targetHandleMode: 'rows'`）。

## 三个容易漏改的地方（都是"看起来标准但行为不对"的根源）

### 1. 本地上传 / 上游连线双态要全链路用 `effectiveImages`

```ts
const mediaInputs = useMemo(() => nodeData.mediaInputs ?? {}, [nodeData.mediaInputs]);
const effectiveImages = useMemo(
  () => (incomingImages.length > 0 ? incomingImages : (mediaInputs.image ?? [])),
  [incomingImages, mediaInputs]
);
```

`incomingImages`（纯上游连线，handle 无关，靠 `collectInputMediaUrls` 算）只在算 `effectiveImages` 时用一次。**之后所有用图片的地方都要用 `effectiveImages`**，漏掉任何一处都会出现"本地上传的图片在格子里能 @引用，但生成时没传给模型"之类的不一致：

- `@图N` 引用列表（`incomingImageItems`）
- 智能宽高比检测（`analyzeRatioResolutionParams(schema, effectiveImages)`）
- `resolveReferenceIndexFromDescription(description, effectiveImages.length)`
- 生成请求的 `images`/`uploadedFilePaths` 字段
- `ModelInputRow` 的 `incomingImages` prop（用于参数面板里的智能宽高比/缩略图展示）

### 2. 图片行数量上限决定要不要渲染这一行

```ts
const imageRowMax = useMemo(
  () => resolveInputLimits(effectiveModelId, modelParamValues).images.max,
  [effectiveModelId, modelParamValues]
);
// ...
{imageRowMax > 0 && <MediaInputRow ... maxCount={imageRowMax} ... />}
```

不要假设"这个节点类型永远有图片输入"就跳过这个判断——模型切换后限额可能变成 0（极少数模型场景），这时不该渲染空的图片行。

### 3. 动态行数 → 动态节点高度

特殊面板（格子网格）和标准行区共享节点总高度，而标准行区的行数会随"是否有图片行" + "当前模型有多少个可见参数"变化。如果节点高度是手算的固定值，行数变化时会挤压/裁切专属面板。做法：

```ts
const paramsRowCount = useMemo(() => {
  const visibleParamCount = modelParamSchema.filter(
    (param) => !['prompt', 'text'].includes(param.id) && isParamVisible(param, modelParamValues, null)
  ).length;
  return 1 /* 模型行 */ + (imageRowMax > 0 ? 1 : 0) + visibleParamCount;
}, [imageRowMax, modelParamSchema, modelParamValues]);
```

再把 `paramsRowCount` 传进专属的布局计算函数（`storyboardGen/layout.ts` 的 `computeStoryboardBaseFrameLayout`/`computeStoryboardFrameLayout`），按 `行数 × 行高(40px, 对应 NODE_ROW_CLASS 的 min-h-10) + (行数-1) × 行间距(6px, 对应 NODE_ROW_GAP_CLASS)` 算出标准行区实际占用高度，再从节点总高度里减去，剩下的留给专属面板。具体常量见 `storyboardGen/shared.tsx` 的 `STORYBOARD_PARAM_ROW_HEIGHT_PX`/`STORYBOARD_PARAM_ROW_GAP_PX`。

如果你的专属面板不需要精确像素布局（比如是个可以自然换行的卡片列表），可以不用这么精确，让 CSS flex 自己分配空间即可——分镜节点是因为格子网格要按宽高比精确算每格像素尺寸，才需要这么严格的高度联动。
