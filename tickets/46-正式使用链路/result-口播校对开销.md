# 结果：口播校对的单次编辑开销、切点逐条写、参考稿上限（2026-11-13）

对应《排查-口播与剪辑》第 6 条、第 11 条（参考稿 2 万字）、第 12 条（撤销 50 步），《排查-上个项目遗留》第 18 条（cuts 只能整组写）。未碰 git，未启动开发版，无付费调用。

## 一、改法

### 1. 每改一个词不再整份序列化、整份校验

- 把剪辑 `474c67b20` 的按引用增量校验从 `src/core/videoEdit/documentValidation.ts` 提到通用模块 `src/core/incrementalSchemaParse.ts`（`createIncrementalSchemaParser(schema)`，每个解析器各自登记可信节点）。剪辑那边改成调用它，行为不变（原 21 项测试照过）；音频编辑用同一份实现，没有另写一套。
- `audioEditProjectInstances.ts`：
  - 打开作品与“重新载入”时整份校验一次，并登记、深度冻结；之后的编辑用 `parseProject(next, 当前作品)`：同一引用的词块、剪切、效果链直接沿用，换掉的节点按所在位置的 schema 解析，文档级 superRefine（范围、重复 id 等跨字段检查）每次都跑；增量路径任何一步不成立就退回整份校验，报错一字不差。普通编辑、拖动松手、“撤销所有修改”、主进程送回的处理结果（识别、录音拼回等经 `acceptAudioEditNativeResult` 的）都先校验，发布的是校验结果，落盘内容完整、合法。
  - 例外：拖动进行中的中间态只校验改到的字段、不做跨字段检查，也不冻结，松手后才换成校验结果；撤销、重做发布的是历史里已校验过的快照。主进程结果是经 IPC 的整份新对象，校验按引用沿用不到，所以这一步不与前一份共享结构。
  - `changedFields` / `hasUndoableChanges` 用 `jsonEqual`（先比引用）替换 `JSON.stringify` 深比较。
  - 拖动手势的中间态仍只校验改到的字段；松手时的整份校验与“撤销所有修改”也走增量校验。
  - 助手撤销回执里的 `afterContent`（整份 `JSON.stringify`）改为保存写入后的作品引用，撤销前用 `sameAudioEditProjectContent`（`jsonEqual`）比较。
- `core/audioEdit/edits.ts` 的 `assertAudioEditLocks`（每次编辑都跑）：原来对每条剪切 `find` + 两次 `JSON.stringify`（上千条剪切是百万次比较），改为数组没换引用就跳过、换了只检查换掉的剪切，锁定词块用 Map 查找；判定规则不变。
- 助手写入器（`audioEditFields.ts`）全部改为不可变更新，执行器不再 `structuredClone` 整份作品；校验后发布的作品是冻结的，原地修改会当场 TypeError，不会悄悄改坏撤销历史（拖动中间态除外，见上）。
- 顺带：历史面板步骤名比较（`workspace/audioEditHistory.ts` 的 `same`）也换成 `jsonEqual`，每多一步不再序列化整段转写。

### 2. 撤销步数 50 → 500

- 历史快照共享未改动的子树，每步只多出换掉的数组和节点。实测连续 500 次删/恢复词（GC 后）堆增长 28.5 MB，约 70 KB/步；500 步约 35 MB，在“资源预算放开”的范围内。原 50 步在 AI 粗剪后人工校对几十次就撤不回 AI 那一步，所以放宽；助手撤销回执（undoRef 用）仍为 50 条，与这条无关。
- 例外：主进程返回的处理结果（AI 粗剪、拼接等，经 IPC 是整份新对象）每步占一整份，这类步骤很少。

### 3. 切点逐条增删改（遗留第 18 条）

- 新增实体 `audio_edit.cut`（父 `audio_edit.document`），走通用动词，没有新增专用能力：
  - `set_properties`：`start_frame`、`end_frame`、`enabled`、`mode`（delete / mute）可写；`reason`、`document_id`、`sample_rate` 只读。
  - `create_items`：必填 `start_frame`、`end_frame`，可选 `mode`、`enabled`，生成手动剪切；`remove_items` 按引用删。
  - 字段只在 `audioEditFields.ts` 声明一次（统一字段定义），读、写、账本都从它派生。
- 单条修改落在 `core/audioEdit/edits.ts` 新增的 `updateAudioEditCut` / `addAudioEditCut` / `removeAudioEditCuts`：只换那一条，其余剪切保持原引用。
- `audio_edit.document.cuts` 改为只读总览，`readOnlyReason` 指向 `audio_edit.cut`；不保留整组写这第二条路径。技能 `audio-edit-workbench` 与 `process_audio_edit_breaths` 的说明同步改为逐条写。
- 并发保护：
  - 通用事务的逐条基线：不带基线时按目标剪切自身的属性核对，用户同时改别的剪切，两边都保留；带基线写入时，只要读取之后同一份口播（`audio_edit` 是单一版本作用域）有任何改动，不论改的是不是目标剪切，都以 `CONFLICT` 拒绝，不覆盖，需要重读后再写——这是现有框架对带基线写入的严格语义，没有改。
  - 执行器内：新增 `editAudioEditProjectAsync`，在读到的作品上异步算出结果；提交时作品已不是读到的那份（期间用户改了别处）就重读重算，最多 4 次，仍在变就报 `CONFLICT`。属性写入与增删共用它。
  - 逐条增删也进入口播的保存参与者，同一事务合成一步撤销、只保存一次（原来只认属性写入）。
- 界面：手动编辑（选区删除/静音/恢复、拖切点边缘）本来就是只换改到的剪切、保留其余剪切 id 的不可变更新，和助手走同一个实例的 `editAudioEditProject`（同一校验、锁、撤销栈、版本）；界面目前没有“按 id 改某一条剪切”的入口，所以没有新建界面调用。

### 4. 参考稿 2 万字上限

- 来源：`audio_edit.document.reference_script` 的属性描述沿用了词块文字的 `TEXT`（`maxLength: 20000`，复制粘贴来的），而 `.hjaud` 格式本身允许 20 万字（`schema.ts` 的 `referenceScript: z.string().max(200000)`）。助手写入被属性描述挡住，界面不受影响。这是无依据的“防用户自己”限制，已改为直接取 schema 的上限。
- 格式里的 20 万字（约 10 小时口播的稿子）没有放开：它是 `.hjaud` 的持久格式约束，放宽要升格式版本并提高最低可读版本（旧版本读不了超长稿），代价远大于收益，等真有需要再按 persistence.md 做。

## 二、基准（一小时口播夹具）

夹具：48 kHz、3600 秒；15000 个词块（其中 30 个锁定）+ 完整的 editBaseline 副本、1500 条剪切、300 条线索、500 个音量区域、2000 处口水音检测范围；参考稿 18000 字。jsdom + 正式文档会话 + 内存仓库替身；中位数（p90），助手两项用假定时器排除自动保存干扰。改前用 HEAD 版本的四个文件并排跑，各两轮交替，取第二轮（第一轮机器更忙，改前数字更高）：

| 操作 | 改前 | 改后 |
|---|---|---|
| 删一个词 | 68.5 ms（83.3） | 6.8 ms（10.2） |
| 恢复一个词 | 68.8 ms（85.2） | 7.0 ms（9.7） |
| 改一个词的文字 | 68.7 ms（81.0） | 7.1 ms（10.3） |
| 拖一处切点边缘 | 36.4 ms（41.0） | 4.0 ms（4.5） |
| 助手改一个切点 | 133 ms（148，整组写回） | 3.0 ms（4.4，`audio_edit.cut` 逐条） |
| 助手改一个词块文字 | 145 ms（155） | 7.3 ms（12.3） |
| 撤销 / 重做（不含保存） | 0.2 ms | 0.2 ms |
| 打开作品 | 约 120 ms | 约 150 ms（多一次整份校验登记） |
| 500 次编辑后撤销栈内存（GC 后） | 50 步封顶 | 450 步，+28.5 MB |

基准脚本已删除（不进仓库），副本在 `C:\Users\15212\AppData\Local\Temp\claude\0c13606506645089\10163793-748b-4738-b008-b3b0d67ebd3b\scratchpad\zzAudioEditEditCost.bench.test.ts`（改后）与同目录 `zzBeforeEditCost.bench.test.ts`（改前，需要 HEAD 版本副本放在 `application/__before/`）。

## 三、改动文件

- 新增 `src/core/incrementalSchemaParse.ts`
- `src/core/videoEdit/documentValidation.ts`（改为调用通用实现）
- `src/core/audioEdit/edits.ts`（`assertAudioEditLocks` 按引用跳过；新增单条剪切增删改）
- `src/features/audioEdit/application/audioEditProjectInstances.ts`
- `src/features/audioEdit/application/audioEditMutationExecutor.ts`（不可变写入、在最新内容上重算、新增 `AudioEditCutCollectionExecutor`）
- `src/features/audioEdit/application/audioEditFields.ts`（`audio_edit.cut` 字段、参考稿上限、写入器不可变）
- `src/features/audioEdit/application/audioEditReflection.ts`、`applicationDomain.ts`（实体与执行器登记）
- `src/features/audioEdit/workspace/audioEditHistory.ts`（`same` 改 `jsonEqual`）
- `src/core/application-control/domains/audioEdit/audioEditApplicationCapabilities.ts`：只有第 37 行（`process_audio_edit_breaths` 说明里改为逐条写 `audio_edit.cut`）是本次；第 36 行 `clean_audio_edit_retakes` 的改动属于别的任务
- `resources/assistant-skills/audio-edit-workbench/SKILL.md` 第 31 行（说明改为逐条写剪切）
- `docs/rules/assistant-status.md`（台账一条）
- 测试：`audioEditProjectInstances.test.ts`、`audioEditReflectionResult.test.ts`

工作区里同目录的 `audioEditApplicationService.ts`、`registerAudioEditCapabilityHandlers.ts`、`audioEditQuickProcess.test.ts` 是别的任务的改动，不在本次范围。

## 四、测试

- 新增：只校验改动字段但结果与整份校验一致、未改节点沿用原对象、落盘内容完整合法；非法改动仍被拒（词块多字段、重复 id、超出音频、重复剪切 id）；已发布作品原地修改报 TypeError；异步计算期间用户改了别处时重算且保留用户修改；AI 一步之后 120 次修改仍能撤回；剪切逐条改/增/删只换那一处、其余保持原对象、落盘回读、事务一步撤销；不合法剪切（结束早于开始、超出音频、盖住锁定词块）被拒且原剪切不变；用户改另一处剪切后助手改这一处两边都保留；助手读后用户改同一处、带旧基线写入被 CONFLICT 拒绝；原生处理结果不合法时不发布、合法时发布为冻结的校验结果；拖动中跨字段非法值可写入（证明中途不做整份校验），松手后发布的是冻结的校验结果；参考稿超过 2 万字可写入并落盘。
- 修改：三处旧断言监视 `audioEditProjectSchema.parse` 的调用次数（实现细节，增量解析器调用的是 `z.parse(schema, …)`，监视已失效）改为行为断言：拖动中跨字段非法值可写入、松手后结果已冻结、取消拖动后跨字段非法值被拒；两条用整组 `audio_edit.document.cuts` 写入的结果测试改用 `audio_edit.cut` 的 `create_items`。
- 通过：`audioEditProjectInstances.test.ts`、`audioEditReflectionResult.test.ts`、`core/videoEdit/documentValidation.test.ts`、`core/audioEdit/edits.test.ts`、`audioEditQuickProcess`、`audioEditRegions`、`audioEditSpliceService`、`AudioEditApp.subscription`、`videoEditAudioLinks`、`importCapturedAudio`、`audioEditWorkbenchSkill`、`storeActionCoverage`、`resultBehaviorCoverage`、`propertyCoverage`、`externalCapabilityInventory`、`hostScopeRevisions`、`applicationHarness.writeLoop`、`applicationControlCoverage`（即 `npm run check:application-control-coverage`）。
- 渲染层 `tsc` 一次：只报本次测试里一处 `unknown` 类型，已改（改后重跑该测试通过，没有再跑 tsc）。主进程 `tsc`（改了 `src/core/**`）通过。改动文件 ESLint 通过。
- `check:assistant-capabilities:structure` 报 `src/workspaces/GenerationWorkspace/hooks/resultSelection.ts` 未建账，是 11-11 已提交的既有问题，与本次无关。
- 未做独立审查（L2，交给提交方按规则派审）。

## 五、需要真实窗口确认

1. 打开一份一小时口播（或 30 分钟以上），在逐字稿里连续删、恢复 20 个词，看是否跟手；可用开发者工具 Performance 录一次删词，看主线程长任务。
2. 拖一处删除/静音区间边缘，确认松手后其余剪切不变、波形与试听正确。
3. 做一次 AI 粗剪，然后人工改 60 次以上，确认历史面板还能撤回到粗剪那一步。
4. 让助手（Pi 或外部 MCP）改一个 `gap:` 剪切的起止、停用一处、新加一刀，同时你在界面上改另一处，确认两边都保留。

## 六、没做到的与风险

- 仍在每次编辑路径上的界面开销（不在本次文件范围，未改）：`preview/useAudioEditSilencePreview.ts` 的 key 每次改词都把转写、剪切、线索整份 `JSON.stringify`（夹具上约 8–18 ms，未开停顿预览时也算）；`useAudioEditPreview.ts` 的 planKey 序列化成片 spans。建议下一步改成按引用的版本号或只在开启时计算。
- 撤销/重做立即整份保存（排查第 7 条）：替身仓库上一次保存约 70–110 ms，真实环境还有 IPC 与主进程写盘；连续撤销仍可能发涩。建议撤销也走会话防抖，离开时强制落盘。
- 冻结是新增的运行时约束：今后若有代码原地修改已发布的口播作品会当场 TypeError（这是有意的，能立刻发现；已覆盖的测试路径均未触发）。拖动中间态不冻结。
- 打开作品多一次整份校验（约 +30 ms，只在打开时）。
- 外部调用方带旧基线时，用户改了同一口播的任何内容都会让写入被拒（`audio_edit` 是单一版本作用域）。不覆盖，但需要重读一次；要做到“带基线也只看目标剪切”需要改通用事务的作用域粒度，影响面大，没做。
- `audio_edit.document.cuts` 不再可写：外部若有脚本按旧方式整组写，会收到只读原因并改道 `audio_edit.cut`；仓内消费者已全部同步。
- `.hjaud` 的其它容量上限（剪切 10 万条、音量/修复区域各 1 万、检测范围 2 万）同属格式约束，未动。
