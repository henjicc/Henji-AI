# nodeRegistry.ts — CanvasNodeDefinition 字段参考

文件：`src/features/canvas/domain/nodeRegistry.ts`。每个节点类型对应一个 `CanvasNodeDefinition<TData>`，连接校验、连接菜单、媒体行渲染、生成流程全部由这些字段驱动——**改行为先改字段，不要在组件里写 if (type === 'xxx')**。

## capabilities

```ts
interface CanvasNodeCapabilities {
  toolbar: boolean;          // 选中节点时是否显示顶部悬浮工具条（几乎总是 true）
  promptInput: boolean;      // 是否有"提示词大输入框"这一行为（GenerationNodeShell 节点为 true；
                              // 有专属面板自己处理文案输入的节点为 false，如分镜生成节点）
  toolbarGenerate?: boolean; // 是否在顶部工具条显示"生成"按钮（见下方"生成按钮"）
}
```

**生成按钮只有一种正确接法**：`toolbarGenerate: true` + 节点内部订阅 `canvasEventBus`：

```ts
useEffect(() => canvasEventBus.subscribe('generation/run', ({ nodeId }) => {
  if (nodeId !== id) return;
  void handleGenerate();
}), [handleGenerate, id]);
```

不要在节点内容区里再画一个"生成"按钮（旧分镜节点曾经这样做，已改掉）。

## connectivity

```ts
interface CanvasNodeConnectivity {
  sourceHandle: boolean;   // 有右侧输出端口
  targetHandle: boolean;   // 有左侧输入端口
  connectMenu: {
    fromSource: boolean;   // 从这个节点的输出端口拖出连线时，是否弹出"连接到 XX"快捷菜单
    fromTarget: boolean;   // 反之
  };
  manualSource?: boolean;  // 是否允许手动从输出端口拖线（极少数节点，如上传节点）
  targetHandleMode?: 'legacy' | 'rows';
}
```

**`targetHandleMode` 怎么选**（按用户可见的输入语义判断，不按媒体类型判断）：

- `'legacy'`（历史命名）：整个节点只有一个上游输入槽，输入只负责传入一个值，不需要本地上传列表、缩略图、排序、多值或参数编辑。此时沿用节点左侧单一 `id="target"` Handle，不再渲染同名参数行。纯查看、转换或消费节点常用这种形态。
- `'rows'`：节点有多个需要区分的输入，或输入行本身要承担本地上传、缩略图、排序、多值、逐项连接状态等交互。媒体端口 id 使用 `socketTypes.ts` 的 `mediaPortId('image')`（形如 `param:__image`）。标准生成节点通常属于这一类。
- `ports.target.accepts` 只负责声明连接类型与兼容性；即使它包含 `'image'`/`'video'`/`'audio'`，也不能单独推出必须使用 `'rows'`。

**`targetHandleMode: 'rows'` 不等于必须用 `MediaInputRow` 渲染**：两者通常配对，但端口形态（id 用 `mediaPortId`）和 UI 渲染方式是两件独立的事。如果节点的媒体输入语义是"本地上传 + 单一列表 + 缩略图"，用 `MediaInputRow`（分镜生成节点的图片输入）；如果语义是"只读聚合上游所有连线、供多个目标各自挑选引用"（分镜分割节点：图片池喂给每个分镜格子选用），保留节点自己的专属选图 UI，只把 Handle 的 `id` 从 `'target'` 换成 `mediaPortId('image')` 即可，不要为了"看起来标准"强行套用 `MediaInputRow` 的本地上传/缩略图列表样式——那套 UI 表达的是另一种数据模型，会和专属选图 UI 打架。

**从 legacy 迁移到 rows 时的兼容性**：旧版单一 `target` Handle 上可能已经存了真实用户画布的连线（`edge.targetHandle === 'target'`）。`src/features/canvas/domain/nodeMigrations.ts` 的 `migrateLegacyTargetHandle()` 会在 `canvasStore.ts` 的 `normalizeEdgesWithNodes()` 里自动把这类旧边重新指向新的媒体端口——**前提是该节点的 `ports.target.accepts` 只声明了一种媒体类型**（无歧义才能自动推断）。如果你迁移的节点 `accepts` 有多种媒体类型，这个自动迁移不会生效，需要单独处理旧边（或确认该节点类型从未有过 legacy 单一 Handle，不需要迁移）。

## media / ports

```ts
media?: { kind: MediaKind; role: 'source' | 'generator' | 'result' };
// source = 素材输入节点（上传）；generator = 会触发生成的节点；result = 生成结果展示节点

ports?: {
  source?: { emits: MediaKind };        // 输出端口产出的媒体类型
  target?: { accepts: MediaKind[] };    // 输入端口能接受的媒体类型；不单独决定是否渲染 MediaInputRow
};
```

`MediaKind = 'image' | 'video' | 'audio' | 'text'`；媒体行体系（`RowMediaKind`，`socketTypes.ts`）只覆盖 `'image' | 'video' | 'audio'`，`'text'` 走提示词端口（`promptPortId()`），不会生成 `MediaInputRow`。

## generation

```ts
generation?: {
  modelType: 'image' | 'video' | 'audio'; // 决定 registry.getModelsByType() 取哪一类模型
  resultNodeType: string;                 // 生成完成后落地的展示节点类型（CanvasNodeType）
};
```

只有"会触发生成"的节点才填这个字段；纯展示/纯素材节点不填。

## getOutputs / getValueOutput

- `getOutputs?: (data) => NodeMediaOutput[]`：本节点对下游的媒体输出（图片/视频/音频 URL）。生成类/展示类节点基本都用现成的 `imageOutputsFromData` 之类的通用提取函数，**不要每个节点重写一份相同逻辑**。
- `getValueOutput?: (data) => NodeValueOutput | null`：仅数值源/模型选择器节点需要（输出一个标量值给下游参数端口）。

## createDefaultData

节点新建时的初始 `data`。注意：

- 有模型选择的节点要给 `modelId: getDefaultModelId(modelType)` 和 `params: {}`
- 使用媒体输入行或节点内联媒体状态时要给 `mediaInputs: {}`；只有一个纯上游主输入、节点内不保存媒体行状态时不需要该字段
- 旧字段迁移（如 `model`/`size`/`requestAspectRatio`）不需要在这里处理，那是 `nodeMigrations.ts` 的职责

## 完整新增节点步骤（摘自文件顶部 SOP 注释）

1. `canvasNodes.ts`：节点类型常量、Data 接口、类型守卫
2. `nodeRegistry.ts`：本文档描述的 `CanvasNodeDefinition`
3. `nodes/`：节点组件（生成类节点优先复用 `GenerationNodeShell`）
4. `nodes/index.ts`：注册到 `nodeTypes` 映射
5. i18n：补 `node.menu.*` 等文案键（zh-CN / en-US 都要）

约束：禁止在组件或通用逻辑里写 `if (type === 'xxxNode')` 特判，行为差异一律通过这个注册表的声明字段表达。
