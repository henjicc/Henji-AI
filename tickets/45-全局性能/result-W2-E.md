摘要 1：启动与页面重载不再把账本里全部未结记录逐条复核；只复核“从没自动复核过 / 复核后状态变了 / 可重读验证的目标文档保存过”的记录，跨会话只能核对回执的记录只自动试一次。
摘要 2：自动复核挪到界面空闲后（连续 5 秒没有上下文发布、没有宿主请求进出），逐条之间也等空闲；用户点开核对的路径、结账、付费、幂等与回执契约都没改。
摘要 3：账本记录只加一个可选 JSON 字段 `autoReview`，没有 SQLite 结构变化、没有迁移；“读取实体会常驻文档会话”已核实属实，修法需要改 `documentOperations.ts`（不在本任务范围），写在第 5 节。

# W2-E 结果：启动时重复复核账本（排查 P1）

## 1. 改动文件

- `electron/main/services/application-runtime/operationAutoReview.ts`（新）：自动复核的判定 `autoReviewDue` 与调度 `createOperationAutoReview`。
- `electron/main/services/application-runtime/operationAutoReview.test.ts`（新）：3 个用例，见第 6 节。
- `electron/main/services/application-runtime/operationStore.ts`：`OperationRecord` 加可选字段 `autoReview`；导出 `UNRESOLVED_OPERATION_STATES`，`unresolved()` 的 SQL 由它拼出（生成的 SQL 文本与原来逐字相同）。
- `electron/main/services/application-runtime/applicationHostBridge.ts`：加只读 `lastActivityAt`（注册、发布上下文、派发请求、收到回执时更新）。
- `electron/main/services/application-runtime/runtime.ts`：装配调度器，文档修订号从作品索引 `DocumentIndexStore.getDocument(id).revision` 取；运行时多导出 `autoReviewOperations(rendererEpoch)`。
- `electron/main/ipc/application-control.ts`：注册就绪时不再自己循环 `reviewOperation(record, false)`，改为 `void autoReviewOperations(input.rendererEpoch)`。

## 2. 新增字段与迁移

- `OperationRecord.autoReview?: { at: number; state: ApplicationOperationState; documentRevisions: Record<string, number> }`，存在 `application_invocations.record_json` 里。
- 只新增可选字段：旧程序 `JSON.parse` 后忽略它，所有 `{ ...record }` 写回路径会原样带着它；新程序读旧记录没有它，就当“从没自动复核过”，复核一次后补上。它只是省掉重复复核的记号，丢失或被旧版本忽略只会多复核一次，不参与结账、付费、幂等。
- 没有 DDL 变化，不加迁移、不升 `SQLITE_SCHEMA_VERSION`（升了会让旧程序打不开整个库，违背“只加可选字段不提高最低可读版本”）。`OperationRecord` 整体不是登记格式；`formats.ts` 里 sqlite 格式登记的子结构（origin、state、confirmation、付费几项）都没动，`check:persistence-compat` 通过（66 种格式无变化）。同类先例：`atomicPlacement`、`recoveryOperation` 也是未登记的可选字段。
- 记号用正式 `store.save` 写回整条记录（同步 get + save，中间没有异步空档），会刷新该行 `updated_at`；`updated_at` 只被每日额度预筛与界面付费收据清理使用，前者仍按每笔 `reservedAt` 判断，后者只清界面收据（它们本就不进 `unresolved()`），语义不受影响。

## 3. 自动复核的新触发条件

宿主注册就绪（`application:host:register` 且 `ready`）后调度一轮，同一时间只跑一轮；换了渲染会话的注册排在当前这轮之后，当前这轮发现会话变了就停。对 `unresolved()` 里的每条记录：

1. 没有 `autoReview` 记号，或记号里的状态和当前状态不同 → 复核。
2. 记号在、状态没变，且没有可重读的验证条件（`operationVerificationRecovery` 为空，例如跨会话、`rv=null` 的 unknown 记录）→ 不再自动复核。同一会话的回执会经 `complete` 直接结账，换过会话的回执不会再出现，所以只自动试一次，之后保持“待用户核对”。
3. 记号在、状态没变、有可重读的验证条件 → 只有写入目标与验证条件目标所在文档的已保存修订号（作品索引里的 `revision`）跟记号里不一样才复核。查不到文档的目标（设置、素材等）不参与，这类记录复核过一次就不再自动复核。

真正要复核的记录，复核前先等宿主安静：连续 `AUTO_REVIEW_QUIET_MS = 5000` 毫秒没有注册、上下文发布、请求派发或回执。首屏与文档恢复会接连发布上下文，复核自己的读取也算活动，所以第一条在恢复停下后才开始，后续每条之间也至少隔 5 秒。复核完写记号：当时状态 + 目标文档修订号（复核后取值，复核本身打开文档引起的保存也算进去）。

“范围修订号”没有采用：宿主上下文里的作用域修订号是渲染层内存计数，每次重载从头计，跨启动比较不了；文档的已保存修订号持久在作品索引里，才能回答“复核后目标改没改”。

## 4. 保证不变的既有行为

- 用户主动核对：`application:host:review` 的 `open` 仍调 `reviewOperation(record, true)`，不看记号，照旧先 `reconcileVerification`（回执 + 重读验证）再读目标、弹核对；用例 3 证明自动复核跳过的记录用户打开时仍发出完整读取并进入 `awaiting_user_confirmation`。
- `get_application_operation` / `review_application_operation`、写入前对 partial 目标的重读（`applicationToolDispatcher`）都不经过本调度，行为不变。
- `reconcileReceipt` / `reconcileVerification` / `complete` / `review` / `resolveReview`、`recoverPreflight`、`protectsUnknownOutcome`、`canReviewOperation`、付费授权与预算、幂等键与基线：一行没改。自动复核只决定“这次注册要不要调用 `reviewOperation(record, false)`”，调用本身和以前完全一样，不重放任何写入。
- 注册就绪时仍立刻 `publishReviews()`，待核对列表照常显示。
- 复核失败沿用原日志事件 `application.confirmation.restore_failed`。

## 5. “待确认”第 1 条：复核读取是否常驻文档会话

结论：属实，是后台会话常驻，但不是跨重载无限累积。

- 路径：`reviewOperation(record, false)` → `reconcileVerification` → 渲染层 `localApplicationHost.ts:113-117` → `engine.verifyRecovery` → `core/application-control/execution/verifier.ts:69` `registry.readEntity` → 各域 provider。读一份没打开的文档时直接后台打开并登记实例：剪辑 `videoEditReflection.ts:170/185/214/257` 调 `openVideoEditDocument(..., { focus: false })`；画布、口播、镜头参考、图片文档同理（`canvasProjectInstances.ts:290`、`audioEditProjectInstances.ts:219`、`cameraStageProjectRuntime.ts:196`、`imageDocumentRuntime.ts:285 ensureImageDocumentOpenInBackground`）。
- 这些后台实例没有用完即放的环节：各域的释放函数（`releaseVideoEditDocument`、`releaseCanvasProjectInstance` 等）只通过 `registerDocumentReleaser` 登记，而 `DocumentOperations.release` 是私有方法，只在移到回收站之类操作前调用；画布租约归零也只关 `closeWhenIdle` 里的（用户离开时还有任务的）实例。所以复核打开的文档会一直留到渲染层重载或退出，期间占内存，退出屏障 `prepareApplicationClose` 还要逐个 `commit('close')`。
- 787 次打开只对应 1 次关闭，主要是因为成功关闭根本不记日志（`documentSession.ts` 只有 `close.failed`，全仓没有 `documents.session.closed` 事件），而每轮复核都发生在新渲染会话里，旧会话随重载整体消失。P1 修完后每份文档最多在首次复核或修订号变化后被后台打开一次。
- 修法（需改 `src/features/documents/documentOperations.ts`，不在本任务所有权内，未动手）：
  1. `DocumentOperations` 把私有 `release(kind, id)` 公开为 `releaseBackground(kind, id)`（语义不变：各域释放函数已拒绝界面正在显示、有租约、导出中或正在离开的实例）。
  2. `src/features/application-control/localApplicationHost.ts` 在处理带 `recoveryVerification`、`recoveryOperation` 或 `reviewTarget` 的只读请求时，执行前记下 `getDocumentSessionRegistry().list()` 的 ID，结果组装完后对本次新登记的会话逐个 `releaseBackground(session.kind.id, session.id)`，记 `documents.session.background_release.completed/failed`。用户恰好同时打开同一份文档时释放函数会因“正在显示”拒绝，不会关掉用户的文档。
  3. 助手普通读取后台打开的文档是否也该用完即放，牵涉“后台修改后撤销仍归同一实例”的设计，需另行决定，不建议顺手改。

## 6. 验证

级别 L2（账本与恢复语义，主进程）。全部经 `tickets/45-全局性能/heavy.sh`：

- 新用例 `operationAutoReview.test.ts`（3 个，走正式运行时、宿主桥、内置核对派发与调度，只替换存储边界和作品索引）：
  1. 一条可重读验证的 partial（doc-a）+ 一条跨会话无条件的 unknown（doc-b）：第一次注册发 2 次读取（重读验证 + 回执核对）；新渲染会话再注册、修订号不变 → 0 次；两份文档修订号都变 → 只重读 doc-a 那条 1 次，回执那条不再试，记号记下新修订号。
  2. 注册后 8 秒内每秒发布一次上下文 → 0 次读取；安静后 → 1 次。
  3. 自动复核过、第二次注册 0 次的记录，用户 `reviewOperation(record)` 打开核对 → 发出 `get_current_application_context`（重读验证）+ `read_application_entity`，记录进入 `awaiting_user_confirmation`（review）。
- 红→绿：临时把 `autoReviewDue` 改成恒为 true、`quiet` 改成立刻返回（模拟原来每次注册立即全量复核）→ 3 个用例全部失败（第二次注册收到 2 次读取、发布上下文期间收到 1 次读取等）；单独去掉“无验证条件只试一次”那行 → 用例 1 第三段失败（收到 2 次而非 1 次）；恢复后 3 个全部通过。
- `npx vitest run` 精确文件：`operationAutoReview.test.ts`、`runtime.test.ts`、`applicationHostBridge.test.ts`、`operationCoordinatorReview.test.ts` → 4 文件 31 用例通过。
- 原生 SQLite：`npm run test:assistant-persistence -- electron/main/services/application-runtime/operationStore.test.ts` → 1 文件 57 用例通过、0 跳过（Electron 以 node 模式跑内存库，不启动应用，与开发实例无冲突）。
- `tsc -p tsconfig.electron.json --noEmit` 通过（含新测试文件）。
- 改动的 6 个文件 eslint（主进程缓存、`--max-warnings 0`）通过。
- `check:dependency-graph`、`check:main-imports`、`check:persistence-compat` 通过。
- 未跑：渲染层 tsc（本任务没有改 `src/**`，渲染层工程不包含 `electron/main/services`，跑了也证明不了什么）；`check:assistant-capabilities:structure`（没动能力声明、注册、schema 或调用面）。

## 7. 需要主会话真实验证的步骤

前提：用户真实资料目录（账本里那 32 条未结记录），`electron:bundle` 或开发版热更新到本次主进程代码。

1. 第一次启动（或页面重载），等界面完全空闲约 10 秒以上：
   - `npm run logs:query -- --event application.operation.auto_review.started` 应出现一次，`waitedMs` ≥ 5000，且时间晚于 `documents.reload_resume.completed`（冷启动没有这条时晚于最后一条 `documents.session.open.completed` 至少 5 秒）。
   - `application.operation.auto_review.completed` 一条：`reviewed` ≤ 32，`interrupted: false`。
   - 本轮 `mcp.read.start` 里 `capabilityId: get_current_application_context` 的条数 ≤ 32 条记录对应的读取（以前每轮约 30），`application.operation.verification_rechecked` ≤ 本轮可重读验证的记录数。
2. 不改任何文档，再重启一次：`application.operation.auto_review.completed` 应为 `reviewed: 0`、`skipped` 等于未结记录数；不应出现 `auto_review.started`，也不应有新的 `get_current_application_context`、`verification_rechecked`、复核引起的 `documents.read.completed` / `documents.session.open.completed`。
3. 可选：打开并保存账本里某条 partial 记录目标所在的剪辑，再重启：`reviewed` 应只为那份文档相关的条数。
4. 可选：在核对面板点开一条待核对记录，应照常读取目标并弹出核对（用户核对路径不受影响）。

## 8. 偏离

- “范围修订号”改用作品索引里的文档已保存修订号（原因见第 3 节末）。
- “推迟到首屏和文档恢复完成之后”用主进程侧的宿主空闲判断实现，没有接渲染层的恢复完成信号：恢复完成只在 `rendererReloadResume.ts` 里知道，不在本任务所有权内，而空闲判断同时覆盖冷启动恢复与之后的用户操作。
- 第 4 条只核实并写出修法，没有改代码（需改 `documentOperations.ts`）。
- 渲染层 tsc 与能力结构门禁未跑，理由见第 6 节。

## 9. 遗留

- 第 5 节的后台会话释放修法待有 `src/features/documents/**` 所有权的任务落地。
- 空闲判断是启发式：界面若一直在发布上下文（例如长时间播放、持续拖动、长时间生成进度），自动复核会一直推迟到停下为止；不影响用户手动核对，也不影响下一次启动。真实窗口里首屏恢复与 5 秒窗口的配合，要按第 7 节看日志确认。
- 复核打开文档时如果触发了延迟保存（例如去掉失效的素材库关联后写回），修订号会在记号写完后才变，下一次启动会对那条再复核一次，之后稳定。
