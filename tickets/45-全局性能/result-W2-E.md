摘要 1：启动或页面重载时不再逐条复核全部未结记录。只复核“从没读完过 / 读完后状态变了 / 目标所在文档之后保存过、被删或找不到”的记录；读取没真正完成（超时、出错、中途换会话）就不记记号，下次注册再试。
摘要 2：自动复核挪到界面空闲后（连续 5 秒没有上下文发布、没有宿主请求进出），每条之间也等空闲；用户点开核对、结账、付费、幂等与回执契约都没改。账本记录只加可选 JSON 字段 `autoReview`，没有 SQLite 结构变化与迁移。
摘要 3：“核对读取会在后台常驻打开文档”属实，已修：核对读取期间新打开、且没有被界面、租约或任务占着的文档会话读完即交给各工具的后台释放；用户开着的文档不受影响。

# W2-E 结果：启动时重复复核账本（排查 P1）

## 1. 改动文件

主进程：
- `electron/main/services/application-runtime/operationAutoReview.ts`（新）：自动复核的判定 `autoReviewDue` 与调度 `createOperationAutoReview`。
- `electron/main/services/application-runtime/operationAutoReview.test.ts`（新）：5 个用例，见第 7 节。
- `operationStore.ts`：`OperationRecord` 加可选字段 `autoReview`；导出 `UNRESOLVED_OPERATION_STATES`，`unresolved()` 的 SQL 由它拼出（生成的 SQL 文本与原来逐字相同）。
- `operationStore.test.ts`（原生 SQLite 清单内）：加一条记号往返用例。
- `applicationHostBridge.ts`：加只读 `lastActivityAt`（注册、发布上下文、派发请求、收到回执时更新）。
- `applicationToolDispatcher.ts`：`reconcileVerification` 返回发出的核对读取是否都拿到成功回复（重读验证还要带回验证结果）；原有调用方不看返回值，行为不变。
- `runtime.ts`：`reviewOperation` 返回“回执与重读验证是否真正读完”（没有异常、宿主都回复成功、期间没换渲染会话）；装配调度器，文档修订号从作品索引 `DocumentIndexStore.getDocument(id)` 取，找不到文件（`missing`）按不在处理；运行时多导出 `autoReviewOperations(rendererEpoch)`。
- `electron/main/ipc/application-control.ts`：注册就绪时改为 `void autoReviewOperations(input.rendererEpoch)`。

渲染层（第 5 节授权）：
- `src/features/documents/documentOperations.ts`：私有 `release` 公开为 `releaseBackground(kind, id)`，语义不变，两处原调用方随之改名。
- `src/features/application-control/localApplicationHost.ts`：核对读取后释放本次新开的会话。
- `src/features/application-control/localApplicationHostReviewRelease.test.ts`（新）：1 个用例。

## 2. 新增字段与迁移

- `OperationRecord.autoReview?: { state: ApplicationOperationState; documentRevisions: Record<string, number> }`，存在 `application_invocations.record_json` 里。只在一次自动复核真正读完后写：读完时的状态，以及目标所在文档的已保存修订号。
- 只新增可选字段：旧程序 `JSON.parse` 后忽略它，所有 `{ ...record }` 写回路径原样带着它；新程序读旧记录没有它，就当“从没读完过”。它只是省掉重复复核的记号，丢失或被旧版本忽略只会多复核一次，不参与结账、付费、幂等。
- 没有 DDL 变化，不加迁移、不升 `SQLITE_SCHEMA_VERSION`（升了会让旧程序打不开整个库，违背“只加可选字段不提高最低可读版本”）。`OperationRecord` 整体不是登记格式；`formats.ts` 里 sqlite 格式登记的子结构都没动，`check:persistence-compat` 通过。同类先例：`atomicPlacement`、`recoveryOperation` 也是未登记的可选字段。往返由原生 SQLite 用例证明（第 7 节）。
- 记号用正式 `store.save` 写回整条记录（同步 get + save，中间没有异步空档），会刷新该行 `updated_at`；`updated_at` 只被每日额度预筛与界面付费收据清理使用，前者仍按每笔 `reservedAt` 判断，后者只清界面收据（本就不进 `unresolved()`），语义不受影响。
- 媒体回收：v27 触发器 `application_invocations: singleJsonV27('record_json')` 在 record_json 变了、且旧值像是含路径时让一个候选入队。记号不带时间戳，只在“到期的记录真正读完”后写，而到期本身就意味着状态或文档修订号集合跟旧记号不同，所以不会写出内容没变的记号，没有无谓写入。但对本身含路径的记录（导出、网页重演等），每次写记号仍会像其他任何账本保存一样入队一个候选，避免不了：首次升级后最多每条未结记录一次，之后只在目标文档变化后再有。

## 3. 自动复核的触发条件

宿主注册就绪后调度一轮，同一时间只跑一轮；换了渲染会话的注册排在当前这轮之后，当前这轮发现会话变了就停。对 `unresolved()` 里的每条记录：

1. 没有记号，或记号里的状态和当前状态不同 → 复核。
2. 否则只看目标所在文档的已保存修订号：写入目标（`targetRefs`）与验证条件目标所在文档，修订号集合跟记号里的不一样（文档保存过、被删除、找不到或重新找到）→ 复核；一样 → 跳过。只能核对回执的记录也一样按修订号判断（放入结果这类回执是从已保存的剪辑里重建的，剪辑保存后才拿得到）。
3. 引用 → 文档：各领域的引用解析函数都在渲染层领域模块里（如 `videoEditRefs.ts`、`imageEditDocumentRefs.ts`），主进程不能引用，也没有现成的跨层解析注册表。这里把引用 ID 按 `:` 分段逐段解码，只认作品索引里确有的文档 ID，不按位置猜：剪辑、画布 `文档:子对象` 取到第一段，图片编辑 `v3:编码后的文档ID:图层` 跳过 `v3` 取到解码后的第二段。取不到文档的目标（设置、素材、模型等）没有已保存修订号可比，这类记录读完一次后只在状态变化时再自动复核，其余留给用户在核对界面打开。
4. 真正要复核的记录，先等宿主安静：连续 `AUTO_REVIEW_QUIET_MS = 5000` 毫秒没有注册、上下文发布、请求派发或回执；复核自己的读取也算活动，所以每条之间至少隔 5 秒。
5. `reviewOperation(record, false)` 返回是否真正读完：有异常（超时、取消、宿主断开）、任何一次读取回复 `ok` 不是 true、重读验证没带回验证结果、或期间渲染会话换了 → 没读完，不写记号，计入日志 `incomplete`，下次注册再试。读完才写记号（读完后的状态 + 读完后取的修订号，复核打开文档引起的保存也算进去）。

“范围修订号”没有采用：宿主上下文里的作用域修订号是渲染层内存计数，每次重载从头计，跨启动比较不了；文档的已保存修订号持久在作品索引里。

## 4. 保证不变的既有行为

- 用户主动核对：`application:host:review` 的 `open` 仍调 `reviewOperation(record, true)`，不看记号，照旧先核对回执与重读验证，再读目标、弹核对（用例证明自动跳过的记录用户打开时仍完整读取并进入 `awaiting_user_confirmation`）。
- `get_application_operation` / `review_application_operation`、写入前对 partial 目标的重读都不经过本调度；`reconcileVerification` 新增的返回值它们不看。
- `reconcileReceipt` / `reconcileVerification`（协调器）/ `complete` / `review` / `resolveReview`、`recoverPreflight`、`protectsUnknownOutcome`、`canReviewOperation`、付费授权与预算、幂等键与基线：没改。自动复核只决定“这次注册要不要调用 `reviewOperation(record, false)`、读完后记不记记号”，不重放任何写入。
- 注册就绪时仍立刻 `publishReviews()`；复核失败沿用原日志事件 `application.confirmation.restore_failed`。

## 5. 核对读取常驻文档会话（排查“待确认”第 1 条）

核实结论：属实。`reviewOperation` → `reconcileVerification` → 渲染层 `localApplicationHost.ts` 的 `verifyRecovery` → `core/application-control/execution/verifier.ts` 的 `registry.readEntity` → 各域 provider；读一份没打开的文档时直接后台打开并登记实例（剪辑 `videoEditReflection.ts` 的 `openVideoEditDocument(..., { focus: false })`，画布、口播、镜头参考、图片文档同理）。这些后台实例只有移到回收站前才会被释放，读完一直留到渲染层重载或退出，占内存，退出屏障还要逐个 `commit('close')`。成功关闭本来就记日志（`documentSession.ts` 的 `end()` 记 `documents.session.closed` / `documents.session.discarded`，带 docId 与 kind），所以“787 次打开只对应 1 次关闭”确实说明这些会话没被关过。（本文件上一版写“全仓没有 `documents.session.closed` 事件”是错的：事件名由 `documents.session.${reason}` 拼成，搜索没搜到。）因此不另加关闭事件，免得同一件事记两条。

修法（已实现）：
- `DocumentOperations.releaseBackground(kind, id)`：原私有 `release` 公开。各工具登记的释放函数会拒绝界面正在显示、有租约、导出或其他任务进行中、正在打开或离开的实例；释放后会话仍在也按“仍在使用”处理。
- `localApplicationHost.ts`：只读请求带 `recoveryVerification`、`recoveryOperation` 或 `reviewTarget` 时，开始前记下已登记的会话 ID。读取期间只要有别的请求开始或已在执行，就标为“共享”，不释放（分不清是谁打开的，助手写入后台打开的文档要留着，撤销还归它）。读取结束、没被共享、宿主没卸下时，对读取期间新登记的会话逐个 `releaseBackground`，记 `documents.session.review_release.completed`（`opened`、`released`）；出错记 `documents.session.review_release.failed`。
- 用户开着的文档：开始前就登记过的不在释放范围；读取期间用户恰好打开的，正在显示的由工具拒绝。剩余风险：读取那一两秒内，用户先后打开两份同类文档、第一份已经不在前台，这份可能被当成核对读取打开的而关掉（修改会先写完，不丢内容）；自动复核本身只在界面安静 5 秒后才发读取，实际很难碰上。

## 6. 第一轮审查返工

1. 必须改：只在读完时写记号。`reviewOperation` 与 `ApplicationToolDispatcher.reconcileVerification` 改为返回是否读完（见第 3 节第 5 条）；超时、出错、宿主回复失败、中途换渲染会话都不写记号，下次注册再试。
2. 只能核对回执的记录（含 `atomicPlacement`）也按目标文档修订号判断，去掉了“没有验证条件就不再自动复核”的分支；第 1 个用例第三段改为两条都重新读取。
3. 引用 → 文档 ID 不再取第一段：逐段解码、只认作品索引里的文档 ID（理由见第 3 节第 3 条）。用例用图片编辑引用 `v3:%E5%9B%BE%E7%89%87%20b:layer` 证明取到“图片 b”。
4. 补了“状态变了再复核一次、文档被删后再复核一次、之后不重复”的用例，以及原生 SQLite 账本往返用例（已在 Electron 原生运行器跑过，见第 7 节）。
5. 媒体回收入队：见第 2 节最后一条；记号去掉了时间戳，不会写出内容没变的记号，含路径的记录每次真正写记号仍会入队一个候选，已记录。

## 7. 验证

级别 L2（账本与恢复语义、跨主进程与渲染层）。全部经 `tickets/45-全局性能/heavy.sh`：

- `operationAutoReview.test.ts`（5 个，走正式运行时、宿主桥、内置核对派发与调度，只替换存储边界和作品索引）：
  1. 可重读验证的 partial（剪辑 doc-a）+ 只能核对回执的 unknown（图片编辑“图片 b”）：第一次注册 2 次读取；新会话再注册、修订号不变 → 0 次；两份文档都保存过 → 两条各再读一次，记号记下新修订号。
  2. 一条记录状态变了、另一条的文档被删 → 各再读一次（删掉的文档从记号里去掉）；再注册 → 0 次。
  3. 宿主回复失败 → 不写记号；读取途中页面重载、读取在新会话补发读完 → 不写记号；之后正常读完才写。
  4. 注册后 8 秒内每秒发布一次上下文 → 0 次读取；安静后 → 1 次。
  5. 自动复核过、第二次注册 0 次的记录，用户打开核对 → 重读验证 + `read_application_entity`，进入 `awaiting_user_confirmation`（review）。
- `localApplicationHostReviewRelease.test.ts`（正式宿主桥 + 正式渲染层宿主 + 测试文档仓库）：一份关闭的剪辑、一份用户开着的剪辑，带两条 `entity_exists` 条件重读验证 → 验证通过；读完后已登记会话回到读取前（只剩用户那份），用户那份实例与会话都没结束。
- 红→绿：
  - 首轮：`autoReviewDue` 恒为 true、空闲等待立刻返回（模拟原来每次注册立即全量复核）→ 当时 3 个用例全红；恢复后全绿。
  - 返工：读完与否都写记号 + 文档 ID 只取第一段 → 用例 1（图片编辑记号）与用例 3 红；去掉“期间没换渲染会话”判断 → 用例 3 红；恢复后 5 个全绿。
  - 会话释放：`localApplicationHost.ts` 改动前跑新用例 → 红（读完后会话为 `doc-2, doc-4`，期望只剩 `doc-4`）；改后绿。
- 精确测试文件：`operationAutoReview.test.ts`、`runtime.test.ts`、`applicationHostBridge.test.ts`、`operationCoordinatorReview.test.ts`、`localApplicationHostReviewRelease.test.ts`、`videoEditRuntimeRegression.test.ts`、`documentOperations.test.ts` → 7 文件 58 用例通过。
- 原生 SQLite（Electron 以 node 模式跑内存库，不启动应用，与开发实例无冲突）：`npm run test:assistant-persistence -- electron/main/services/application-runtime/operationStore.test.ts src/features/application-control/mcpWriteIntegration.test.ts` → 2 文件 63 用例通过、0 跳过。
- `tsc -p tsconfig.electron.json --noEmit` 与 `node --max-old-space-size=12288 node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` 均通过（中途一次各有 1 个错误，分别在别的执行者正改的 `video/proxy.test.ts` 与 `videoEditProgramPool.ts`，等一会儿重跑已全部通过）。
- eslint：主进程 8 个改动文件（主进程缓存）与渲染层 3 个改动文件，`--max-warnings 0` 通过。
- `check:dependency-graph`（渲染层改为经 `@/features/documents` 入口导入后通过）、`check:main-imports`、`check:persistence-compat` 通过。
- 未跑 `check:assistant-capabilities:structure`：没动能力声明、注册、schema 或调用面。

## 8. 需要主会话真实验证的步骤

前提：用户真实资料目录（账本里那 32 条未结记录），运行产物含本次主进程与渲染层代码。

1. 第一次启动（或页面重载），等界面完全空闲约 10 秒以上：
   - `npm run logs:query -- --event application.operation.auto_review.started` 出现一次，`waitedMs` ≥ 5000，时间晚于 `documents.reload_resume.completed`（冷启动没有这条时，晚于最后一条 `documents.session.open.completed` 至少 5 秒）。
   - `application.operation.auto_review.completed` 一条：`reviewed + incomplete` ≤ 32，`interrupted: false`。
   - 本轮 `mcp.read.start`（`capabilityId: get_current_application_context`）≤ 32 条记录对应的读取（以前每轮约 30）。
   - 每次核对读取打开了文档之后，应有 `documents.session.review_release.completed`，以及对应的 `documents.session.closed`；复核结束后开着的文档只剩用户自己打开的。
2. 不改任何文档，再重启一次：`application.operation.auto_review.completed` 应为 `reviewed: 0`、`incomplete: 0`，`skipped` 等于未结记录数；没有 `auto_review.started`，也没有新的 `get_current_application_context`、`verification_rechecked` 和复核引起的文档读取或打开。若第一次有 `incomplete > 0`，第二次只应再试这些条。
3. 可选：打开并保存账本里某条记录目标所在的剪辑，再重启：`reviewed` 只为那份文档相关的条数。
4. 可选：在核对面板点开一条待核对记录，应照常读取目标并弹出核对。

## 9. 偏离

- “范围修订号”改用作品索引里文档的已保存修订号（理由见第 3 节末）。
- “推迟到首屏和文档恢复完成之后”用主进程侧的宿主空闲判断实现，没有接渲染层的恢复完成信号（只在 `rendererReloadResume.ts` 里有，不在本任务所有权内）。
- 引用 → 文档 ID 没有复用领域解析函数（都在渲染层，主进程不能引用），改为逐段解码后以作品索引确认（第 3 节第 3 条）。
- 没有新增“会话成功关闭”的日志事件：`documents.session.closed` 本来就有（第 5 节）。

## 10. 遗留

- 空闲判断是启发式：界面若一直在发布上下文（长时间播放、持续拖动、长时间生成进度），自动复核会一直推迟到停下为止；不影响用户手动核对，也不影响下一次启动。
- 目标文档在作品索引里、但这次就是读不出来（例如被别的程序锁着）时，渲染层验证器只返回 `verified: false`，和“读到了但值不对”区分不开（区分要改 `src/core/application-control/execution/verifier.ts` 的结果结构，或靠匹配报错文字），现在按“读完”处理；该文档下次保存过、被删或找不到再找到时会再复核一次，用户核对随时可做。
- 复核打开文档时如果触发了延迟保存（例如去掉失效的素材库关联后写回），修订号会在记号写完后才变，下一次启动会对那条再复核一次，之后稳定。
- 第 5 节的剩余风险：核对读取那一两秒内用户先后打开两份同类文档、第一份已不在前台时，可能被当作核对读取打开的而写完关闭。
- `agentEditDocumentIds`（`src/features/application-control/agentEditing.ts`）同样按第一段取文档 ID，对图片编辑引用会取到 `v3`，编辑提示标不到图片文档；不在本次范围，未改。
