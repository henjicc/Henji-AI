# 特殊节点参照案例：分镜与工具工作台

特殊节点分两类，先按用户的主要动作判断，不能混用：

- **内容编排型**：分镜生成节点（`StoryboardGenNode`）以格子编排为核心，采用“专属面板 + 标准行区”。
- **直接操纵型 Tool Workbench**：局部重绘、打光、多角度、图层等以画面或空间操作为核心，采用“主工作面 + 紧凑检查器”，核心操作直接发生在节点内。

两类都复用 `NodeHeader`、端口、运行状态、schema 参数与工具栏生成入口；差别只在内容区的布局。

## Tool Workbench 结构

```tsx
<ToolWorkbenchNodeFrame ...>
  <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.4fr)_minmax(220px,0.6fr)]">
    <main className="nodrag nowheel min-h-0 overflow-hidden bg-bg-dark/45">
      <XxxInteractiveStage />
    </main>
    <aside className="nodrag nowheel min-h-0 overflow-y-auto border-l border-veil-subtle p-3">
      <XxxPrimaryControls />
      <NodeInputRows ... />
    </aside>
  </div>
</ToolWorkbenchNodeFrame>
```

执行约束：

1. 创建后选中节点即可进入编辑，不再调用 `openCanvasSpecialEditor` 作为主流程。
2. 未选中时用源图/摘要占位；Canvas、WebGL 和 pointer 高频编辑器只在选中时挂载。
3. 检查器可以滚动，节点默认高度保持稳定；参数增加不能继续把节点向下撑长。
4. 工作面和检查器是同一节点卡片里的 Region/Inset，不再各自画一圈 Card。
5. 高频拖动先写组件局部状态，在 `pointerup`、确认或编辑结束时一次写回节点 data。
6. `MediaInputRow`/`ModelInputRow`/`NodeParamRows` 仍是输入契约唯一入口；允许改变它们在检查器中的编排，不允许复制实现。

固定转换工具没有独有舞台时，`GenerationNodeShell layoutMode="workbench"` 负责左侧源图预览与右侧标准参数区；不要为高清放大、修复、抠图等工具各写一份相同壳层。

## 内容编排型：分镜生成节点

分镜生成节点是“标准行组件 + 专属面板”的参照案例。它的格子本身已经是主工作面，不需要改造成直接操纵型的两栏检查器。

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

## 四个容易漏改的地方（都是"看起来标准但行为不对"的根源）

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

### 2. `useNodeModelParams` 要传 `media`，否则参数显隐/计价/联动在画布里不会响应本地上传

```ts
const { schema, values: modelParamValues, setParam } = useNodeModelParams({
  modelId: effectiveModelId,
  storedParams: nodeData.params,
  onParamsChange: handleParamsChange,
  media: { images: effectiveImages /*, videos: effectiveVideos, audios: effectiveAudios 视节点支持的媒体类型而定 */ },
});
```

`useNodeModelParams` 返回的 `modelParamValues`（也就是上面 `NodeParamRows`/`PriceEstimate`/`resolveInputLimits` 共用的那个 `values`/`params`）默认**不包含** `images`/`videos`/`audios`——这两个键只在用户点"生成"那一刻才会临时拼进请求参数，不会出现在驱动 UI 渲染的这份状态里。不传 `media`，模型 schema 里"上传图片后隐藏某参数"、"有视频输入时价格不同"、"上传 2 张图自动切首尾帧"这类依赖媒体状态的 `visible.condition`/`pricing.calculator`/`linkage` 在画布里会全部失效（对话/工具面板不受影响，因为那边走的是另一套已经同步好的状态）——而且不会报错，是"看起来接上了但永远拿不到真实媒体"的静默失败，必须主动核对。

**例外**：如果某处额外调用了 `useNodeModelParams` 只是为了渲染一个不依赖媒体状态的小型摘要（比如 `NodeModelParamsControls` 的参数 chip 文案），且这个实例和主实例共享同一份 `storedParams`/`onParamsChange`，**不要**给它传 `media`——传了反而会让它把"没有媒体"误判成真实状态，跑 `autoSwitch` 类联动时可能撤销主实例已经做出的正确切换。`media` 是否传，只看这个 `useNodeModelParams` 实例是不是该节点"持有真实媒体状态"的那一个。

### 3. 图片行数量上限决定要不要渲染这一行

```ts
const imageRowMax = useMemo(
  () => resolveInputLimits(effectiveModelId, modelParamValues).images.max,
  [effectiveModelId, modelParamValues]
);
// ...
{imageRowMax > 0 && <MediaInputRow ... maxCount={imageRowMax} ... />}
```

不要假设"这个节点类型永远有图片输入"就跳过这个判断——模型切换后限额可能变成 0（极少数模型场景），这时不该渲染空的图片行。

### 4. 内容编排型的动态行数 → 动态节点高度

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

Tool Workbench 不走这条动态增高规则：它的检查器固定在可用高度内滚动，主工作面始终优先获得空间。
