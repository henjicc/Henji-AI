# 智能助手应用能力覆盖

## 当前适用范围

UI、内置 Pi 与现代 MCP 共用正式领域服务和应用运行实例。公共契约位于 `src/core/application-control/`，渲染层在 `src/features/application-control/` 装配各领域，Electron 的 `services/application-runtime/` 协调授权、执行、账本、费用与恢复，先于 Pi 和 MCP 初始化。

Pi 与 MCP 只负责工具和结果投影，不拥有业务状态。MCP 固定使用正式协议 `2026-07-28` 与拆分 SDK `2.0.0`，拒绝旧协议；授权逐请求核验，持久操作不随网络连接结束。旧自研助手、Henji Script、发现租约和旧前端工具桥已移除，不保留兼容执行链或旧数据迁移要求。

> 读取时机：新增或修改工作区、页面、浮层、工具箱工具、设置项、用户可查询数据、业务操作、稳定引用、权限、宿主上下文或能力搜索。
>
> **这些场景必须同时读 skill `henji-application-capability`**（含 schema 字段、注册模式、迁移步骤与示例代码）。本文件只是硬约束清单。

## 先分级：覆盖判断不等于新增 MCP 工具

新功能开始前先判断它改变的是呈现、入口，还是应用能力；不要把“命中应用能力规则”机械理解为“为 MCP 再写一个工具”。

| 级别 | 典型变化 | 必须做什么 |
|---|---|---|
| 仅呈现变化 | 布局、文案、样式、动效、同一业务状态的不同展示 | 使用 `henji-ui-surface`；不新增能力声明、实体或 MCP 工具。若没有新增页面、入口、数据或操作，到此结束 |
| 覆盖核对 | 新页面、浮层、工具入口或导航，但业务数据和操作全部复用现有正式能力 | 核对 Surface／导航是否需要登记，并证明已有实体、属性、集合或能力覆盖该入口；不复制 schema，不新增同义工具 |
| 能力增量 | 新数据、设置、业务操作、长任务、文件或网络副作用、稳定引用、权限、撤销／恢复／生命周期语义 | 完整执行 `henji-application-capability`，在正式领域与公共注册中补齐声明、执行、授权、账本和结果验证；MCP 与 Pi 从同一声明投影 |

同时命中多个 skill 时按职责叠加：界面 skill 管呈现与交互层级，画布或模型 skill 管各自领域，应用能力 skill 只管新增能力及覆盖证明。不得因为多个 skill 同时触发而实现多份业务入口。

## 唯一元数据源

所有向助手开放的功能必须以 `ApplicationCapabilityDefinition` 作为 schema、权限、风险、数据等级、引用、可用条件、并发规则、成功证据和失败恢复的唯一元数据源。

AI 输入 schema 顶层必须设置 `additionalProperties: false`。禁止 `patch`、`storePatch`、`executeScript`、`script`、`code` 等任意 Store Patch 或脚本执行字段；需要新增参数时先扩展正式领域 schema/注册表。

**一次声明、多入口投影。** 同一份领域声明同时服务界面、内置 Pi 与外部智能体（MCP）：工具参数由能力定义的 Zod 输入投影，域与实体的可读可写面由反射注册表的 `exposures`／`requiredPermissions.write`／`collectionWrite`／`writeExclusion.reason` 派生。**禁止在 `electron/main/services/mcp/**` 维护任何业务字段表、实体类型清单或前缀白名单**；那里只允许协议层自身的参数与信封。新增一个已登记的业务实体或属性后，外部调用方应立刻可用，不需要回到协议层登记。对外工具名、必填参数与错误码的变化必须同步正式消费者和契约测试；本轮以新格式验收，不保留旧客户端调用样本或兼容解码分支。展开做法见 skill `henji-application-capability` 第 0.5 节。

MCP 工具集合与基础权限由正式前端能力声明自动派生，不再维护独立 ID 白名单。属性权限由反射注册表派生。普通操作复用通用实体；专用操作必须有正式执行器与目标绑定；内部或委托路径在原声明的 `external` 字段说明。`check:application-control-coverage` 从全部软件能力反向核对 MCP 路由，缺执行器、缺目标、失效委托均失败；与现有属性、集合及 store 动作门禁共同阻止新增功能遗漏。检查通过代表已登记能力的路径完整，不等于每个界面行为都已实测。

## 覆盖判断不可跳过

每个用户可见的工作区、工具、设置项和数据模块，都必须：

- 注册对应能力，**或**
- 在覆盖清单中明确声明"不向助手开放"及原因

不得因为暂时没有助手需求就跳过覆盖判断。

### 实体写入覆盖

- 「读取属性」「修改已有属性」「增删集合成员」必须分别走反射层通用动词；只有无法用属性或集合写入表达的算法型操作才新增专用能力。
- 声明可写属性必须注册 `ApplicationMutationExecutor`；声明 `collectionWrite` 必须注册 `ApplicationCollectionExecutor`，并在 `requiredPropertyIds` 中列出创建时必填字段。只读属性可以是创建必填项。
- 每个实体必须满足二选一：至少有一种正式写入执行器，或填写机器可读的 `writeExclusion.reason`。排除原因必须说明该状态为何只读、由哪个正式模块或操作维护，不接受“暂时不支持”“以后再做”。
- 新增实体后必须同时检查属性可写性、集合写入、执行器注册、排除原因、权限、revision、撤销/补偿与结构化验证；运行 `npm run check:assistant-capabilities` 让覆盖门禁复核。
- **声明可写的每一条属性，都必须出现在执行器的 `writableProperties` 里**，且该集合必须由 `ApplicationPropertyWriterTable` 派生（`writableProperties(TABLE)`），不许手写字面量。属性写入执行器**禁止**用手写 if-else 属性链——链条无法被枚举，覆盖门禁就看不见“声明可写但执行器没有对应分支”这类缺口。
- 属性接受的 operation 由写入表的 `operations` 声明，不写默认只接受 `set`。集合类属性（如 `asset.library_refs` 只吃 `append`/`remove`）必须显式声明，否则模型只能靠试错。
- **新增可写属性必须用统一字段定义（`ApplicationFieldDefinition` + `fieldDescriptors`/`fieldReadValues`/`fieldWriterTable`/`fieldLedgerEntries`，定义于 `src/core/application-control/fieldDefinition.ts`），禁止再分别手写属性描述符、读取映射、写入表项、账本条目四处登记。** 一条属性只在对应领域的 `*Fields.ts`（如 `cameraStageSceneFields.ts`、`canvasFields.ts`、`assetFields.ts`）里声明一次，四个消费方从这一条声明派生。这是缺口再生的根因修法：四处分别登记时，漏其中一两处不会报错，助手安静地少一块能力，只有用户实机撞上才发现（三维场景外观 24 项就是这样漏的）；统一定义之后漏一条是整条从四处一起消失，会被 `storeActionCoverage` 门禁当场抓到。同一个 store 动作被多个字段共用时（如 `updateObject` 一次改 name/visible/color/character_variant 四个属性），`fieldLedgerEntries()` 按声明顺序把它们累进同一条绑定，不需要手写聚合。

### 动态可用性与结果真实性

- 静态属性/`collectionWrite` 声明只表示“结构上支持”；`getPropertyAvailability` / `getCollectionAvailability` 才表示“在这个引用和当前状态下可执行”。每个 `ApplicationEntityProvider` 必须实现两种动态查询；没有额外集合限制时复用 `unrestrictedCollectionAvailability`。
- 集合写入必须由 Registry 合并静态声明、provider 当前状态、调用方权限和 revision；事务计划、提交预检、每步执行前都复核同一结果。领域服务不得再复制模式守卫和错误拼接。
- `describe_application_entities` 需要判断实例状态时传 `refs`；动态输出保留可用状态、原因与结构化 recovery 标识，历史投影剔除权限和 revision 噪音。
- recovery 中任何操作步骤都必须先有正式 `describe → change → read/真相源` 结果测试跑通。不得凭读代码推断一条“应该可行”的路线后写进提示、错误或示例。
- Camera Stage 只公开 `camera_stage.state_keyframe`：在同一次 `change_application_entities` 事务中按顺序交替写 `camera_stage.playback.current_time` 与对象、角色或摄像机的 `animatable.*` / `pose_preset`，最后可同事务写入播放控制；应用自动创建或更新各时间点的完整场景状态。除非依赖尚未返回的新引用，否则不得按时间点拆成多轮。该路线必须由正式单事务结果测试持续证明；派生属性轨道只供播放与导出，禁止重新注册为公开实体或持久化真相源。
- 每个拥有 mutation/collection 执行器的写域必须登记 2–3 条结果场景。断言必须读取领域真相源或 `readEntity`；`completed`、evidence 数量或执行器被调用不算结果成立。

### 界面动作覆盖

- **每个 zustand store 必须有账本**，store 的每一个函数键都要归类：绑定到属性 / 集合 / 能力，或标为 `excluded`（有意不开放，写明由谁维护），或标为 `gap`（人能做、助手还不能做，写明缺什么与归到哪一期）。账本的 `storeId` 必须等于 store 文件的 basename（去掉扩展名），门禁按这个约定比对。
- 账本用 `Record<ActionName, …>` 而不是 `Partial`：界面新增动作却没建账，`tsc` 阶段就会点名缺哪个 key。
- `excluded` 表达的是**不可写**，不是**不可见**。视图态助手仍然要读得到——它得知道用户现在在看什么。
- `gap` 总数是人机差集的燃尽基线，在 `storeActionCoverage.test.ts` 里钉住，只许降不许升。
- feature 整体没接助手（既无 Reflection 也无账本）必须登记进 `check-assistant-capabilities.cjs` 的 `ASSISTANT_BLIND_FEATURES` 并写明原因——那是一张**会缩短的清单**，不是豁免表。这是 feature 级的检查，与下面 store 级的检查并存、互不替代。
- **store 级清点按内容识别，不按目录约定**：任何文件只要导入 `zustand` 且调用 `create<...>(`，就算一个 store，不论它放在 `src/stores/`、`src/features/*/store/`，还是别的目录（例如 `src/services/largeUploadPolicy.ts` 里就藏着一个 store）。没有账本覆盖的 store 必须登记进 `ASSISTANT_BLIND_STORES` 并写明归属任务编号，同一张**会缩短的清单**。

### 能力可达性：声明必须能被发现和调用

- 工具目录由领域声明派生，按授权过滤并稳定排序；业务宿主尚未就绪时仍可发现静态能力，执行返回准确的就绪状态和恢复办法。
- 页面挂载、模型猜测的实体名或当前视图不能成为普通业务能力的隐藏条件。导航、聚焦和视口操作才依赖界面状态。
- Pi 按需披露工具，披露后的工具必须在下一步真实可调用；不能在 Pi 或 MCP 目录维护第二份业务启用名单。
- 实体、属性、enum、范围、引用、写 operation 和集合必填项只从正式反射注册表投影，禁止回声模型猜测或从提示词拼接 schema。
- 能力声明的实体类型必须与反射注册表一致，实际副作用必须由 `control.impacts` 与 `resolveObservedEffects` 覆盖。
- 通过正式公共入口验证发现、授权、执行、输出校验和回读结果。覆盖门禁证明声明完整，结果测试证明实际可用；两者不能互相替代。

### 拒绝要给改道，不要给死胡同

助手撞墙时收到的那句话，决定它下一步是改道还是向用户宣布「做不到」。已经吃过一次亏：模型
收到 `camera_stage.object 未声明可增删`，据此推断应用不支持新增几何体，而
`place_camera_stage_object` 一直都在。

- 拒绝通用增删时，必须点名真正能做这件事的专用能力。这份对照表由能力目录的 impacts **派生**
  （`collectionWritersByEntityType`），不逐个实体手写注解——注解会漂移，派生不会。
- 属性写不了时，必须把 `readOnlyReason` 与 provider 给出的动态原因一并抛出，不能只报
  `PROPERTY_NOT_WRITABLE:<id>`：模型分不清是权限、是有意只读、还是当前状态暂时不可写。
- 通用规则：**任何拒绝都要让对方知道下一步能做什么**。手里已经有的信息不给，等于逼模型去猜，
  而它猜错的结果会被当成事实讲给用户。

## 禁止事项

- **禁止**新增旧式 `HostCommand`、`HostQuery`、`kind: 'command'`、`kind: 'query'`、固定前端命令/查询执行表，或依赖兼容描述生成器的 Agent 工具
- 能力处理器**必须调用正式业务服务**，不得复制业务逻辑
- 后台可完成的操作，不得为了复用页面组件而强制切换页面
- 跨模块传递实体必须用 `ApplicationRef` 或正式任务／资源引用，**不得**向模型暴露原始密钥、本地路径或不受控的大对象
- 新增内容来源或媒体消费功能时，同时核对“来源 → 下一步操作”，不能只登记单个工具。已有媒体来源清单在 `src/core/application-control/mediaReferenceKinds.ts`；新增来源须补正式解析和逐来源执行样例，准备／提交声明从清单派生。编辑预览必须经过正式合成，不能把原图当编辑结果；引用既有内容不得强制收藏、重上传或打开无关页面。关键连续操作加入现有 `check:application-control-invariants`，从下游实际媒体及正式状态断言结果，禁止仅检查测试标题或成功文字。本文要求不等于所有实体都是媒体；无法直接复用的文档、图层等应注明正式导出路径及对应验证。
- **不得**以"助手已判断"为理由绕过安全边界
- **禁止**从能力处理器直接调用 Store `setState` 做任意 Patch；仅允许正式领域服务内部对已声明字段执行确定性状态提交
- **禁止**在 Application API、能力定义或应用运行时 增加 `eval`、`new Function` 或任意脚本执行入口

## 公共执行与实例生命周期

- 调用者、授权、请求身份、持久操作身份与渲染宿主代次分别建模，由可信宿主注入；工具参数不能覆盖授权。
- 写入在业务执行前持久登记调用者范围内的幂等键。同键同输入返回原操作，参数变化拒绝；断线、超时或未知结果不能触发自动重放。
- 多项实体写入使用正式 `change_application_entities` 事务；算法操作使用领域能力。跨领域只传完整稳定引用，不新增脚本解释器或第二套业务执行链。
- 业务状态、撤销和保存归工程／文档唯一实例持有，页面仅附着。后台修改不得隐式切页；长任务持有原目标直到结果处理结束，网络等待不占用编辑提交锁。
- 删除与退出经过实例生命周期屏障。只有无使用者、无活动任务且已保存的实例可释放；失败保存必须保留脏状态和恢复入口。
- 应用结果区分业务数据、执行状态、保存状态、实际副作用和任务／恢复引用。MCP 的 `content/isError` 与 Pi 工具消息只属于适配器。
- 长任务提供查询、等待、取消和恢复；取消等待不等于取消任务。恢复先查权威状态，只重试未完成的保存或续查，不重新提交已发生的生成。

## 必须接入的现有机制

新能力必须接入：权限审批、revision、幂等、撤销、并发、脱敏、结构化日志、成功证据验证。

- 同一通用事务允许按顺序多次写同一属性；只有最后一次写入参与最终状态等值验证，中间值必须由结果级场景验证其领域副作用。
- 反射描述必须公开属性实际接受的 `writeOperations`。高层 `set` 与底层 append/remove 不一致时，由计划器确定性编译为最小差异；不受支持的操作必须在计划期拒绝，禁止留到执行期失败。
- 后置步骤可以依赖前序步骤刚建立的动态可用状态：静态权限与只读声明在计划期强制，动态 availability 在执行该步骤前再次复核，失败时整组补偿。
- 播放头、播放开关等提交后会继续变化的会话控制属性必须声明 `verificationStrategy: 'execution'`，用正式执行器证据验收；持久状态仍默认用最终世界状态验收。
- 输入中 `entityType` 与 `target.kind` 表达同一事实时，由适配器统一规范化；领域 provider 可将全局唯一的短引用补全成正式稳定引用，但存在歧义时必须拒绝。不得让模型为可无歧义消解的引用格式多空转一轮。
- 一次正式写入产生领域级联副作用（例如对象动画属性自动创建状态关键帧）时，执行器必须返回强类型 Effect Receipt；`evidence` 只用于验证和人类说明，禁止承担副作用记账。级联 receipt 必须引用静态 `declarationId`，未声明的级联使事务失败并补偿。
- 公共执行入口在执行器完成后立即运行 `resolveObservedEffects` 并把校验后的 Effect 固化进 observation；操作账本只记录这份结构化事实，不从输入、引用字段或 evidence 文本猜测。
- 动态 availability 的阻断必须区分 structural、permission 与 state；只有 state 阻断且前序 direct/cascade Effect 可能满足条件时，才允许延迟到该步骤执行前复核。
- **拒绝必须能被自我修正。** 任何拒绝路径都要带上运行时已经知道的事实：实体类型写错就列出该域注册了哪些，属性写错就列出这个实体有哪些，参数被静默丢弃就说清丢了哪些键、可用的是哪些，容量不够就给出上限。只给一个错误码等于让模型继续猜，而它猜不中就是死循环。

## 迁移纪律

迁移旧能力时，同一模块完成后**立即删除**对应旧实现，禁止长期双轨。

专用能力与通用动词因契约需要共存时，两条路径必须委托同一正式领域服务；不得各自维护校验、状态变换或 Store 写入。

## 验证

```bash
npm run check:assistant-capabilities
```

`check:assistant-capabilities` 已接入 `build` 与 `electron:build` 链路，覆盖不全、写入声明悬空、双路径不变量失守或残留旧通道会直接构建失败。

CI 必须显式运行该门禁；门禁同时验证双端技能同步、旧执行入口、Application API 跨层导入、Surface 观察策略以及任意 Patch/脚本禁令。

### 覆盖门禁的断牙验证

新增或修改覆盖门禁时，**必须实跑一遍红→恢复→绿**，否则等于没有门禁。门禁场景包括：

| 破坏 | 预期报错 |
|---|---|
| 删掉写入表里某条属性 | 该属性在反射层声明为可写，执行器却写不了 |
| 往写入表加一条反射层没声明的属性 | 该属性执行器能写、反射层没声明，是死代码 |
| 把 `asset.library_refs` 的 `operations` 改成 `['set']` | 声明的 operation 与执行器实际接受的不一致 |
| 删掉执行器里落地的那次调用（如 `moveShotTime`） | 功能测试红：值没有真的改变 |
| 账本删掉一条动作 | `tsc` → `TS2741: Property 'xxx' is missing` |
| store 新增动作但没建账 | 该动作界面能做、账上没有 |
| 账本绑到一条执行器写不了的属性 | 账目指向的属性没有任何执行器能写，账是假的 |
| 账本留一条 store 里已删除的动作 | 账目对应的 store 动作已不存在，账没销 |
| feature 无 Reflection 也无账本且未登记 | 领域对助手不可见且未登记原因 |
| store 无账本（storeId 对不上）且未登记进 `ASSISTANT_BLIND_STORES` | store 未建账且未登记原因 |
| 删掉 provider 的 `getCollectionAvailability` | TypeScript 点名缺失实现 |
| 忽略 provider 的 `available:false` 或移除 describe 动态投影 | Registry/适配器测试看不到当前状态限制 |
| 删除一个写域的结果场景登记 | `resultBehaviorCoverage` 点名缺失领域或数量不足 |

再按 [testing.md](testing.md) 运行本次能力登记、处理器或正式业务服务的精确/相关测试。`npm run test:assistant-production` 只用于同时影响应用运行时、Pi 调度、授权或持久化等多个模块的改动，以及生产验收/发布前检查；不要因普通能力登记或界面适配运行整套助手测试。

只有改动跨越“模型决策 → 工具调用 → 业务落地 → 成功证据”完整链路，且精确测试不足以证明行为时，才无窗口执行真实助手端到端验证：

```bash
npm run assistant:cli -- --goal "任务描述" --trace detailed
```

CLI 仅使用 Pi，复用侧栏正式服务，结束时输出 `runId`，可通过 `npm run logs:query -- --chain <runId>` 查询；默认只读，模型回复完成不等于业务验收。产物过期先执行 `electron:bundle`。真实资料目录的写入和付费调用必须有明确授权；本轮隔离资料验收允许受控写入，不进行真实付费生成。跨工程、退出重启与协议验收统一使用 `test:reality`，以实际领域状态和正式日志作为证据。

## Surface 视觉观察

- 每个注册 Surface 都必须声明统一观察能力、领域提供者、捕获范围、数据等级、遮罩策略、支持模态、最大尺寸和失效条件，并通过覆盖清单门禁。
- 提供者、数据等级、遮罩策略和支持模态的唯一判断入口是 `resolveSurfaceObservationProfile`（`src/core/application-control/applicationSurfaces.ts`）；`surfaceCatalog.ts` 与覆盖清单都从它派生，**禁止**在任何一侧另写一份判断。
- 界面标注 `data-application-surface-id` 时必须从目录反查（设置用 `resolveSettingsSurfaceId`），**禁止**在组件里复制分区到 Surface 的映射表；新增设置分区只改 `SETTINGS_SECTION_IDS` 与 `surfaceCatalog.ts`。
- `observe_application_surface` 的 `target` 默认是 `window`：截取整个应用窗口，任何时候都可用，不需要先切页面。只有需要排除干扰、聚焦某一块时才传具体 surfaceId，且该 Surface 必须当前可见。
- 生成结果、素材、视频和音频有稳定媒体引用时优先返回原件，不得退化为页面缩略图。
- 通用截图只能由渲染层提交当前窗口内的可见边界和敏感矩形，主进程只调用当前 Henji-AI `webContents.capturePage` 并再次校验范围；**禁止 OS 桌面截图、其他应用窗口和越界回退**。整窗指的是本应用窗口，与桌面截图是两回事。
- **遮罩只认显式标记 `data-observation-sensitive`**。不要再对所有输入控件一律涂黑：密钥输入框本身是 `type="password"`，界面上就显示圆点，截图同样是圆点；把提示词、参数、搜索框涂黑只会让整窗观察失去意义。
- 因此：凡是把**明文**本地绝对路径、密钥、令牌渲染出来的节点（无论是不是输入框），必须自己标 `data-observation-sensitive`，否则会被原样截给模型。日志同样不得记录截图内容、密钥或原始路径。
- 截图与媒体的投影必须遵守当前调用者授权和模型真实模态、大小、时长、编码及取消约束；只返回引用不代表模型已看到像素。应用内截图使用 `observe_application_surface`，原始媒体使用正式媒体读取入口。
- **禁止**新增只返回媒体引用、预览 URL 或“已截图”标记的观察能力：模型看不到像素却会以为自己看过了。观察结果必须返回 `verificationKind: 'visual_pending_model'` 加合法附件（见 `readPendingVisualObservation`），否则不要声称产生了视觉证据。
- 三维、画布这类空间写入完成后必须调用所属领域的结构化验证能力；视觉证据只是加成，不可替代结构化验证，且未真实读取媒体时必须标注“未做视觉验证”。
- 最终答复必须区分结构化验证、实际媒体视觉验证和未验证；稳定媒体引用本身不是视觉验证证据。
