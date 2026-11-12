# W5-B 结果：后台占用的文档删不掉

## 根因

1. **删除为什么被拒**：`DocumentOperations.trashDocument` 发现文档有会话时，会调用 `releaseBackground` 请工具释放；工具拒绝就报 `DocumentInUseError`（“正在编辑，请先关闭后再移到回收站”）。口播的释放函数 `releaseAudioEditProject` 用 `shownDocumentId === id` 判断“界面正在显示”。这个值由 `useAudioEditStore.setProject` 写入，只有编辑器“返回列表”或会话结束时才清空。
2. **切走后为什么仍占着**：`open_application_surface` 切到工具首页时只改了导航（`activeToolId = null`），口播页组件被卸载。但口播 store 里的 `project` 和 `shownDocumentId` 都还记着这份文档，所以释放函数一直认为“界面正在显示”。
3. **`close_application_surface` 为什么说“未打开”**：它按导航判断，口播页确实没开，这个返回符合实际。问题在于“正在编辑”和“页面打开着”用的是两套判断：前者看工具 store，后者看导航。两套判断对不上，就成了一条死路：删除被拒，页面又关不了，因为页面本来就没开。
4. **为什么后台释放路径没起作用**：路径本身调用了，但工具拿 store 状态当“前台”，拒绝了释放。镜头参考（`cameraStageStoreAttachment`）、画布（`canvasStoreAttachment`）、剪辑（`activeId`）的释放函数都是同样的写法：只要编辑器状态里还附着着这份就拒绝，不管页面切没切走。

## 修法

只保留一个“前台编辑”事实：`currentDocumentContext.ts` 里各工作区登记的当前文档判断（导航正显示它）。

- `currentDocumentContext.ts` 新增 `isForegroundDocument(id)`。
- `DocumentOperations.releaseBackground` 先用它判断：文档在前台编辑就拒绝；否则交给工具释放。工具只在有进行中的任务、正在打开或离开时拒绝。`DocumentReleaser` 的约定和注释同步改了。
- 口播：删掉 `shownDocumentId` 和 `markAudioEditDocumentShown`，store 也不再调用它们。释放后会话结束，store 原有的订阅会把编辑器退回列表。
- 画布：释放函数去掉附着判断。实例拆掉时原本就会断开附着，`projectStore` 订阅会把画布页退回列表。
- 镜头参考：释放函数去掉附着判断。拆掉时原本就会换上空场景；下次进工具页时按上次的文档恢复，文档已删就回到列表（`CameraStageApp` 原有逻辑）。
- 图片文档：没有改。它的 `isShown` 由编辑器挂载决定，切走工具页时组件卸载，会自动置为 false，本来就没有这条死路。
- `trash_document` 能力的说明和 `failureRecovery` 改为：只在后台打开的文档先保存再删；前台编辑的，先离开所在页面再试。

现在的行为：
- 文档只在后台持有时（含编辑器页面已切走），删除会先保存、关闭实例，再移到回收站。
- 文档正在前台编辑时，五种文档统一拒绝。离开所在页面后（工具页可以用 `close_application_surface`）就能删。

## 审查第一轮后的修正

独立审查报了 2 条重要问题、4 条小问题，处理如下。

1. **画布节点里的 3D 全屏编辑器不算前台（重要）**
   - 问题：去掉“附着即拒绝”后，节点编辑器正在编辑的镜头参考可能被删除或项目删除流程释放，编辑器变成没有会话的空场景。
   - 修法：`currentDocumentContext.ts` 新增 `registerEmbeddedDocumentEditor`。它只参与“正在编辑”的判断，不参与“当前文档”的计算，所以画布页的当前文档、默认值和记忆不受影响。
   - `cameraStageNodeEditor.ts` 新增 `registerCameraStageNodeEditorDocument`，由画布 `applicationDomain` 登记：画布页显示时，节点编辑器的 `documentId` 算前台。
   - 画布页切走后，这份文档可以被释放。释放时 `subscribeCameraStageProjectDisposal` 会通知编辑器关闭，关闭时不再保存，因为会话关闭时已经写完。
   - 其他嵌入式编辑器的排查：
     - 画布节点里的图片编辑、多层文档节点：编辑的是画布文档内的节点数据，不是独立文档，不走通用删除。
     - 剪辑里“嵌入打开”的口播、画布、图片、镜头参考：都在各自的工具页或工作区打开（`embedIn` 只加返回条），已经被各自的前台判断覆盖。
2. **工具区隐藏但镜头参考页仍挂载时释放（重要）**
   - 修法：后台释放镜头参考实例后，如果 `useCameraStageSessionStore.lastDocumentId` 等于它，就清空记录并回到列表，与口播、画布的做法一致。这一步原本放在实例拆除时，第二轮收尾改到释放路径，见下一节第 3 条。
   - 应用退出不走释放，所以重启后恢复上次文档不受影响。`cameraStageProjectRuntime.ts` 里释放函数的注释已按实际行为改写。
3. **两处旧注释（小问题）**：`localApplicationHost.ts:45`、`canvasProjectService.ts:51` 已改。
4. **图片文档的 `isShown`（小问题）**：这次不改，理由如下。
   - 核实结果属实：工具区隐藏、图片工具仍是当前工具时，编辑器保持挂载，`isShown` 为 true，释放被拒。
   - 不改的原因：`ImageMarkTool` 不订阅会话结束。隐藏挂载时释放，V3 实例（`views>0`、自己的保存队列）仍会往工作副本写，界面也不会退回列表。要安全收尾，得改 V3 实例和编辑器的生命周期，风险超出这次范围。
   - 这不是死路：助手可以 `open_application_surface('tool.image_edit')`（只切工作区）后再 `close_application_surface('tool.image_edit')`，编辑器卸载后就能删。
5. **画布界面批量写入不占租约（小问题）**：问题属实。
   - 原因：`runCanvasTransaction` 不带 runtime 时只暂停自动保存。批次在等异步步骤时用户切走画布页，新的释放（以及原有的离开流程）就可能在批次中途关闭会话。
   - 修法：不带 runtime 时整批占一份 `leaseCanvasProject` 租约，在 finally 中释放。占租约失败（画布正在关闭）时按 `ApplicationPreflightFailure` 报告，属于“未执行”，不会被记成“结果未知”。
6. **测试**
   - 口播新测试改为直接登记 `applicationDomain` 导出的 `audioEditCurrentDocument`，正式登记的也是同一个函数。镜头参考同样导出了 `cameraStageCurrentDocument`。
   - 第 1 条补了测试：画布页显示时删除节点编辑器的文档被拒，切走后删除成功且编辑器关闭。
   - 第 2 条补了测试：工具区切走时删除成功，编辑器记录回到列表，回到工具页后不再算前台。

## 审查第二轮后的收尾

第二轮审查没有重要问题，四处小问题处理如下。

1. **画布正在离开时，界面写入被拒绝**
   - 问题：拿不到租约时，不带 runtime 的界面写入会被拒绝。界面卸载时发出的收尾写入（全景快照、图层回写等）可能因此丢掉，或抛出未捕获的错误。
   - 修法：拿不到租约时不占租约、照常执行，与原来的行为一致，也不会把内部代码显示给用户。
2. **给批量占租约补测试**：`canvasBatchService.test.ts` 新增一条：批次在异步步骤中途时释放被拒；批次抛错后租约归零，之后可以释放。
3. **镜头参考切换文档时闪一下列表**
   - 原因：第一轮修正把“编辑器记录退回列表”放在实例拆除时做。切换文档要先离开旧文档，拆除旧实例时就先退回了列表，等新文档读完才进编辑器。
   - 修法：这一步从拆除移到 `releaseCameraStageProjectInstance` 里，只在后台释放时退回列表。界面自己离开（返回、切换文档）由界面决定去向。这是改动最小的一种。
   - 嵌入的节点编辑器仍在拆除时关闭，不受影响。
   - 第一轮补的“工具区切走后删除，编辑器记录回到列表”测试走的就是释放这条路，照常通过。
4. **复跑**：以下 6 个文件 90 项全部通过：
   - currentDocumentContext
   - canvasBatchService
   - cameraStageProjectRuntime
   - canvasProjectRuntime
   - audioEditProjectInstances
   - documentOperations

## 改动文件

- `src/features/documents/currentDocumentContext.ts`
- `src/features/documents/documentOperations.ts`
- `src/features/audioEdit/application/audioEditProjectInstances.ts`
- `src/features/audioEdit/store/audioEditStore.ts`
- `src/features/canvas/application/canvasProjectInstances.ts`
- `src/features/cameraStage/application/cameraStageProjectRuntime.ts`
- `src/core/application-control/domains/documents/documentsApplicationCapabilities.ts`
- 审查后新增：
  - `src/features/documents/index.ts`
  - `src/features/canvas/application/cameraStageNodeEditor.ts`
  - `src/features/canvas/application/applicationDomain.ts`
  - `src/features/canvas/application/canvasBatchService.ts`
  - `src/features/canvas/application/canvasProjectService.ts`（注释）
  - `src/features/cameraStage/application/applicationDomain.ts`
  - `src/features/audioEdit/application/applicationDomain.ts`
  - `src/features/application-control/localApplicationHost.ts`（注释）
- 测试：
  - `src/features/audioEdit/application/audioEditProjectInstances.test.ts`：新增本缺陷的复现测试。编辑器 store 还记着这份文档、但导航已切到工具首页时，删除成功；删除前写完修改、实例已释放、store 回到列表。前台编辑时拒绝。
  - `src/features/documents/documentOperations.test.ts`：新增测试，前台文档即使工具肯释放也拒绝。
  - `src/features/cameraStage/application/cameraStageProjectRuntime.test.ts`：“正在展示”改由前台判断。
  - `src/features/audioEdit/AudioEditApp.subscription.test.tsx`：去掉已删函数的 mock；顺带修了一个原有的红测试。提交 3105bee83 在组件里加了 `flushAudioEditProject(...).then`，mock 没跟着改。

## 同类排查范围

| 文档类型 | 死路？ | 处理 |
|---|---|---|
| audio_edit | 有（本次报告的） | 已修 |
| camera_stage | 有：切到工具首页后附着仍在，释放被拒 | 已修 |
| canvas | 有：切到别的工作区后附着仍在，释放被拒；工作区又不能 close | 已修 |
| image_document | 工具区隐藏、图片工具仍挂载时会拒绝，但有出路：先打开再关闭 `tool.image_edit` | 未改，理由见“审查第一轮后的修正”第 4 条 |
| camera_stage（画布节点全屏编辑器） | 审查发现的回归：不算前台 | 已修，登记为嵌入编辑器 |
| video_edit | **有，未修**：`releaseVideoEditDocument` 在 `activeId === id` 时拒绝；切到别的工作区后 `activeId` 仍在，工作区又不能 close | 文件在 `src/features/videoEdit/application/**`，按约束不能改 |

video_edit 的修法和另外三种一样：删掉 `videoEditService.ts:1281` 的 `|| activeId === id`，前台判断已经由通用层的 `isForegroundDocument` 负责，同时改 `videoEditProjectDocuments.test.ts:141` 的断言。改之前要确认一件事：dispose 把 `activeId` 切到 `instances.keys().next()`，剪辑页回来时会显示另一份已打开的剪辑或列表，需要验证这符合预期。

项目删除 `trashProject` 走同一个 `releaseBackground`，一并受益（video_edit 除外）。核对读取后的释放（`localApplicationHost.releaseReviewOpened`）也走这里，只放读取期间新打开的文档，行为不变，原有测试通过。

## 撤销回执 CONFLICT（14→17）

结论：根因在剪辑领域，这次没修（文件在禁止修改的 `videoEdit/application/**`）。

- 剪辑实体的 revision 作用域 `video_edit` 取的是 `videoEditDomainRevision()`。这是 `videoEditService.ts` 里一个全局计数器，`publishVideoEdit(true)` 和 `publishVideoEditDomain()` 都会让它加一。
- 会让它加一的不只是文档写入，还有这些：
  - 打开、关闭任意剪辑：`videoEditService.ts:1075/1088`
  - 序列切换、播放头回到开头：`:528/540`
  - 原素材监视器：`videoEditSource.ts`
  - 代码存储：`videoEditCodeStorage.ts`
  - 预设和样式库加载：`videoEditExportPresets.ts` / `videoEditStyleLibrary.ts` / `videoEditTextPresets.ts` / `videoEditPresetPreferences.ts`
  - 会话改名：`:1080`
  - 只改空间信息的提交：`:766`
- 撤销回执按作用域 revision 严格核对（`registry.ts:115-121`）。所以关轨之后，验收期间的播放、打开工程、加载库等非文档事件把计数推到了 17，撤销就报 CONFLICT。
- 建议：让 `video_edit` 作用域只随文档内容变化，比如按文档实例的内容版本（`contentVersion` 或 `document.revision`）计，视图和库的变化另开作用域。这和另一个子代理的改动范围重叠，交给负责 videoEdit/application 的人处理。

## 验证

审查后复跑：
- 以下 8 个文件 93 项全部通过：
  - cameraStageProjectRuntime
  - audioEditProjectInstances
  - documentOperations
  - currentDocumentContext
  - canvasBatchService
  - canvasProjectRuntime
  - AudioEditApp.subscription
  - localApplicationHostReviewRelease
- `check:application-control-coverage` 通过。
- `tsc --noEmit` 通过。

首轮：

- `npx vitest run` 跑了这些文件，全部通过（共 85 项，第一次的两处失败修正后复跑通过）：
  - audioEditProjectInstances
  - AudioEditApp.subscription
  - documentOperations
  - currentDocumentContext
  - cameraStageProjectRuntime
  - canvasProjectRuntime
  - localApplicationHostReviewRelease
  - workspaceTransfer
- `check:application-control-coverage`（15 项）、`check:application-control-invariants`（251 项）通过。
- `check:assistant-capabilities:structure` 失败，原因与本次无关：`src/workspaces/GenerationWorkspace/hooks/resultSelection.ts` 的 store 没有建账。这是 main 上 64a776803 带进来的。
- `tsc --noEmit` 通过。

## 未验证

- 没有在真实窗口复现，按约束不碰开发版。
- 画布切回工作区后回到列表、镜头参考切回工具页后回到列表，这两处依赖原有订阅和恢复逻辑，没有新增界面测试。
- video_edit 的死路仍在，见上表。
- `trashProject` 原有的顺序没变：逐份请工具释放，遇到释放不了的才报 `ProjectInUseError`。所以项目最终没删成时，前面那些只在后台持有的文档已经被保存并关闭。现在前台编辑的文档（含节点编辑器）不会被释放，被关掉的只是后台文档，下次访问会重新打开，不丢数据。
- 第二轮收尾的改动（批量写入拿不到租约时照常执行、镜头参考退回列表改到释放路径）之后没有再跑 `tsc`。
