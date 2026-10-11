# t167 最小版本批次整合

日期：2026-10-11。工作区 `D:/VibeCode/henji-wt-batch`，分支 `codex/minimal-batch`。承接未提交的 t164/t165/t166；总管理者负责审查、提交和运行产物。未执行 Git 写操作、安装依赖、修改 SDK、Reality、开发实例启停或付费请求。

## 接线与根因

| 项目 | 根因 | 本次做法与证据 |
|---|---|---|
| 外发确认 | t166 只有可选预检组件，宿主未接实际模型和会话同意 | 共享预检读取正式 Pi 模型配置、实际讲解附件数量；没有可用模型或只能本地整理时直接本地运行。有模型时沿 t166 原样式弹窗，确认后保存会话 consent，再调用正式 embeddedAgent.prompt；单次同意结束后撤销外发标记，勾选才保留。两个生成入口共用同一确认组件。 |
| 审阅刷新 | 将会话身份用于审阅缓存会漏掉正文绑定变更；将审阅 revision 用于生成身份又会被同意保存打断 | 审阅按宿主版本刷新，生成按会话身份防串；预检服务再次校验真实会话内容。覆盖确认保存引发重绘与绑定变更刷新。 |
| 公共撤销 C2 | 通用引擎 token 与正式公共 undoRef 不同，旧测试手工映射没有验证生产链 | 在 applicationReflectionAdapter 拿到真实公共回执后绑定原始正文目标，包括可撤销失败回执；撤销时仍要求当前会话同意，删除会话失效映射和领域撤销。 |
| 冷宿主正文 | 正文 editor 仅由打开讲解面板时登记 | 两端 CreativeIntentReflection 提供延迟正文编辑端口，在真实文档宿主内恢复原 collector，复用既有 apply/restore 与保存屏障；不打开页面或创建第二套正文写法。 |
| 图片正文保存事务 | 冷宿主公开测试揭示正文命令没有向持久化 owner 登记本事务的修改，因此正确的并发保护将它拒绝；批事务内也不能提前释放新资源租约 | 写入前 assertCurrent，写入后 acceptCurrent；通过 confirmStep 将资源释放延后至外层事务保存成功。保留并发校验，双端真实 C2 edit/undo 与图片保存 owner 测试均通过。测试原生存储补齐资源写入/读取/租约释放，并验证克隆和 reset，不伪造业务保存成功。 |
| 图片隐私擦除 | 普通可撤销命令只删当前 head，旧命令、冷历史页、redo 和资源仍可恢复正文/画面 | 命令历史逐页读取两向历史，清除该会话并重算成对命令资源；原子命令保留其他作品修改，重写后保持原游标。总线锁住并发写入、清理历史预览、提升版本并保存。保存确认后释放会话租约，用现有 GC 的指定资源集合立即清除旧正文、画面和冷页，不扫掉其他未引用资源。删除失败保留重试状态，禁止 collector 写回已擦除正文。 |
| Pi 模型失败 | core 有本地整理但正式 Pi 调度没有接入 | prompt 传递明确的文档/会话/原稿范围；正式 Pi 出错时对未完成原稿调用已有 organize 能力，不再次调用模型、不自动应用作品；取消不继续派发。受控本地 HTTP 模型失败夹具验证正式 Pi 路径。 |
| 颜色门禁 | styleTokens 旧注释引用未定义 divide-border-dark/60 | 改成已有 divide-line/60。初始工作区该文件无 diff，Git 对象 HEAD 与本地 main 都有旧注释；没有证据把它归因为 t164/t165 新样式，也未读取或操作用户主仓工作区。 |
| 依赖图门禁 | 正文模块动态导入应用控制注册表，注册表又导入正文模块，形成值回边 | 正文模块导出 writer 绑定函数；由注册入口注入延迟 engine getter。移除动态回边，未修改依赖基线。 |
| 节拍 Worker 类型与读回 | Worker hook 曾返回 VitestUtils；新增字段此前落入通用空字符串默认值，且 t164 首轮进程缓存了更新前的反射模块 | 当前代码已将 hook 改为 void，snapToBeat 默认 false、marker type/strength 默认 marker/0。本轮新进程 Worker 3 项、节拍分析/公共读回 7 项及目录对应项通过，确认修复已存在，未重写算法或重复修改。 |
| 机位整合契约 | 新 apply_camera_stage_motion_candidate 没有遵循三维统一 baseRevision 输入/输出约定 | 整理回执提供 baseRevision，应用显式校验并回带更新后的值，补 CONFLICT 恢复说明；真实公开能力测试验证陈旧版本不写场景。未放宽测试或基线。 |
| 视频资源黄金夹具 | 节拍夹具刷新丢失已登记的 creativeIntents、蒙版及原轨道数据，使正式资源收集测试失败；动作夹具生成器仍从旧 v1 重建 v2 | 生成器改为在现有 v2 上补全动作数据，保留后续字段；恢复既有原稿和蒙版等数据，最终 v2 差异只增加节拍开关和标记 8 行。资源收集测试 2 项、41 种持久格式门禁通过。未修改 schema/依赖基线来掩盖失败。 |
| FFmpeg 验证环境 | 独立 worktree 缺少 native/video-decoder/ffmpeg/current.json，多组音视频导出测试找不到固定版本二进制 | 使用项目现有脚本 ensure 下载并校验固定 FFmpeg，仅写入本 worktree 被忽略的 native 目录；不安装 npm 依赖、不触碰 node_modules junction 或用户实例。相关 7 文件共 59 项复验通过，其中包括资源夹具和真实图片冷历史测试。 |

## 设计自查与选型

1. 助手只凭名称和说明能否用对？正文沿既有 C2 通用实体的词稿/指向属性读写；撤销使用真实公共回执。模型整理沿已有原稿、读取讲解和封闭语义计划能力，失败也调用同一正式本地整理能力。
2. 能否 AI 先做、人只确认？生成先保留本地候选，再由模型理解讲解；外发由人确认，作品应用仍需人确认。弹窗严格沿 t166 设计，不增常驻说明、按钮或面板。
3. 产物能否直接流进其他工作区？仍产出既有 MotionDraft、图片布局及原生机位关键帧，保存/应用/跨工作区消费使用现有管线；不引入新作品格式。本次没有扩展跨域能力。

复用项目已采用的 Pi、React、Zod、UiModal/UiCheckbox、统一 Application Control 与内容寻址资源库。没有新算法选型或额外依赖需求；不复制上传、授权、历史或模型 transport 实现。不设作品/片段/历史数量上限；历史按现有页读取并定期让出事件循环，擦除期间只保留命令元数据，不解码作品像素。

## 验证范围与结果

按 testing.md L2：涉及公共契约、私密授权、保存/撤销与主进程文件 I/O。九目录广度来自本任务明确要求，非自行升级全仓测试。目录 Vitest 使用 `--silent --pool=forks --minWorkers=1 --maxWorkers=1` 串行运行，普通 Node 排除登记的原生 SQLite 文件，随后交正式原生 runner 执行。最后单文件存储回归使用 `--silent`。默认跳过的性能基准/环境用例单列，不计为已验证。失败后只复跑对应文件，复用未改动文件的通过证据；表中目录总数为首轮加修复复验后的有效结果，不声称重新运行过整目录。

| 检查 | 结果 |
|---|---|
| npx tsc -p tsconfig.json --noEmit | 通过，0 错误；包括 Worker hook 和最终冷宿主保存接线 |
| npx tsc -p tsconfig.electron.json --noEmit | 通过，0 错误；包括最终真实冷页测试 |
| 本批所有变更 TS/TSX 及改动 CJS 的 ESLint --max-warnings 0 | 通过；首轮一个多余分号及脚本 CommonJS/console 问题已修正并精确复验 |
| check:colors | 通过；旧注释 token 修正 |
| check:surface | 通过 |
| check:icons | 通过 |
| check:ui-residue | 通过 |
| check:dependency-graph | 通过；正文动态回边已消除，未改基线 |
| check:dead-code | 通过；原有基线提示保留 |
| check:assistant-capabilities | 三部分均通过：structure 命令通过；coverage 与 invariants 对应文件复用九目录结果，目录外 6 文件 39 项补验通过，原生 asset-library 用例由正式 runner 覆盖；未重复运行聚合命令 |
| check:persistence-compat | 通过，41 种格式；黄金夹具修复后复验通过 |
| check:main-imports | 通过 |
| check:ipc-contract | 通过 |
| src/core | 263 文件、1775 项通过；2 文件/2 项既有跳过，0 遗留失败。首轮机位 revision 契约 2 项失败，修复后精确复验通过 |
| src/features/creativeIntent | 8 文件、35 项通过，0 失败；包含新增预检及同意保存重绘回归 |
| src/features/videoEdit | 189 文件、1672 项通过；2 文件/6 项既有跳过，0 遗留失败。首轮审阅刷新 1 项失败，恢复独立 review key 后精确复验通过 |
| src/features/imageEdit | 196 文件、971 项通过；2 项既有跳过，0 失败 |
| src/features/cameraStage | 51 文件、305 项通过，0 失败 |
| src/features/canvas | 196 文件、1026 项通过，0 失败 |
| src/features/application-control | 19 文件、110 项通过，0 遗留失败；冷宿主测试先修正权限/版本夹具，再修复真实图片事务登记问题及存储资源端口，11 项公共领域复验通过 |
| src/tests | 20 文件、83 项通过；1 文件/1 项既有跳过，0 失败；最后新增资源克隆/释放/reset 后存储文件 14 项通过 |
| electron/main | 198 文件、1228 项通过；10 文件/35 项既有跳过，0 遗留失败。首轮 7 文件失败（20 项失败及 beforeAll 中断的 6 项），环境/黄金夹具/冷页测试参数修正后 7 文件 59 项全部通过 |
| npm run test:assistant-persistence | 正式 Electron 原生 SQLite runner：9 文件、83 项通过，0 跳过；未打开开发实例 |
| 工作区检查 | git diff --check 通过；仍在 codex/minimal-batch；packages/ai-sdk 无改动。未执行暂存、提交、推送或其他 Git 写操作 |
| 冷宿主与保存事务最终复验 | creativeIntentDomain、imageEditExplanation、imageEditPersistenceOwner、harnessNativeStorage 共 4 文件 47 项通过；其后仅新增存储测试，再单独 14 项通过 |
| 隐私底线证据 | 图片正文与实际画面、热/冷历史、原子命令、撤销/重做、保存失败重试均有测试；真实临时资源库保存/重开并断言旧私密资源物理不存在，重开撤销/重做不能恢复会话，其他作品修改保留 |

首次失败未隐藏：目录原始结果在系统临时目录 `t167-suite-*.log`；精确修复结果在 `t167-corrected.log`、`t167-cold-public4.log`、`t167-main-repaired.log`、`t167-harness-final.log`，原生结果在 `t167-native.log`，门禁在 `t167-check-*.log`。全部默认跳过合计 46 项；没有把跳过项记为通过。日志不加入仓库。

## 交付边界

本任务代码接线与指定自动检查已完成，0 遗留失败；不是 P1-5/P2-3 整体产品验收完成。没有 Reality、截图、真实云模型质量或付费调用证据；总管理者后续生成 Electron 产物并补拍实际宿主截图。本次改到主进程协议与 Pi，用户继续验收前需要总管理者更新运行产物并重启相应主进程，本代理未启停用户实例、未做 Git 写操作。范围包括两个候选入口、双端冷宿主、真实公共撤销、图片两向热冷历史与资源库、Pi 失败调度；未扩展图片静态 take CRUD、一般差分或真实模型质量验收。


## 本轮修改文件（不把承接的 t164/t165/t166 全部差异冒充本轮新增）

| 文件 | 本轮职责 |
|---|---|
| `src/components/ui/styleTokens.ts` | 修正旧注释中的未定义颜色 token。 |
| `src/core/assistant/embeddedAgent.ts` | 正式 prompt 增加明确的讲解整理范围。 |
| `src/core/imageEdit/v3/commandHistory.ts` | 两向热/冷历史不可逆擦除指定讲解并重算资源。 |
| `src/core/application-control/domains/cameraStage/cameraStageIntentCapabilities.ts` | 补齐候选应用 baseRevision 契约及冲突恢复说明。 |
| `src/features/application-control/creativeIntentExplanation.ts` | 注册入口注入 writer，正文事务使用冷宿主编辑端口。 |
| `src/features/application-control/creativeIntentExplanation.test.ts` | 通过真实公共适配器获取 undoRef 验证 C2 映射。 |
| `src/features/application-control/creativeIntentHost.ts` | 声明宿主的正文编辑端口。 |
| `src/features/application-control/creativeIntentDomain.test.ts` | 验证双端冷宿主 C2 公共写入及公共撤销。 |
| `src/features/application-control/capabilities/applicationControlRegistry.ts` | 在组合入口绑定正文 writer，消除值回边。 |
| `src/features/application-control/capabilities/applicationReflectionAdapter.ts` | 实际公共回执映射正文撤销授权。 |
| `src/features/creativeIntent/application/explanationGeneration.ts` | 共用模型预检、附件计数、会话同意及正式 Pi 调度。 |
| `src/features/creativeIntent/application/explanationGeneration.test.ts` | 预检、单次/记住同意、失效、实际附图数量和失败清理。 |
| `src/features/creativeIntent/ui/ExplanationSendConfirmation.tsx` | 提取原设计确认弹窗供两个入口共用。 |
| `src/features/creativeIntent/ui/CreativeIntentControls.tsx` | 候选按钮接入预检、确认和异步防重。 |
| `src/features/creativeIntent/ui/CreativeIntentControls.test.tsx` | 覆盖取消、发送、记住和重复点击。 |
| `src/features/creativeIntent/ui/ExplanationPanel.tsx` | 复用确认组件，分离审阅刷新与生成会话身份。 |
| `src/features/creativeIntent/ui/ExplanationPanel.test.tsx` | 覆盖同意保存引发刷新后仍正确生成。 |
| `src/features/creativeIntent/index.ts` | 导出正式预检服务及共享类型。 |
| `src/features/imageEdit/v3/application/imageEditCommandBus.ts` | 擦除期间阻止并发历史写入，清预览并发布清洗后的历史。 |
| `src/features/imageEdit/v3/application/imageEditCreativeIntentReflection.ts` | 图片冷宿主复用正文编辑器。 |
| `src/features/imageEdit/v3/application/imageEditExplanation.ts` | 接入预检与生成、正文事务自身修改登记和保存后释放；删除走历史清洗、保存与资源擦除，失败可重试。 |
| `src/features/imageEdit/v3/application/imageEditExplanation.test.ts` | 验证正文/画面热冷历史、原子编辑、重开、撤销重做和失败重试。 |
| `src/features/imageEdit/v3/editor/ImageEditorExplanationControlsV3.tsx` | 图片讲解按钮接入预检，保留审阅版本刷新。 |
| `src/features/videoEdit/application/videoEditCreativeIntentReflection.ts` | 剪辑冷宿主复用正文编辑器。 |
| `src/features/videoEdit/application/videoEditExplanation.ts` | 剪辑会话预检、同意保存及本地候选/Pi 调度接线。 |
| `src/features/videoEdit/panels/VideoEditExplanationControls.tsx` | 讲解面板生成接线并保留宿主版本刷新。 |
| `src/features/videoEdit/panels/VideoEditMotionControls.tsx` | 超级关键帧候选入口接入相同预检与调度。 |
| `src/features/cameraStage/application/registerCameraStageCapabilityHandlers.ts` | 正式机位能力检查、更新并回带 baseRevision。 |
| `src/features/cameraStage/application/cameraMotionDraft.test.ts` | 正式能力陈旧版本拒绝及更新回执验证。 |
| `src/platform/contracts/imageEditorV3.ts` | 现有资源 GC 接受明确的擦除集合。 |
| `electron/main/ipc/image-editor-v3-payloads.ts` | 验证擦除资源参数。 |
| `electron/main/ipc/image-editor-v3.ts` | 指定集合即时 GC，保留其他文档引用和租约保护。 |
| `electron/main/services/image-editor-v3/resource-store.ts` | GC 支持只处理指定资源集合。 |
| `electron/main/services/image-editor-v3/resource-store.test.ts` | 证明即时定向擦除不会删除其他孤立资源。 |
| `electron/main/services/image-editor-v3/document-repository.test.ts` | 真实保存/冷页/GC/重开撤销的物理擦除测试。 |
| `electron/main/services/embedded-agent/contracts.ts` | 引擎命令传递讲解整理范围。 |
| `electron/main/services/embedded-agent/service.ts` | 正式服务将范围传入 Pi。 |
| `electron/main/services/embedded-agent/piEngine.ts` | 正式模型失败调用本地整理，避免重复已完成原稿。 |
| `electron/main/services/embedded-agent/piEngine.test.ts` | 受控真实 Pi 模型错误自动降级验证。 |
| `src/tests/harnessNativeStorage.ts` | 测试原生存储增加真实资源副本读写及租约释放端口。 |
| `src/tests/harnessNativeStorage.test.ts` | 验证资源读写克隆、释放租约保留内容及 reset 清除。 |
| `scripts/generate-video-motion-fixtures.cjs` | 从现有 v2 补全动作夹具，避免覆盖后续字段。 |
| `tests/fixtures/persistence/document.video_edit/v2.json` | 修复节拍刷新丢失的既有动作/蒙版数据，最终只增加节拍字段。 |
| `docs/rules/assistant-status.md` | 登记 t166 接线欠账已解决及真实验收边界。 |
| `docs/task/超级关键帧/02-实施拆分.md` | 只更新讲解外发/正文这一行。 |
| `docs/task/超级关键帧/任务/t167-integration.md` | 本任务原因、实现、完整检查和交付边界。 |
