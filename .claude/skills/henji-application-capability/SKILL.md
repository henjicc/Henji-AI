---
name: henji-application-capability
description: 为 Henji-AI 新增、修改或迁移应用能力，并完成内置 Pi 与现代 MCP 的同源适配。新增工作区、页面、浮层或工具入口、用户数据、设置、业务操作、长任务、稳定引用、权限、宿主上下文、能力搜索，或清理旧 HostCommand/HostQuery/Agent 工具时使用；纯样式、布局、文案和不改变业务能力的组件调整不使用本 skill。
---

# 痕迹AI 应用能力适配

## 当前适用范围

UI、内置 Pi 与现代 MCP 共用正式领域服务和应用运行实例。公共契约位于 `src/core/application-control/`，渲染层在 `src/features/application-control/` 装配各领域，Electron 的 `services/application-runtime/` 协调授权、执行、账本、费用与恢复，先于 Pi 和 MCP 初始化。

Pi 与 MCP 只负责工具和结果投影，不拥有业务状态。MCP 固定使用正式协议 `2026-07-28` 与拆分 SDK `2.0.0`，拒绝旧协议；授权逐请求核验，持久操作不随网络连接结束。旧自研助手、Henji Script、发现租约和旧前端工具桥已移除，不保留兼容执行链或旧数据迁移要求。

将领域能力接入公共注册和执行入口。先找正式业务服务，再声明或扩展实体；不要为 Pi 或 MCP 复制业务实现。

## 执行流程

### 路由分级（先于第 0 步）：命中 skill 不等于新增 MCP 工具

先回答下面七个问题，再决定工作深度：

1. 是否新增用户可读的数据、状态或设置？
2. 是否新增属性修改、集合增删或业务动作？
3. 是否新增长任务、付费、取消、恢复或迟到结果语义？
4. 是否新增跨工程／跨领域稳定引用？
5. 是否新增文件、网络、持久化、权限或其他副作用？
6. 是否新增页面、浮层、工具入口或可导航 Surface？
7. 是否只是把现有能力换一种布局、文案、样式或展示方式？

按答案分三级执行：

| 级别 | 判断 | 本 skill 的动作 |
|---|---|---|
| **仅呈现变化** | 前六项均否，第七项为是 | 停止本 skill；改用 `henji-ui-surface`。不得新增能力、实体、schema 或 MCP 工具 |
| **覆盖核对** | 只新增页面、浮层、入口或导航；数据和操作完全复用现有正式能力 | 核对 Surface／导航登记、已有实体与能力的可发现性、入口是否直接复用正式服务。记录核对结论，不新增同义实体、专用能力或 MCP schema |
| **能力增量** | 前五项任一为是，或现有正式声明无法表达新入口的业务语义 | 继续完整流程：先找唯一业务实现，再补领域声明、执行器、权限、账本、结果验证与多入口投影 |

多个 skill 可以同时命中，但职责不能重复：`henji-ui-surface` 管界面层级与呈现，`canvas-node-builder` 管画布节点结构，`henji-model-adaptation` 管供应商与模型契约，本 skill 只管应用能力增量和覆盖证明。不要为满足 skill 数量制造额外适配层。

### 0. 先判断该不该写专用能力

**默认不写。** 反射层已经提供三个通用动词，领域只要注册实体和属性，助手就能用：

| 需求 | 做法 |
|---|---|
| 读某个状态 | 注册实体和属性即可，`list_application_entities` / `read_application_entity` 自动可用 |
| 改某个已有对象的属性 | 注册属性并实现 `ApplicationMutationExecutor`，`change_application_entities` 自动可用 |
| 新增或删除集合成员 | 实体描述里声明 `collectionWrite`，实现 `ApplicationCollectionExecutor` |
| **带算法的语义操作** | 才写专用 `ApplicationCapabilityDefinition` |

静态属性与 `collectionWrite` 只表示“结构上支持”。每个 provider 还必须通过 `getPropertyAvailability` / `getCollectionAvailability` 返回当前引用、模式和状态下的真实可用性；没有额外集合限制时复用 `unrestrictedCollectionAvailability`。计划、提交预检和每步执行前由统一事务引擎复核，领域服务里不再复制模式守卫。

`describe_application_entities` 可带 `refs` 查询实例级动态状态。recovery 只放结构化能力/实体/属性标识；任何操作步骤必须先通过正式 `describe → change → read/真相源` 结果测试，禁止凭读代码猜一条路线写进提示或错误。

只有当动作**无法用属性写入表达**时才写专用能力——例如"环绕运镜"要按角度采样算轨迹，"复用或布置对象"要做碰撞检测和复用判定。凡是"设置某某值""加一条记录"这类，一律走通用动词。

Camera Stage 只公开 `camera_stage.state_keyframe`。动画操作必须走已经过结果测试的路径：在**同一次** `change_application_entities` 的 `changes` 中按顺序交替写 `camera_stage.playback.current_time` 与对象、角色或摄像机的 `animatable.*` / `pose_preset`，最后可在同一事务写 `loop/playing`；应用会自动创建或更新完整场景状态，任一步失败则整体回滚。除非后一步需要前一步新创建且尚未返回的引用，否则禁止按时间点拆成多轮调用。派生属性轨道只供播放与导出，不能注册为公开实体或持久化真相源。

多项实体写入使用同一通用事务，算法操作经正式领域能力执行。输入约束由反射和能力 schema 投影；跨领域使用完整稳定引用，不创建额外脚本编排入口。

声明了可写属性就必须注册 `ApplicationMutationExecutor`，声明了 `collectionWrite` 就必须注册 `ApplicationCollectionExecutor`。每个实体必须至少拥有一种写入执行器，或填写 `writeExclusion.reason`，明确说明为何只读以及状态由哪个正式模块或操作维护；不得用“暂时不支持”代替判断。三者由覆盖测试强制一致。

**新增可写属性只在一处声明。** 一个属性此前要碰 4 个位置（属性描述符、读取映射、写入表项、界面动作账本），缺任何一处都是静默失效——不报错，助手安静地少一块能力，只有用户实机撞上才发现（三维场景外观 24 项当初就是这样漏掉描述符和读取两处）。现在统一走 `src/core/application-control/fieldDefinition.ts` 的 `ApplicationFieldDefinition`：

```ts
sceneField('sky_color', '天空颜色', COLOR, {
  read: (settings) => settings.sky.color,
  write: (store, value) => store.setSceneSkyColor(value),
  storeAction: 'setSceneSkyColor',
})
```

一条声明用 `fieldDescriptors()` / `fieldReadValues()` / `fieldWriterTable()` / `fieldLedgerEntries()` 派生出描述符、读取映射、写入表项、账本条目四样东西，四个消费方各取所需。字段定义按领域收在 `<领域>Fields.ts`（如 `cameraStageSceneFields.ts`、`canvasFields.ts`、`assetFields.ts`），领域内部再包一层 `<领域>Field()` 薄封装填好该领域固定的 entityType、权限、revision scope。同一个 store 动作被多个字段共用时（如 `updateObject` 一次改 name/visible/color/character_variant 四个属性），`fieldLedgerEntries()` 按声明顺序把它们累进同一条账本绑定。禁止再分别手写这四处——统一定义之后漏一条是整条从四处一起消失，会被 `storeActionCoverage` 门禁当场抓到，而不是像以前那样只漏两处却全绿。

### 0.5 一次声明、多入口投影

同一份领域声明现在同时服务三个入口：应用界面、内置 Pi、**外部智能体（MCP）**。新增能力时只写一次声明，三个入口各自投影；**任何一处出现第二份业务字段表都算缺陷**。

| 要让外部智能体看到的东西 | 唯一声明处 | 谁来投影 |
|---|---|---|
| 工具名、参数、必填项 | `ApplicationCapabilityDefinition` 的 Zod `inputSchema` | `localApplicationHost.ts` 用 `z.toJSONSchema` 投影，随宿主注册送到主进程 |
| 哪些域／实体可读可写 | 反射注册表的 `exposures`、`requiredPermissions.write`、`collectionWrite` | `src/features/application-control/externalCapabilityInventory.ts` |
| 有意只读及其原因 | 实体的 `writeExclusion.reason` | 同上，投影成外部契约里的 `readOnlyReason` |
| 通用读改增删的公开写入范围 | 同上派生结果 | 随注册跨进程送达，`operationCoordinator` 直接消费 |
| 写入的并发与幂等信封 | 协议层固定的 `operationId` + `baselineIds` | `electron/main/services/application-runtime/toolCatalog.ts` 统一注入 |

由此得到几条硬要求：

- **不要在 `electron/main/services/mcp/**` 写任何业务字段、实体类型或属性清单。** 那里只允许协议层自身的参数（操作标识、分块偏移、契约发现），业务参数一律从能力定义投影。前缀白名单尤其禁止——它和领域声明是两份真相，新增写域时必然漂移。
- **新增前端业务能力**：在正式能力声明中登记参数、权限和控制影响，并接入正式执行器；MCP 工具集合、权限及参数自动投影，禁止再手写 MCP ID 白名单。语义写入必须声明 `resolveOperationTargets`，创建操作还要用 `resolveOperationWriteTargets` 绑定操作身份；纯导航由注册表统一绑定视图身份。
- **复用与排除在原声明中登记**：普通读改增删使用通用实体入口；已有专用别名可声明 `external.kind: delegate` 和实际实体、操作及属性，覆盖检查必须证明它们确实开放且可写。内部协议写明 `internal` 原因，保存恢复写明 `recovery` 并仅走原操作账本。不得用排除掩盖缺失的业务执行器。
- **防遗漏从软件全集检查**：`applicationControlCoverage.test.ts` 核对全部前端能力的 MCP 路由、执行器、目标绑定和委托字段，配合属性、集合、Surface 与 store 动作门禁。新增功能只留在组件里而不登记不算完成；必须加入现有正式注册入口。内置 Pi 默认延迟加载新领域工具，不需要跟着新增一份启用名单。
- **新增一个已登记的业务实体或属性**，外部立刻可读可写，不需要回到 MCP 侧登记任何东西。做不到就说明有人加了第二份表。
- **有意只读必须写 `writeExclusion.reason`**。它是"未完成"和"有意排除"在机器上唯一的区分方式，并且会原样出现在外部契约里，成为调用方改道的依据。不接受"暂时不需要"这类无法验证的表述。
- **契约变化同步正式消费者与测试**：新格式由统一 schema 校验；不为本轮删除的旧执行链、旧协议或旧数据增加兼容分支。
- **参数错误必须点名字段**。基础工具要能被直接调用并拿到具体错误；把校验失败和业务失败收敛成同一句兜底文案，等于逼调用方猜。
- **不能假设客户端支持高级扩展**。发现、读取、修改、查任务、取结果五步必须都走普通 tools 调用：通知改成轮询查询工具，资源读取保留工具入口，审批留在痕迹 AI 内完成。降级不得放宽授权边界。

守这几条的门禁：`electron/main/services/application-runtime/toolCatalog.test.ts`（schema 同源与授权过滤）、`src/features/application-control/externalCapabilityInventory.test.ts`（八个业务写域与只读原因）、`collectionCoverage.test.ts`（每个实体要么能写要么写明原因）。

### 1. 判断能力边界

- 先定位正式业务服务，禁止让能力处理器复制业务逻辑。
- 专用能力与通用动词同时触达同一状态时，两条路径必须委托同一个正式业务服务。
- 判断执行位置：依赖 DOM、当前页面轻状态或即时视觉反馈时放渲染层；文件、数据库和系统权限由主进程协调；CPU 重计算放 Worker，像素处理复用正式 GPU／Worker 管线，领域状态留在所属服务。
- 将一个算法能力限定为一个可验证动作。确有预览/审批语义的查询、计划、提交可注册成独立原子 action，并共用领域状态和执行协调。禁止用一个开放参数工具承载任意操作。
- 后台能够完成的操作不要切换页面；只有用户明确要求查看、定位或进入编辑器时才使用 Surface 能力。
- “不要切换/不要删除”等负向约束由 Gateway 与审批边界承担；最终说明须用 Effect Receipt 反查这类事实，禁止否认已经发生的副作用。

### 2. 定义原生能力

- 实体、属性和集合 CRUD 在 Application Control 反射注册表中声明，由通用实体工具投影；不得为它们再写同义的专用能力。
- 只有无法用 CRUD 表达的算法操作，才在 `src/core/application-control/domains/` 的领域能力模块中声明 `ApplicationCapabilityDefinition` 并注册到统一目录，由公共应用入口调用。
- 使用稳定、小写的能力 ID；版本从 1 开始，破坏性契约变化才升级版本。
- 完整声明输入/输出 schema、AI 输入 schema、领域、别名、读写属性、风险、数据等级、权限、超时、幂等、撤销、预览、作用域、可用条件、前置能力、并发键、引用类型、成功证据和失败恢复。
- AI 输入 schema 顶层必须 `additionalProperties: false`，禁止开放 `patch`、`storePatch`、`executeScript`、`script` 等任意 Store Patch 或代码入口。不得新增源码执行字段。
- 用户化描述只说明用途和影响，不写协议名、schema、revision、风险编号或开发解释。
- 输入和输出优先传 `ApplicationRef`；禁止传原始密钥、本地路径或不受控的大对象。
- 写能力必须绑定相关 scope revision；未知副作用的写操作禁止自动重放。

详细字段选择和范式见 [references/capability-patterns.md](references/capability-patterns.md)。

### 3. 绑定执行处理器

- 由所属功能模块注册处理器，不把新处理器继续堆进全局 command/query 执行表。
- 使用通用 capability 信封执行，禁止新增 `kind: 'command'`、`kind: 'query'`、`HostCommand` 或 `HostQuery` 分支。
- 执行前由统一入口校验版本、输入、权限与 expected revisions；执行后校验输出 schema 和成功证据。
- 关键链路在实际执行层记录 `start`、`completed`、`failed`，日志只记录稳定引用和脱敏信息。
- 页面尚未打开时也应能调用正式业务服务；确实依赖可视编辑器时，在 `availability` 和前置条件中明确声明。

### 4. 接入按需发现

- MCP 按授权返回稳定排序的声明目录，宿主未就绪时不隐藏静态工具；执行给出准确状态。Pi 按需披露同一目录，不能另写业务名单。
- 实体与属性约束只从真实注册表派生，模型猜测和当前页面不能隐藏已注册业务能力。
- 执行结果以真实输出、副作用、领域回读和持久化状态为依据；模型说明失败不能改写已经发生的业务事实。
- 幂等键按调用者隔离，执行前登记；未知结果先查询。取消等待不取消生成，保存恢复不重新执行业务动作。

- 为能力提供用户可能使用的中文、英文和领域别名。
- 声明 `acceptsRefs`、`producesRefs` 和前置依赖，让跨模块任务通过稳定引用衔接。
- Router 只提供页面锚点和搜索建议，不得以分类结果限制能力可用性或授权。
- 写能力必须通过 `control.impacts` 声明 Effect、实体和属性；一次输出可能影响多个目标时实现 `resolveObservedEffects(input, output)`，从真实结果解析数量、稳定引用和验证证据。没有解析器的能力一次最多贡献一个 Effect。
- 跨领域结果传递必须注册接收上游稳定引用的正式桥梁能力，并验证正式下游调用成功；禁止让模型猜测领域等价物、手工拼接内部路径，或把生成结果冒充素材。媒体 URL/本地路径只在宿主内部组合服务中流动。
- 反射层公开每个可写属性真实接受的 `writeOperations`；高层集合 `set` 由计划器确定性编译为 append/remove 最小差异，不支持的操作在计划期拒绝。
- 同一通用事务可以重复写同一属性，最终状态只验证最后一次写入；播放头、播放开关等会话控制声明 `verificationStrategy: 'execution'`，中间状态的真实领域副作用必须由正式结果测试覆盖。
- 后置步骤依赖前序步骤刚建立的动态可用状态时，静态权限仍在计划期拒绝，动态 availability 延迟到该步骤执行前复核，失败由事务补偿。
- `entityType` 与 `target.kind` 重复表达实体类型时由通用适配器统一规范化；领域 provider 只可在全局唯一时补全短引用，歧义引用继续拒绝。
- 写入触发自动创建/更新等领域级联副作用时，正式执行器必须返回带静态 `declarationId` 的强类型 Effect Receipt；evidence 只做验证与说明，禁止用它记账或只按输入猜影响范围。
- **拒绝必须能被自我修正**：实体类型写错就列出该域注册了哪些，属性写错就列出这个实体有哪些，参数被静默丢弃就说清丢了哪些键与可用的是哪些。只给错误码等于逼模型继续猜，而它猜不中就是死循环。
- AI 可见输入 schema 不暴露 `baseRevision` / `expectedRevisions`。并发基线只由 Gateway expected-revision 信封传入，不得形成第二条 revision 路径。

### 5. 覆盖新功能

优先用通用动词覆盖（见第 0 节）；只有算法型语义操作才注册专用能力。

新增或修改下列对象时，注册能力或加入带原因的显式排除清单：

- 工作区、工具页、设置页和浮层。
- 工具箱工具和用户可触发的业务动作。
- 设置项及其读取、计划、提交能力。
- 生成记录、素材、项目、节点等用户可查询数据。
- 可在模块间传递的实体引用。
- 公开实体、属性、语义操作、验证方式和 Surface 观察策略；漏登记必须由 `check:assistant-capabilities` 或覆盖测试阻断。

不得因为“暂时没有助手需求”而省略覆盖判断。

### 6. 迁移旧工具

- 将旧 Agent 工具的 schema、权限、语义和执行行为迁入原生定义及模块处理器。
- 同一模块迁移完成后立即删除对应旧工具、HostCommand/HostQuery 分支和旧处理器，禁止保留双实现。
- 保留审批、revision、撤销、幂等、并发、脱敏和结果真实性语义。
- 删除被替代的执行入口和兼容描述生成器；本轮不制作旧工程、历史或账本的迁移器，以新建数据验收。

### 7. 验证

- 运行能力覆盖检查，确认定义、处理器、Surface、设置和工具覆盖一致。
- 新增或改造 Surface 时必须在统一目录声明观察提供者、捕获策略、数据等级、遮罩策略、支持模态、尺寸预算和失效条件；不允许留下无理由的观察空缺。
- 观察提供者、数据等级、遮罩策略和支持模态只在 `resolveSurfaceObservationProfile` 判断一次，目录和覆盖清单都从它派生；界面标注 Surface ID 时从目录反查，不在组件里复制映射表。
- 观察默认走 `target="window"` 整窗，任何时候都可用；只在需要聚焦时传具体 surfaceId。截图范围永远只有本应用窗口，禁止桌面和其他应用窗口。
- 遮罩只认显式的 `data-observation-sensitive`。新增界面时，凡是把**明文**本地路径、密钥或令牌渲染出来的节点都要自己标上；`type="password"` 的输入框自带圆点掩码，不需要标。
- `observe_application_surface` 是应用截图入口，原始媒体通过正式媒体读取入口取得。不要新增只返回媒体引用或“已截图”标记的观察能力——模型看不到画面却会以为看过了；要产生视觉证据就返回 `verificationKind: 'visual_pending_model'` 加合法附件。
- 空间类写入（三维、画布布局）必须配一个结构化验证能力，并通过正式调用读回验证；视觉证据是加成，不能替代结构化验证。
- 视觉观察优先使用领域结构化状态或稳定原生媒体，其次使用专用视口，最后才允许捕获已注册的应用内区域；禁止回退为系统桌面、其他窗口或整屏截图。
- 观察结果只有被主模型或观察模型实际读取后才能标记为视觉验证；只有结构化证据或模态不可用时必须分别标记，不能把媒体引用文本当作已读取内容。
- 为每项能力验证合法输入、非法输入、权限、revision 冲突、成功证据和失败恢复。
- 每个拥有 mutation/collection 执行器的写域登记 2–3 条结果场景；必须从正式状态源或 `readEntity` 断言世界真的变化，`completed` 或 evidence 不算结果断言。
- 涉及跨模块任务时验证稳定引用传递，不得通过名称猜测或原始路径衔接。
- 按 `docs/rules/testing.md` 确定最小匹配检查。涉及公共核心契约及关键依赖的整轮重构在最终集成做一次 L3，不在每次搬移后重复全量。
- 关键结论依赖 Electron 生命周期、桥接或渲染时，使用正式 `test:reality` 隔离场景，检查实际截图和日志；产物过期只需 `electron:bundle`。不得以浏览器代替 Electron。

## 完成标准

- 能做的事优先通过通用动词暴露；专用能力只用于无法用属性写入表达的算法型操作。
- 声明 `collectionWrite` 的实体类型都注册了 `ApplicationCollectionExecutor`，由覆盖测试拦截。
- 每个 provider 都实现动态集合可用性；模式限制可在 describe 阶段看见，并由事务引擎统一执行。
- 每个实体都有 mutation/collection 执行器或非敷衍的 `writeExclusion.reason`；新增实体后运行 `npm run check:assistant-capabilities`。
- Application Control 反射注册表是实体、属性和集合 CRUD 的唯一元数据源；`ApplicationCapabilityDefinition` 是算法操作的唯一元数据源；Pi 与 MCP 工具目录都只能投影两者，不能成为第三份手写 schema。
- 新增已登记的业务实体或属性后，外部智能体无需任何 MCP 侧改动即可读写；有意只读的实体带得住 `writeExclusion.reason`。
- 对外输入、输出和错误通过公共契约校验，并由固定现代协议的官方 Client 经 HTTP 验证。
- 正式业务服务是唯一业务执行源。
- 普通界面不显示开发性解释。
- 新代码没有旧 command/query 兼容路径。
- 新代码没有任意 Store Patch、任意脚本执行或 Application API 核心跨层导入。
- 权限、revision、日志、引用和成功证据均有自动化验证。

- 用户编辑 A 时可后台读改、生成并保存 B；打开 B 复用同一实例和历史，关闭页面不结束已提交工作。
- 保存失败保留脏状态；删除和退出经过实例屏障，只有已保存、无任务、无使用者时才释放。
