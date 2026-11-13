# 结果：走查修复（剪辑与文档）2026-11-13

按总调度中途收窄的范围交回：Q24 只做最保守的部分，Q25、Q22、Q14 做完；Q23、Q27、Q7、Q8 没开始，未做。未碰 git，未启动或重建应用。

## 做完的

### Q24 应用自动覆盖外部修改：提示、日志、助手读得到（部分）

- 根因：`documentSession.ts` 的 `promptConflict` 在 2026-10-29 `fd3da8e30`（安全分级第 5 批“去掉可恢复操作的确认”）里，由“弹窗选重新载入 / 覆盖”改成直接 `resolveConflict('overwrite')`。当时的理由：存储层覆盖前先 `preserveFile` 把磁盘版本放进“最近删除”，可以恢复，所以不再确认。问题是覆盖之后没有任何人知道。四种文档共用这一条路：剪辑、口播、画布走 `repository.save` 的 force 分支；图片文档在写回整包时冲突（`imageDocumentPersistence`），也落到同一个会话自动覆盖，由 `image-document-service` 备份。
- 改法（保留“以应用内为准并备份磁盘版本”的做法，只补上告知）：
  - `DocumentSession` 自动覆盖成功后在会话状态里记下 `externalOverwrite { at, count }`，写 warn 日志 `documents.session.conflict.overwritten`，并调用新的 `onExternalOverwrite` 回调。
  - `documentSessionRegistry` 把回调接到现有通知 `notifyUser`（warning 档 `UiToast`）：“「名称」在别处有更新的版本，已按应用里的内容保存；别处的版本可在“最近删除”恢复”，带“查看最近删除”动作，打开设置 → 文件与下载 → 数据目录分区。中英文案都进了 `ui.notifications`。
  - 助手两条读法，内置与外部同源：
    1. 文档实体新增只读属性 `documents.document.external_overwrite`：没发生过时为空字符串，发生过时是一句说明（时间、次数，被覆盖的版本在“最近删除”、可用 `settings.deleted_item` 恢复）。
    2. 事务回执：`ApplicationPersistenceReceipt` 新增可选 `evidence`，引擎在提交与撤销的完成回执里并入 `evidence`。documents 领域登记一个不写入的保存参与者 `documentOverwriteReceiptParticipant`（`confirmLast: true`，`withApplicationPersistenceBoundary` 把这类参与者排在其他参与者之后开始和确认）。如果某份打开的文档在这次事务保存时覆盖了外部修改，回执里就带上一条 `operation_result` 说明。
- 契约：只新增可选的只读属性和回执里多出的 evidence 条目（evidence 本来就在回执契约里）。没有不兼容变化，大版本仍是 4。落盘格式没动。
- 没做（按收窄要求，留待开工后定）：
  - **(1) 没有未保存修改时自动重载磁盘新版本**。方案：主进程按打开文档监听文件，或在窗口获得焦点、保存前核对磁盘版本号；会话干净时在保存队列里 `reload()`。风险：剪辑的 `receiveContent` 会取消进行中的手势（拖动时 `getContent` 写的是手势前的内容，会话并不脏），并清空撤销栈，用户之前做的、已保存的步骤都不能再撤销，助手手里的 undoRef 也会失效；文件监听还要排除自己的写入（在保存队列里比较版本号）。建议只在获得焦点时核对，有手势进行中就延后，并在提示里说明“撤销记录已重置”。
  - **(3) 命令行一侧检测“应用正开着同一份文档”并在回执里警告，以及转交给应用执行**。现在没有跨进程的“哪个进程开着哪份文档”信息：命令行占用标记只反映命令行进程，主应用不留标记。要做需要：主应用渲染层把打开的文档 ID 报给主进程，写 `<程序目录>/open-documents/<pid>.json`；命令行在上面的参与者里查询自己刚保存的文档是否也被别的活进程打开，命中就把 `verification` 标成未通过并说明。这需要新增一条 documents IPC，涉及契约、preload、适配器、测试替身约 7 个文件。转交执行需要命令行作为客户端连上主应用常驻的 MCP 服务并带连接凭据，工作量更大。目前只能在走查报告里提醒：应用开着同一份文档时，不要用命令行或外部工具改它。

### Q25 无窗口命令行：入口处明确拒绝取帧与导出，不启动空闲预渲染

- 根因：命令行无窗口运行时主进程关了显卡（`disable-gpu`），渲染层不知道自己在无窗口模式里。取帧和导出一直跑到第 0 帧才以渲染错误失败，助手把它归成了显卡故障。空闲预渲染调度也照常启动。
- 改法：主进程在无窗口模式下设置 `HENJI_HEADLESS_WINDOW=1`，界面进程继承这个变量；preload `runtimeInfo.headlessWindow` 把它交给渲染层，渲染层经 `src/platform/runtime.ts` 的 `isHeadlessWindow()` 读取。新增 `videoEditHeadlessGuard.ts`，拒绝时用 `ApplicationPreflightFailure`（写入前拒绝，不会被记成“结果未知”），文案说明：“当前是无窗口模式……请在打开的痕迹AI 窗口里执行，或加 --visible……这不是显卡或驱动故障，什么也没有执行。”守卫接在三处入口：
  - `observeVideoEditFrame`（取帧的共用入口，标注截图等调用方也在内）
  - `export_video_edit`：字幕和纯声音（aac/wav）导出放行
  - `render_video_edit_preview`
  - 空闲预渲染的 `ensureAutoRender` 在无窗口模式下直接不启动。
- 契约：没变。命令行转交给应用执行没做，原因同 Q24 (3)。

### Q22 导出查询回执带文件路径

- 根因：`query_video_edit_export` 的精简投影只挑了 `assetRef`，内部条目其实有 `path`。
- 改法：精简投影和输出 schema 加上 `path`，与开始导出回执里 `queue[].path` 同名；能力说明补了一句“完成后 path 是成片文件的本机绝对路径”。契约只新增可选输出字段。

### Q14 `place_video_edit_creative_result` 两种文档引用都认

- 根因：`result.documentRef` 只接受 `documents.document`，但口播能力读回的是 `audio_edit.document`；两者 id 相同，处理器也只用 id。
- 改法：`kind` 改为 `documents.document | audio_edit.document`，写错时报错里点名期望的两种写法；`acceptsRefs` 补上 `audio_edit.document`。契约是输入放宽，兼容。

## 没做（没开始，按收窄要求不做）

- Q23 批量 exports 时顶层 `range` 作为各项默认值
- Q27 口播链接刷新后素材库多出一项的核对
- Q7 `create_document(video_edit)` 新建剪辑没有序列
- Q8 MCP `notifications/tools/list_changed`
- Q24 的 (1) 自动重载和 (3) 命令行侧检测或转交（方案与风险见上）

## 改动文件

- `src/features/documents/documentSession.ts`、`documentSessionTypes.ts`、`documentSessionRegistry.ts`、`documentSession.test.ts`
- `src/features/documents/application/documentsFields.ts`、`documentsReflection.ts`、`applicationDomain.ts`、`documentOverwriteReceipt.ts`（新）
- `src/core/application-control/execution/persistence.ts`、`engine.ts`
- `src/i18n/locales/zh-CN/ui.json`、`src/i18n/locales/en-US/ui.json`
- `electron/main/index.ts`、`electron/preload/index.ts`、`electron/preload/api.d.ts`、`src/platform/runtime.ts`
- `src/features/videoEdit/application/videoEditHeadlessGuard.ts`（新）、`videoEditHeadlessGuard.test.ts`（新）、`videoEditFrameObservation.ts`、`videoEditExportCapability.ts`、`videoEditRenderCacheCapability.ts`、`videoEditRenderCache.ts`
- `src/core/application-control/domains/videoEdit/videoEditExportCapabilities.ts`、`videoEditApplicationCapabilities.ts`、`videoEditCreativeResultRef.test.ts`（新）

## 验证

- 渲染层 tsc（经 heavy.sh）：0 错误
- 主进程 tsc：0 错误
- 改到文件的 eslint：通过
- 精确测试全部通过：
  - `documentSession.test.ts` 15 条，新增“冲突时覆盖并留下记录、通知”
  - `videoEditHeadlessGuard.test.ts` 1 条
  - `videoEditCreativeResultRef.test.ts` 1 条
  - 公共保存边界与引擎回归 `persistence.test.ts`、`engine.test.ts`、`applicationHarness.canvasPersistence.test.ts`、`applicationHarness.close.test.ts`、`documentsReflectionResult.test.ts` 共 47 条
- `check:assistant-capabilities:structure`：仍报一条失败，“store 未建账且未登记原因：`src/workspaces/GenerationWorkspace/hooks/resultSelection.ts`”，是别人未提交的文件，不是本次改动。本次改动引起的那条（公共注册器直接依赖业务实现）已改为从 documents 领域模块装配，复跑后消失。

## 待真实窗口验证

1. 应用开着一份剪辑且没有未保存修改。在命令行用 `assistant:cli` 改同一份剪辑。回到应用随手改一处，等自动保存。核对：
   - 弹出覆盖提示，“查看最近删除”能打开设置并看到被覆盖的版本、可以恢复
   - 日志有 `documents.session.conflict.overwritten`
   - `read_application_entity` 读 `documents.document.external_overwrite` 得到一句说明
2. 外部助手在同样情形下发起一次剪辑事务，核对完成回执的 `evidence` 里有“覆盖了别处修改”这一条。
3. `assistant:cli` 里取帧、导出视频、`render_video_edit_preview`：核对立即被拒并返回无窗口模式的说明；运行期间日志里没有 `video_edit.render_cache.auto_start`。
4. 导出完成后 `query_video_edit_export` 的 `queue[].path` 是成片文件路径。
