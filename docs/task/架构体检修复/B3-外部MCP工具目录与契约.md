# B3：外部 MCP 工具目录与契约

工作区：`D:\VibeCode\henji-wt-b3`，分支 `codex/b3`。基于 `742267af`；只改工作区，由总管理者审查、提交。未执行 Git 写操作、依赖安装、Reality、应用启停或真实付费调用。

## 复核与修复

| 编号 | 复核 | 根因与处理 |
|---|---|---|
| r3① | 属实 | 五个外部三维写工具要求业务输入 `baseRevision`，处理器又比对 toolbox。删除公开输入中的该字段，处理器只用可信 `context.expectedRevisions`；既有宿主自动基线及严格 baselineIds 继续生效。同源内部 update 适配一起收口。冲突点名 `read_application_entity`、原 document/object 引用、`propertyIds=[]` 与返回的 baselineId。内部输出修订事实保留，不再作为写参数。 |
| r3② | 属实 | 场景应用已经保存，`changedRefs.max(1500)` 仍拒绝合法结果；输出 Zod 错误被归入 INVALID_INPUT。移除该输出数量限制及“500 项上限”失实描述。领域校验、完整数组及效果回执保留；声明 `pagedResultFields` 后，公开副本只给 resultCollections 数量、结果引用与起始 cursor。复用原调用者隔离的操作账本，通过 get_application_operation 的 resultField/cursor/limit 取完。输出契约错误独立分类为 CAPABILITY_REJECTED，保留 applied/notExecuted=false 和 replayMutation=false，明确禁止重新提交。只读输出失败不误称发生写入。 |
| r3③ | 属实 | 所有写工具重复付费确认说明，Zod 输入/输出默认展开复用节点。工具目录使用现有 Zod 原生 `reused: 'ref'`，每个 schema 局部 `$defs/$ref` 复用；两个 interpret 输入随之瘦身，无需改语义计划或其持久模型。共同付费流程只在契约 workflows 说明一次；实际可能付费的领域声明 mayRequirePaidConfirmation 或已有 paidGenerationPreparation 后保留一句指向。继续使用原 AJV 服务端输出校验。 |
| r3④ | 属实 | 十一个口播工具共用全可选参数包；六个剪辑操作和三个文本剪辑工具也有共享输入泄漏。由现有字段 pick/omit/required 派生精确 strict schema；cancel 的 taskId、口播导出的 destination、split 的 clipRef/frame、素材导入的 assetRef、文本插入的 frame 均公开为 required。口播 handler 使用同一派生 schema。 |
| r3⑤ | 属实 | 导出查询无分页、默认返回完整 settings。新增 detail=compact/full、activeOnly、cursor、limit；默认返回状态、进度、结果查询引用、素材引用与必要错误。活动任务不合并历史；按稳定 id 续取历史，cursor 绑定文档与筛选条件；full 才带设置、区间与预设。取消工具仍只接受 documentRef/taskId。 |
| r3⑥ | 属实 | 内部媒体授权调用公开 read 路径，完整读取并登记调用者拿不到的基线。改为 host.execute 的正式授权读取，propertyIds=[]，每块仍检查授权、存在性、取消及读取后连接状态；不走 rememberRead。 |
| r4①关联 | 属实，仅评估 | observe_application_surface 声明 internal，ApplicationHostBridge.tools 复用外部集合，Pi 也拿不到。建议另做内置可信调用者目录投影及宿主请求授权：保留 external internal 排除，显式内置身份、C2/privateAccess、用户内容外发同意、应用内截图范围与敏感遮罩、图像模态/附件校验及撤销授权检查。不能仅删 internal 或仅加 Pi 工具名。B4 先修技能指引；本批未开放截图，未改技能文件。 |

覆盖分级：现有能力契约修复及读取语义增量，复用正式实体、操作账本和领域处理器，不新增算法型业务工具，不新建数据库表。属于普通缺陷修复，未改助手通路台账。

## 目录计量与版本

与 r3 相同口径：正式声明生成全授权 170 个工具，包含外部技能工具；紧凑 JSON，`o200k_base` 离线分词。完整目录为 `{"tools":[...]}`；输入部分仍使用同一包装，仅保留 name/description/inputSchema。不是供应商计费量，也未声称所有客户端把 outputSchema 发给模型。

| 口径 | 改造前 | 改造后 | 变化 |
|---|---:|---:|---:|
| 完整目录字符 | 829,394 | 762,600 | -66,794 |
| 完整目录 UTF-8 字节 | 943,691 | 857,457 | -86,234 |
| 完整目录 tokens | 239,147 | 224,018 | -15,129（6.33%） |
| 名称、描述、输入 tokens | 108,070 | 92,826 | -15,244（14.11%） |
| 每个 interpret 输入 schema 字符 | 29,445 | 10,249 | -19,196 |
| 每个 interpret 完整工具项 tokens | 8,670 | 3,929 | -4,741 |

`EXTERNAL_CONTRACT_VERSION` 从 **2.4.2 → 2.5.0**，规范化目录 SHA-256：

`d6af5fea549d486fbc8973ed72ead33dfd841d0f5c7d4e49a5796789aaf52b64`

登记在 `toolCatalog.test.ts`，保留旧版本指纹。其他批次合并若修改任何工具说明/schema，总管理者应按合并后的最终目录重新登记 2.5.0 指纹；不要用本批指纹覆盖合并后不同的契约。

## 选型、规模与设计自查

- 复用已安装 Zod 4 的 JSON Schema 引用生成、现有官方 MCP AJV validator 和操作账本，不引入新库、不自研 schema 校验或结果存储。相比维护另一份精简业务 schema，这样保留单一声明和服务端严格校验。
- 1501 项结果可以完整通过领域校验，并从账本逐页读取。单页最多 100 项、结果页内容最多现有传输字节预算的一半，属于传输预算，**不是产品结果总数上限**。导出历史没有数量上限。原文档和完整回执仍在内存/现有存储内，本批未宣称无限规模内存或磁盘性能已验收。
- 助手只凭名称和说明能否用对？可以据公开 required 调用；三维冲突给出具体读入口，批量结果描述说明 resultRef.field → resultField 的映射，导出描述说明 compact/full、activeOnly 与续页条件。已离线验证，不冒称真实外部模型任务实测。
- 能否 AI 先做、人只确认？现有批量编辑/查询继续由助手调用；只在原付费授权流程需要时请用户确认，不新增审批入口，不允许助手伪造确认。
- 产物能否直接流进其他工作区？分页返回原稳定实体引用，导出保留 assetRef；仍通过现有素材、收录与跨工作区能力复用，不制造第二套产物。

## 验证

按 testing.md L2（公共契约、授权读取、共享输出与跨消费者）执行精确测试和类型检查。日志写入系统临时目录，未写入任务库。

- 两套 `npx tsc -p tsconfig.json --noEmit`、`npx tsc -p tsconfig.electron.json --noEmit` 最终通过。过程中修复了 export 输出联合类型、媒体失败返回类型和测试替身 ZodError 类型错误。
- `toolCatalog.test.ts` 15 条通过（含 2.5.0 指纹）；第一次因旧指纹拒绝，最终登记后通过。
- `outputContract.test.ts` 172 条通过，包含正式成功回执经领域验证、公共投影和 AJV 的链路；未取消服务端校验。
- `externalToolContracts.test.ts` 3 条通过：精确输入、1501 项结果分页与调用者隔离、媒体最小授权读取且不建基线。
- `cameraStageRevisionContract.test.ts` 6 条、`cameraStageCapabilityAdapter.test.ts` 8 条、`cameraMotionDraft.test.ts` 5 条通过。
- `videoEditExportQueue.test.tsx` 40 条通过，已有历史重开场景增加默认简略、完整详情、分页、活动筛选和错误 cursor 检查。
- `videoEditSceneDetection.test.tsx` 7 条通过，包含输出故障后真实持久标记仍存在且禁止重放。
- `writeCapabilityExecution.test.ts` 10 条通过；导出口播样本补齐真实必填 destination。
- `applicationControlCoverage.test.ts` 14 条通过。
- 改动的 30 个 TS/TSX 文件 ESLint 通过；最后修改的测试文件单独复检通过。
- `check:main-imports`、`check:dependency-graph`、`check:assistant-capabilities:structure`、`check:surface` 和 `git diff --check` 通过。
- 未执行聚合 `check:application-control-invariants`（包含本次无关的 30 余个测试文件），未执行全量、Reality、构建或真实网络生成。

## 改动文件清单

| 文件 | 改动 |
|---|---|
| electron/main/services/application-runtime/applicationToolDispatcher.ts | 媒体最小授权读取、操作结果分页及原能力结果投影。 |
| electron/main/services/application-runtime/externalToolContracts.test.ts | 三项外部契约回归，含大批量与授权隔离。 |
| electron/main/services/application-runtime/outputContract.test.ts | 同步导出查询的简略输出样本。 |
| electron/main/services/application-runtime/resultProjection.ts | 由能力声明派生批量结果摘要与公开输出 schema。 |
| electron/main/services/application-runtime/toolCatalog.ts | 局部 schema 引用、付费说明去重及结果分页输入。 |
| electron/main/services/application-runtime/toolCatalog.test.ts | 同源引用 schema 对照及 2.5.0 指纹。 |
| src/core/application-control/applicationCapabilities.ts | 增加批量结果字段和可能付费的投影元数据。 |
| src/core/application-control/localHostContracts.ts | 外部契约版本设为 2.5.0。 |
| src/core/application-control/domains/audioEdit/audioEditApplicationCapabilities.ts | 派生十一个口播工具精确输入。 |
| src/core/application-control/domains/cameraStage/cameraStageCapabilitySchemas.ts | 冲突恢复指向正式实体基线读取。 |
| src/core/application-control/domains/cameraStage/cameraStageIntentCapabilities.ts | 候选应用移除 baseRevision 输入。 |
| src/core/application-control/domains/cameraStage/cameraStageMotionApplicationCapabilities.ts | 运镜移除 baseRevision 输入。 |
| src/core/application-control/domains/cameraStage/cameraStageSceneApplicationCapabilities.ts | 对象写工具移除 baseRevision 输入。 |
| src/core/application-control/domains/cameraStage/cameraStageRevisionContract.test.ts | 并发契约改为可信信封与明确恢复指引。 |
| src/core/application-control/domains/videoEdit/videoEditApplicationCapabilities.ts | 六个共用输入工具精确化。 |
| src/core/application-control/domains/videoEdit/videoEditExportCapabilities.ts | 声明简略查询、详情、分页和活动筛选。 |
| src/core/application-control/domains/videoEdit/videoEditSceneCapabilities.ts | 取消虚假批量上限并声明分页结果。 |
| src/core/application-control/domains/videoEdit/videoEditSubtitleCapabilities.ts | 标注识别和翻译可能触发付费确认。 |
| src/core/application-control/domains/videoEdit/videoEditTextCapabilities.ts | 三个文本操作精确化，插入 frame 必填。 |
| src/core/application-control/domains/videoEdit/videoEditTitleTemplateCapabilities.ts | 标注模型生成标题可能触发付费确认。 |
| src/features/application-control/capabilities/registry.ts | 区分输出契约错误和输入错误，保留执行事实。 |
| src/features/application-control/capabilities/writeCapabilityExecution.test.ts | 合法导出口播测试补齐 destination。 |
| src/features/audioEdit/application/registerAudioEditCapabilityHandlers.ts | 消费与目录一致的精确 schema。 |
| src/features/cameraStage/application/cameraStageCapabilityAdapter.ts | 三维写入只消费 context.expectedRevisions。 |
| src/features/cameraStage/application/registerCameraStageCapabilityHandlers.ts | 将可信上下文传给对象/候选处理器。 |
| src/features/cameraStage/application/cameraStageCapabilityAdapter.test.ts | 验证统一基线传入事务引擎。 |
| src/features/cameraStage/application/cameraMotionDraft.test.ts | 过期与有效候选写入使用信封基线。 |
| src/features/videoEdit/application/videoEditExportCapability.ts | 实现简略结果、活动筛选和绑定查询条件的分页。 |
| src/features/videoEdit/application/videoEditExportQueue.test.tsx | 同步 full 查询并验证分页和筛选。 |
| src/features/videoEdit/application/videoEditSceneDetection.test.tsx | 证明输出错误不掩盖实际已保存修改。 |
| docs/task/架构体检修复/B3-外部MCP工具目录与契约.md | 本批证据、计量、设计自查和交接。 |

## 总管理者注意

- 没改 packages/ai-sdk、MCP server、operationStore、execution/writeExecution、技能或总览；未新增/改变已登记持久格式和 SQLite 结构，不触发 persistence:baseline，也不占用 B2 的版本 21。
- `resultProjection.ts` 是本批 toolCatalog/dispatcher 的必要共享投影补丁。各领域 handler 及其精确测试属于契约消费方适配；请在与其他批次合并时重点核对 registry、导出 handler 与新增能力元数据。
- 测试 TSX 文件仅改用例，没有产品界面改动，没有新建/移动/删除界面目录文件。新增文件是主进程精确测试与本批任务记录。
- 需要总管理者在集成后生成并重启主进程产物才能加载新契约；本批按约束没有构建或启停应用。node_modules junction 未删除、重装或安装依赖，检查工具仍使用其既有缓存目录。
- 未验证真实外部 Agent 客户端是否保留 outputSchema、是否支持局部引用展开或使用按需工具披露；目录 token 为确定的离线比较，不能当作真实请求账单节省。
- 截图仅给出正式授权接入方案，尚未接通；既有 C2 与外部截图限制未放宽。
