# 智能助手应用能力覆盖

> 读取时机：新增或修改工作区、页面、浮层、工具箱工具、设置项、用户可查询数据、业务操作、稳定引用、权限、宿主上下文或能力搜索。
>
> **这些场景必须同时读 skill `henji-application-capability`**（含 schema 字段、注册模式、迁移步骤与示例代码）。本文件只是硬约束清单。

## 唯一元数据源

所有向助手开放的功能必须以 `ApplicationCapabilityDefinition` 作为 schema、权限、风险、数据等级、引用、可用条件、并发规则、成功证据和失败恢复的唯一元数据源。

AI 输入 schema 顶层必须设置 `additionalProperties: false`。禁止 `patch`、`storePatch`、`executeScript`、`script`、`code` 等任意 Store Patch 或脚本执行字段；需要新增参数时先扩展正式领域 schema/注册表。

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

### 能力可达性：注册好的能力，模型必须找得到

覆盖判断只保证「能力存在」，不保证「模型能拿到它」。这一节管后半段——已经因此翻车四次，
每次形状完全一样：发现层拿模型填的某个软信号做硬过滤，模型填得稍有出入，注册好的能力就从
目录里整个消失，模型于是如实回答「应用没有这个能力」。它没说谎，用户看到的却是凭空的能力否认。

- **发现层的准入只允许按域判断**（`capability-discovery.ts` 的 `structuralMatch`）。
  `entityTypes` 只参与排序，**不得**用于过滤。它来自模型对任务的猜测，猜错的代价不该是能力
  消失；域是注册表定义的、模型只是转述，所以只有它留下。想加新的过滤条件时，先读
  `structuralMatch` 上方那四条事故记录——`targetSurfaceIds`、`capabilityKinds` 就是在那里被
  当成硬过滤翻的车，它们已随请求扁平化一起删除。
- 排序信号不够用时，改排序（`entityTypeScore`、语义查询命中）或补保底
  （`pairReadAndWriteByEntity`），不要改回过滤：排错顺序只是慢一点，过滤错了是直接没有。
- **发现请求是模型写的，运行时不改写**（v3：`queries` / `domains` / `entityTypes` / `writes`）。
  曾经有一个 `normalizeCallInput` 把模型的请求整个覆盖成运行时算出的依赖前沿，理由是"运行时
  自己就知道答案"。代价是主模型——唯一拿得到完整会话历史的角色——连"我要的东西在另一个领域"
  都表达不了，只能把工具可用性当成意图证据反推自己判断错了。
- **投影只能回答注册表知道的事，不能回声模型的提问。** `scriptApi.entities` 的实体与属性清单
  只允许来自匹配到的能力，**不得**把请求里的 `entityTypes` 或从 `queries` 正则抠出的标识符并
  进去——那等于模型问"有没有 X"、投影答"你的清单是：X、…"，模型照着写脚本必然撞
  `ENTITY_TYPE_NOT_FOUND`，而且每次重新发现都在重复同一个谎。宁可少说，不能乱说。
- **投影体积就是行为**。发现结果一旦越过卸载阈值就会被存成 artifact，模型只能分页回读——实测
  一次运行 18 次 `read_agent_artifact`、25 个模型步不收敛。所以"把 action 和 recipe 都给出去让
  模型自己选"是错的：给得越多，模型实际看到的越少。门禁在
  `capability-discovery-size.test.ts`，直接判历史投影会不会触发卸载。
- **卸载判定必须两处同尺子**，包括先裁再判。`runner-results.toolMessage` 与
  `prompt-layers.formatObservation` 都调 `shouldOffloadObservation`，任何一处漏了
  `projectForHistory`，同一份结果就会一边内联一边卸载，模型看到 artifactRef 就去回读一份它
  已经有的内容。门禁在 `offload-same-ruler.test.ts`。
- **能力声明的 `entityTypes` 必须与反射注册表登记的**同一个名字**。** 同一样东西两个名字不是
  命名不整齐：发现层会把能力声明的那个名字投影进 `scriptApi.entities.entityTypes`，模型照着写
  脚本就撞 `ENTITY_TYPE_NOT_FOUND`，而真正存在的那个因为没有能力声明它，读写配对保底也认不出。
  实测设置域声明 `application.setting`、注册表登记 `settings.registry`，一次改设置因此从 5 回合
  3.8 万 token 变成 18 回合 25 万 token。
- **能力声明的 effect 必须覆盖它真正产生的全部 effect**，用 `alsoImpacts` 补齐。漏一条不报错，
  但发现层排序按 effect 走，漏声明的能力会排到无关能力后面。名字里带
  create/add/delete/remove/open/switch 的能力，`registry.test.ts` 会强制它声明对应 effect，
  例外必须写进 `justifiedExceptions` 并说明理由。
- 门禁在 `electron/main/services/agent-runtime/context/capability-reachability.test.ts`：
  全部能力 × 全部域 × 故意填错的实体，任一能力从自己域里消失即红；另一条守
  「模型把域和实体都说对时必须真的进租约」——发现得到却租不到，对模型是同一种结局。
- 它与 `storeActionCoverage.test.ts` 合起来才是完整命题：账本守「绑定的能力 id 确实存在」，
  可达性守「存在的能力确实找得到」。**两条缺一条，命题就断了**，删任何一条前先想清楚这件事。

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
- 跨模块传递实体必须用 `ApplicationRef` 或 artifact 引用，**不得**向模型暴露原始密钥、本地路径或不受控的大对象
- **不得**以"助手已判断"为理由绕过安全边界
- **禁止**从能力处理器直接调用 Store `setState` 做任意 Patch；仅允许正式领域服务内部对已声明字段执行确定性状态提交
- **禁止**在 Application API、能力定义或 Agent Runtime 增加 `eval`、`new Function` 或任意脚本执行入口

## Henji Script 单一自动化内核

两个以上应用操作统一由模型可见的 `run_henji_script@1` 执行。模型只从能力发现的 `scriptApi` 使用 `app.entities` / `app.action` / `app.recipe` / `app.assert`；版本、revision、稳定引用和数据依赖全由宿主解析。

- Henji Script 是 TypeScript 风格的受限子集：只用 TypeScript Compiler API 解析为自有 IR，永不运行转译后的 JavaScript。`import` / 文件 / 网络 / 进程 / DOM / Store / 反射 / 无界循环必须在首次写入前拒绝。
- Henji Script 的引导分四层且不得互相复制：system prompt 只保留“应用操作必须先发现、只经 `run_henji_script` 执行”等不可选协议；`run_henji_script` 工具契约声明语言和安全边界；首次发现的 `scriptApi` 动态提供本轮真实 API/schema；内置领域 skill 只提供业务选择与已验证 Recipe。禁止在 system prompt 或通用 skill 静态抄写领域 action 参数。
- 不新增泛化的“Henji Script 教程”内置 skill。语言语法和可调用 API 必须自描述于工具契约与 `scriptApi`，否则 skill 未触发或版本漂移时会形成旁路；领域 skill 只讲“何时用哪个 Recipe/业务顺序”，项目级 `henji-application-capability` skill 只指导开发者如何接入。
- 只有 `run_henji_script@1` 可以声明 `source`；其他能力仍禁止 `source/script/executeScript` 类任意脚本入口。
- Recipe 只生成同一份 Henji Script IR，不拥有第二套解释器、引用绑定、Effect、补偿或验证逻辑。任何具体步骤必须先通过正式结果测试。
- 用户明确的负向执行约束（例如“不要切换界面”“不要删除”）由 Gateway 与审批边界承担；最终说明必须与 Effect Receipt 对账，禁止否认已经发生的副作用。
- 脚本只能调用本轮 `scriptApi` 租约披露的 API；“全局注册了但本轮没发现”仍必须在执行器调用数为 0 时拒绝。
- `scriptApi` 必须在首次发现时合并工具目录与渲染层真实反射注册表，只投影本轮实体定义及属性值约束；enum、范围、引用形状、nullable、写 operation、集合父类型和必填属性不得靠模型猜测或在提示词另抄。
- 字面量、对象、数组及三元表达式等可静态确定的属性候选值必须在首次 Gateway 调用前按同一反射约束验证；任一分支非法就整段拒绝。依赖读取结果的值在脚本变量内流动，不为方便模型而把正式业务值塞进执行摘要。
- 每个步骤仍通过唯一 Gateway 的 schema、权限、revision、动态 availability、Effect Receipt 与审计。完成只由 Effect 与正式状态验证决定，不信任脚本文本、`completed` 或 evidence。
- 跨领域结果只通过完整 `ApplicationRef` 和正式桥梁能力传递，禁止拼接、截断或猜测引用。

## 必须接入的现有机制

新能力必须接入：权限审批、revision、幂等、撤销、并发、脱敏、结构化日志、成功证据验证。

- 同一通用事务允许按顺序多次写同一属性；只有最后一次写入参与最终状态等值验证，中间值必须由结果级场景验证其领域副作用。
- 反射描述必须公开属性实际接受的 `writeOperations`。高层 `set` 与底层 append/remove 不一致时，由计划器确定性编译为最小差异；不受支持的操作必须在计划期拒绝，禁止留到执行期失败。
- 后置步骤可以依赖前序步骤刚建立的动态可用状态：静态权限与只读声明在计划期强制，动态 availability 在执行该步骤前再次复核，失败时整组补偿。
- 播放头、播放开关等提交后会继续变化的会话控制属性必须声明 `verificationStrategy: 'execution'`，用正式执行器证据验收；持久状态仍默认用最终世界状态验收。
- 输入中 `entityType` 与 `target.kind` 表达同一事实时，由适配器统一规范化；领域 provider 可将全局唯一的短引用补全成正式稳定引用，但存在歧义时必须拒绝。不得让模型为可无歧义消解的引用格式多空转一轮。
- 一次正式写入产生领域级联副作用（例如对象动画属性自动创建状态关键帧）时，执行器必须返回强类型 Effect Receipt；`evidence` 只用于验证和人类说明，禁止承担副作用记账。级联 receipt 必须引用静态 `declarationId`，未声明的级联使事务失败并补偿。
- 工具网关在执行器完成后立即运行 `resolveObservedEffects` 并把校验后的 Effect 固化进 observation；最终成功封存只消费这份结构化事实，不从输入、引用字段或 evidence 文本猜测。
- 动态 availability 的阻断必须区分 structural、permission 与 state；只有 state 阻断且前序 direct/cascade Effect 可能满足条件时，才允许延迟到该步骤执行前复核。
- 应用执行终态与最终语言说明终态必须分离。写事务、Effect 对账和正式验证完成后立即封存成功；封存后的模型失败、超时或文本事实校验失败只能进入 `completed_with_warning` 并使用确定性摘要，禁止产生 `RunFailed`。封存前失败仍按失败处理。
- 外部等待前必须把经过 schema 校验的 Henji Script IR 断点、有限变量、完整稳定引用、Effect Receipt 与验证状态一起持久化；不得保存源码、模型文本或任意运行对象。自动续接固定执行“权威状态读取 → 同一解释器从断点继续”，禁止让模型重新生成剩余步骤，禁止从 working summary 或任务 ID 重建引用与 Effect；断点缺失或摘要不匹配时必须在后续写入前阻断。
- **封存点是「模型自己决定收工」**：本轮不再调工具、给出最终答复，且有真实写入 Effect、运行客观上已经停下来（没有执行中的步骤、没有待批审批、恢复检查已完成、没有记下的未收敛事项）。不得在模型请求前用任何预测判它做完了并撤掉工具——旧实现按运行前猜出来的任务图结算，模型明知用户要的颜色还没设也只能收工。Effect Receipt 中的 `targetRefs` 必须来自执行器真实输出并保持完整稳定引用。
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

新增或修改覆盖门禁时，**必须实跑一遍红→恢复→绿**，否则等于没有门禁。已验证过的九个场景：

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

再按 [testing.md](testing.md) 运行本次能力登记、处理器或正式业务服务的精确/相关测试。`npm run test:assistant-production` 只用于同时影响 runner、状态机、调度、审批、持久化或模型适配等多个助手运行时模块的改动，以及生产验收/发布前检查；不要因普通能力登记或界面适配运行整套助手测试。

只有改动跨越“模型决策 → 工具调用 → 业务落地 → 成功证据”完整链路，且精确测试不足以证明行为时，才无窗口执行真实助手端到端验证：

```bash
npm run assistant:cli -- --goal "任务描述" --trace detailed --await-generation
```

复用正式助手与工具链，结束时输出 `runId`（可用 `npm run logs:query -- --chain <runId>` 查整条链路）。`--await-generation` 保持同一隐藏宿主并读取本次生成任务的最终状态。`--print-trace` 输出本机已脱敏的详细追踪。**涉及付费或写入操作时，必须由调用者显式确认 `--approval full_access`。**

## Surface 视觉观察

- 每个注册 Surface 都必须声明统一观察能力、领域提供者、捕获范围、数据等级、遮罩策略、支持模态、最大尺寸和失效条件，并通过覆盖清单门禁。
- 提供者、数据等级、遮罩策略和支持模态的唯一判断入口是 `resolveSurfaceObservationProfile`（`src/core/assistant/applicationSurfaces.ts`）；`surfaceCatalog.ts` 与覆盖清单都从它派生，**禁止**在任何一侧另写一份判断。
- 界面标注 `data-application-surface-id` 时必须从目录反查（设置用 `resolveSettingsSurfaceId`），**禁止**在组件里复制分区到 Surface 的映射表；新增设置分区只改 `SETTINGS_SECTION_IDS` 与 `surfaceCatalog.ts`。
- `observe_application_surface` 的 `target` 默认是 `window`：截取整个应用窗口，任何时候都可用，不需要先切页面。只有需要排除干扰、聚焦某一块时才传具体 surfaceId，且该 Surface 必须当前可见。
- 生成结果、素材、视频和音频有稳定媒体引用时优先返回原件，不得退化为页面缩略图。
- 通用截图只能由渲染层提交当前窗口内的可见边界和敏感矩形，主进程只调用当前 Henji-AI `webContents.capturePage` 并再次校验范围；**禁止 OS 桌面截图、其他应用窗口和越界回退**。整窗指的是本应用窗口，与桌面截图是两回事。
- **遮罩只认显式标记 `data-observation-sensitive`**。不要再对所有输入控件一律涂黑：密钥输入框本身是 `type="password"`，界面上就显示圆点，截图同样是圆点；把提示词、参数、搜索框涂黑只会让整窗观察失去意义。
- 因此：凡是把**明文**本地绝对路径、密钥、令牌渲染出来的节点（无论是不是输入框），必须自己标 `data-observation-sensitive`，否则会被原样截给模型。日志同样不得记录截图内容、密钥或原始路径。
- `observe_application_surface` 是否开放由运行时 primary/observer 的真实媒体模态与权限共同决定；实际媒体仍要经过 provider 协议、大小、时长、编码和取消门禁。它是**唯一**会把像素送进模型的观察入口，本轮是否可用由 `tool_contracts.visualObservationAvailable` 显式告知模型。
- **禁止**新增只返回媒体引用、预览 URL 或“已截图”标记的观察能力：模型看不到像素却会以为自己看过了。观察结果必须返回 `verificationKind: 'visual_pending_model'` 加合法附件（见 `readPendingVisualObservation`），否则不要声称产生了视觉证据。
- 三维、画布这类空间写入完成后必须调用所属领域的结构化验证能力；视觉证据只是加成，不可替代结构化验证，且未真实读取媒体时必须标注“未做视觉验证”。
- 最终答复必须区分结构化验证、主模型视觉验证、观察模型视觉验证和未验证；稳定媒体引用本身不是视觉验证证据。
