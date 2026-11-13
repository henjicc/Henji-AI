# 修订号与预渲染引擎版本

## 一、剪辑修订号在没有内容改动时也会涨

### 根因
- 助手 `video_edit` 作用域取的是 `videoEditDomainRevision()`。这个数原本是领域订阅（约 30 个面板的 `useSyncExternalStore`）的通知计数。
- 撤销回执、带基线的写入、宿主上下文的 `scopeRevisions.video_edit` 都拿它当并发基线。一个数同时承担“通知界面重读”和“内容版本”，所以凡是要通知界面的事件都会推高基线。
- 实际推高它的非内容事件：
  - 打开、关闭任意剪辑：`openVideoEditDocument` / `dispose` 里的 `publishVideoEdit(true)`
  - 切序列、播放头回到开头：`switchVideoEditSequence`
  - 时间线视图（缩放、选区、目标轨）：`setVideoEditTimelineView`
  - 素材面板视图：`setVideoEditProjectView`
  - 播放、定位、播放速度：`setVideoEditView` 与 `setVideoEditPlaybackRate`。这两处专门写了 `domainRevision++`，只为让基线变，界面并不接收通知
  - 源监视器：`videoEditSource.ts`
  - 风格库首次读取：`videoEditStyleLibrary.load`

### 改法
- `videoEditService.ts` 新增 `videoEditContentRevision()`，它是助手 `video_edit` 作用域唯一的修订来源。只在下面这些情况推进：
  - 任意已打开剪辑的文档内容变化。和 `contentVersion` 同点推进：提交、撤销重做、手势预览与取消、外部重新载入、素材重定位
  - 原稿（`creativeIntents`，助手可读写的实体）变化
  - 剪辑改名
  - 本机剪辑库写入，经新入口 `publishVideoEditContent()`：导出预设、文字预设、预设偏好与默认过渡、风格库写入与换资料目录后的重读、代码组件发布与撤回、代码工程文件
- 导出记录、原地生成任务元数据和以前一样不推进。
- `videoEditDomainRevision()` / `publishVideoEdit(true)` 保持原来的通知语义，所有订阅者照常收到通知。播放与播放速度那两处单为基线加的 `domainRevision++` 已删掉。
- 风格库首次读取只通知、不推进内容修订。理由：所有助手读取入口都先 `await ready()`，读取完成前助手看不到风格库，首次读取不会让任何基线过时。
- 14 个反射或执行器文件、`hostContext.ts` 的 `video_edit` 修订统一改读 `videoEditContentRevision()`。

### 改前列出的读取方
- **界面订阅**：`subscribeVideoEditDomain` + `videoEditDomainRevision`，约 25 个面板。语义没变。
- **自动保存**：走 `notifyVideoEditContent` / `contentVersion`，与本改动无关。
- **渲染失效**：用 `contentVersion` 与文档身份，与本改动无关。
- **助手上下文与并发基线**：`hostContext.syncPulledRevisions`、各实体 `revisions`、`resultingRevisions`。已全部切到内容修订。
- `videoEditExecutors` 里订阅 `subscribeVideoEditDomain` 的源暂停恢复只用它触发自检，不读数值。

### 取舍与风险
- 视图类属性（时间线视图、播放头、源监视器、素材面板视图）的写入不再因别人的视图变化被引擎拒绝，变成后写者生效。撤销照样有保护：执行器在撤销时用 `viewAfter` 快照核对视图、用实例身份核对会话，视图被改过就拒绝撤销，只是错误码不是 CONFLICT。
- 有些操作隐式用当前序列。以前用户切序列会让助手手里的基线失效；现在不会，助手拿旧基线写入时，会写到用户切过去的序列上。这是“切序列不算冲突”的直接后果，属于用户要的语义。
- 剪辑关闭后，如果文件在磁盘上被外部改动再重开，内容修订不会推进。打开不算内容变化，否则后台读一下别的剪辑又会让撤销引用失效。磁盘被外部改动的情况很少；撤销仍会因实例身份不同而被执行器拒绝。
- 作用域粒度没变：所有已打开剪辑和本机剪辑库共用一个 `video_edit` 作用域。改另一份剪辑或保存一个导出预设仍会让撤销 CONFLICT。这属于真实的内容变化，不是这次的病根。如果要按文档拆分作用域，就得改能力契约，这次没做。

### 同类排查
- **音频编辑**（`audioEditProjectInstances.ts`）：有同类问题，已修。打开任意口播（`bindAudioEditSession`，含 `Math.max(…, meta.revision)` 跳号）和释放口播都推进 `audio_edit`。读一下别的口播（读取会自动打开）就会让手里的撤销引用 CONFLICT。现在打开和释放都不推进；改名、重新载入、编辑、撤销、处理结果照常推进。上一批的“带旧基线时同一份口播有任何改动都拒绝”属于内容改动，没动。
- **图片编辑**（`imageEditDocumentInstances.ts`）：有同类问题，已修。`adopt`（打开）和 `dispose`（关闭）都推进 `image_edit`。现在只通知、不推进；数据持久化与选区变化照常推进。选区保留在内，因为它是图片操作的输入，算文档状态。
- **画布**：修订取自工程 `updatedAt`，属于内容；`hostContext` 已有“选中不推进 canvas”的约束。没发现同类问题。
- **镜头参考**：`hostContext` 只在场景数据（对象、动画、状态关键帧、场景设置、当前工程与名称、当前机位）变化时推进；选中与编辑器开合走 `surface`。切换当前工程会替换这个作用域描述的整份数据，所以算数据变化。没发现同类问题。

## 二、预渲染引擎版本把调度代码也散列进去

### 根因
`RENDER_ENGINE_FILES` 直接列了整份 `videoEditRenderCache.ts`（调度、让出、续上、日志、吃力判断的读数都在里面）。另外，`core/videoEdit/renderCache.ts` 的闭包里带着 `heavyClips`。只改调度或“哪些段算吃力”，所有用户的预览文件就全部失效。

### 改法
- **新文件 `videoEditRenderCacheEncode.ts`**（散列名单里只放它）：决定文件字节的部分都在这里，包括：
  - 编码档案 `videoEditRenderProfile`
  - 交给渲染会话的画面输入 `openVideoEditRenderSession`（序列、智能区域、跟踪结果）
  - 单个窗口的编码与封装 `encodeVideoEditRenderWindow`：编码流参数、每帧关键帧、帧时间戳与时长、精度、来源标记、MP4 封装与分块写入、提交登记字段
  - `abortable`（调度也复用它，避免两份实现）
- **调度留在 `videoEditRenderCache.ts`**，不参与散列，包括：
  - 何时渲、渲哪些窗口、排序
  - 让出、续上与占空比歇息
  - 同时在途帧数（只影响节奏，不改每帧内容与时间）
  - 精度取哪档（结果记在文件来源里，读取方按来源过滤）
  - 缓存查找、日志
- **吃力判断移到 `core/videoEdit/renderLoad.ts`**（闭包外）：`heavyClips`、`multicamPicture`、`retimed`。`core/videoEdit/renderCache.ts` 的窗口不再带 `heavy`，导出 `videoEditRenderWindowInputs` / `videoEditRenderWindowClips`，让指纹和吃力判断用同一份片段选取。应用层按切段对象缓存一次吃力判断，再补到窗口上。
- **散列名单**补上 `engine/videoEditEncodedVideo.ts`（只散列文件本身）：编码结果的时间戳还原、关键帧节奏、首包类型校正都在这里，直接影响文件字节，原来没有参与散列。这是原有的遗漏，按“拿不准就留在散列范围内”补上。
- **仍在散列范围内的**：
  - `core/videoEdit/renderCache.ts` 的切段与指纹（闭包）
  - `renderBitrate`
  - 渲染 Worker、导出编码器（闭包）
  - 渲染会话、传输（只散列文件本身）

### 这次改动会不会让现有缓存失效
会，失效一次。`core/videoEdit/renderCache.ts` 的运行代码变了（去掉 `heavy`、抽出片段选取），散列名单也换了文件，所以引擎版本会变，所有用户已有的预览文件都要重做一遍。这是最后一次因为调度或吃力判断的改动而失效；以后只改这两部分，版本不再变化。

## 改动文件
- 修订号：
  - `src/features/videoEdit/application/videoEditService.ts`
  - `videoEditExportPresets.ts`
  - `videoEditPresetPreferences.ts`
  - `videoEditTextPresets.ts`
  - `videoEditStyleLibrary.ts`
  - `videoEditCodeStorage.ts`
  - `videoEditCodeProject.ts`
  - 改读内容修订的反射与执行器：`videoEditAnnotationBatch.ts`、`videoEditCodeComponentReflection.ts`、`videoEditCodeElementReflection.ts`、`videoEditCodeProjectReflection.ts`、`videoEditCreativeIntentReflection.ts`、`videoEditExecutors.ts`、`videoEditExplanationReflection.ts`、`videoEditExportPresetReflection.ts`、`videoEditPresetReflection.ts`、`videoEditReflection.ts`、`videoEditSourceExecutor.ts`、`videoEditStyleReflection.ts`、`videoEditSubtitlePresetReflection.ts`、`videoEditTextPresetReflection.ts`
  - `src/features/application-control/hostContext/hostContext.ts`
  - `src/features/audioEdit/application/audioEditProjectInstances.ts`
  - `src/features/imageEdit/v3/application/imageEditDocumentInstances.ts`
- 测试：
  - `videoEditService.test.ts`：新增“撤销引用只因内容变化失效”；更新原来按旧语义写的 3 条
  - `videoEditSource.test.ts`
  - `videoEditEffectPresets.test.ts`
  - `hostScopeRevisions.test.ts`
  - `audioEditProjectInstances.test.ts`（新增 1 条）
  - `imageEditDocumentInstances.test.ts`（新增 1 条）
- 引擎版本：
  - `scripts/vite/renderEngineVersion.mjs`
  - `src/features/videoEdit/application/videoEditRenderCacheEncode.ts`（新）
  - `src/features/videoEdit/application/videoEditRenderCache.ts`
  - `src/core/videoEdit/renderCache.ts`
  - `src/core/videoEdit/renderLoad.ts`（新）
  - 测试：`scripts/vite/renderEngineVersion.test.mjs`（新增正式散列名单一条）、`src/core/videoEdit/renderCache.test.ts`、`videoEditRenderCache.test.ts`、`videoEditRenderCacheCapability.test.ts`

## 测试结果
- **剪辑**：`videoEditService.test.ts`（39 项）、`videoEditSource.test.ts`，以及 annotationBatch、codeElementReflection、codeProject、explanation、presetCatalog、styleLibraryParent、textPresets，全部通过。
- **宿主作用域**：`hostScopeCoverage`、`hostScopeRevisions` 通过。
- **音频与图片**：`audioEditProjectInstances`、`audioEditReflectionResult`、`imageEditDocumentInstances` 通过。
- **引擎版本**：`node --test scripts/vite/renderEngineVersion.test.mjs` 7 项通过。新增的一条核对正式散列名单：调度文件和吃力判断不参与，编码文件、编码结果封装、切段指纹、码率参与。
- **预渲染**：`renderCache.test.ts`、`videoEditRenderCache.test.ts`（45 项）、`videoEditRenderCacheCapability`、`videoEditRenderFingerprints`、`videoEditAuthorFingerprint` 通过。
- **ESLint**：本次全部改动文件零告警。
- **tsc**：`tsc -p tsconfig.json --noEmit` 跑了一次，唯一报错是新测试里 `undoRef` 可能为 undefined（`videoEditService.test.ts:698`）。已加非空断言，并重跑该测试通过。按“最多一次”的约束，没有再跑 tsc。没有报其他错误；本次没有改主进程引用的文件，没跑 electron 工程。
- **与本次无关的失败**：`videoEditEffectPresets.test.ts` 的“加载收藏…读回目录引用”，期望 `minReaderVersion` 18、实际 17。原因是另一位子代理正在改 `src/core/persistence/**`。本次没有碰效果库存储；同文件内与本次相关的那条（效果库写入不推进内容修订）通过。

## 未验证
- 没有在真实应用里复现原来的 14→17 场景（按约束不启动应用）。
- `mcpWriteIntegration.test.ts` 等更大的集成测试没跑，交给 CI。
