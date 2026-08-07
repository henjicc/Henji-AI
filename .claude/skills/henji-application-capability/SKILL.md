---
name: henji-application-capability
description: 为 Henji-AI 新增、修改或迁移应用能力，并完成智能助手原生适配。新增或调整工作区、页面、浮层、工具箱工具、设置项、用户可查询数据、业务操作、稳定引用、权限、宿主上下文、能力搜索，或清理旧 HostCommand/HostQuery/Agent 工具时必须使用。
---

# 痕迹AI 应用能力适配

把应用功能注册成智能助手可按需发现、受控执行、能够验证的原生能力。始终以 `ApplicationCapabilityDefinition` 为唯一能力说明，不新增兼容工具路径。

## 执行流程

### 0. 先判断该不该写专用能力

**默认不写。** 反射层已经提供三个通用动词，领域只要注册实体和属性，助手就能用：

| 需求 | 做法 |
|---|---|
| 读某个状态 | 注册实体和属性即可，`list_application_entities` / `read_application_entity` 自动可用 |
| 改某个已有对象的属性 | 注册属性并实现 `ApplicationMutationExecutor`，`change_application_entities` 自动可用 |
| 新增或删除集合成员 | 实体描述里声明 `collectionWrite`，实现 `ApplicationCollectionExecutor` |
| **带算法的语义操作** | 才写专用 `ApplicationCapabilityDefinition` |

只有当动作**无法用属性写入表达**时才写专用能力——例如"环绕运镜"要按角度采样算轨迹，"复用或布置对象"要做碰撞检测和复用判定。凡是"设置某某值""加一条记录"这类，一律走通用动词。

历史教训：`camera_stage.keyframe` 的实体、属性、provider 早就注册齐了，助手能读能改，却因为没有创建路径而做不了任何对象动画，只能回一句"没有专用能力"。缺的不是能力，是那一行 `collectionWrite` 声明。

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

### 1. 判断能力边界

- 先定位正式业务服务，禁止让能力处理器复制业务逻辑。
- 专用能力与通用动词同时触达同一状态时，两条路径必须委托同一个正式业务服务。
- 判断执行位置：依赖 DOM、当前页面轻状态或即时视觉反馈时放渲染层；文件、数据库、网络、复杂计算、长耗时任务或系统权限放主进程。
- 将一个能力限定为一个可验证动作。查询、计划、提交分开注册，禁止用一个开放参数工具承载任意操作。
- 后台能够完成的操作不要切换页面；只有用户明确要求查看、定位或进入编辑器时才使用 Surface 能力。

### 2. 定义原生能力

- 在 `src/core/assistant/` 的领域能力模块中声明 `ApplicationCapabilityDefinition`，并注册到统一目录。
- 使用稳定、小写的能力 ID；版本从 1 开始，破坏性契约变化才升级版本。
- 完整声明输入/输出 schema、AI 输入 schema、领域、别名、读写属性、风险、数据等级、权限、超时、幂等、撤销、预览、作用域、可用条件、前置能力、并发键、引用类型、成功证据和失败恢复。
- AI 输入 schema 顶层必须 `additionalProperties: false`，禁止开放 `patch`、`storePatch`、`executeScript`、`script`、`code` 等任意 Store Patch 或脚本入口。
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

- 为能力提供用户可能使用的中文、英文和领域别名。
- 声明 `acceptsRefs`、`producesRefs` 和前置依赖，让跨模块任务通过稳定引用衔接。
- 不把全部能力注入模型；保持每轮最多 32 个、合计不超过 96KB 的活动 schema。发现只覆盖最多 3 个依赖前沿 Facet，每个 Facet 最多租约 5 个工具；这些数值只引用 `toolBudget.ts`，不得在契约或运行时另写一份。
- 发现能力返回 `leasedToolNames` 与 `deferredToolNames/deferredCount`。租约工具必须在下一模型步骤真实可用并持续到对应 Facet 终态；活动工具已带完整输入 schema，不得在发现后自动调用 `read_application_schemas`。
- Router 只提供页面锚点和搜索建议，不得以分类结果限制能力可用性或授权。
- 写能力必须通过 `control.impacts` 声明 Effect、实体和属性；一次输出可能影响多个目标时实现 `resolveObservedEffects(input, output)`，从真实结果解析数量、稳定引用和验证证据。没有解析器的能力一次最多贡献一个 Effect。
- 多项常规实体改动优先合并到 `change_application_entities`，画布多操作优先走 `plan_canvas_batch → commit_canvas_batch`；后一步依赖前一步新引用时才保留分轮执行。
- AI 可见输入 schema 不暴露 `baseRevision` / `expectedRevisions`。并发基线只由 Gateway expected-revision 信封传入，兼容字段只能校验一致性，不能形成第二条 revision 路径。

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
- 全部迁移后删除兼容描述生成器、旧 operation 分支以及 v2 快照中的 `availableCommands`/`availableQueries`；旧 v1 保存点只允许由集中、只读适配器映射为 `availableCapabilities`。

### 7. 验证

- 运行能力覆盖检查，确认定义、处理器、Surface、设置和工具覆盖一致。
- 新增或改造 Surface 时必须在统一目录声明观察提供者、捕获策略、数据等级、遮罩策略、支持模态、尺寸预算和失效条件；不允许留下无理由的观察空缺。
- 观察提供者、数据等级、遮罩策略和支持模态只在 `resolveSurfaceObservationProfile` 判断一次，目录和覆盖清单都从它派生；界面标注 Surface ID 时从目录反查，不在组件里复制映射表。
- 观察默认走 `target="window"` 整窗，任何时候都可用；只在需要聚焦时传具体 surfaceId。截图范围永远只有本应用窗口，禁止桌面和其他应用窗口。
- 遮罩只认显式的 `data-observation-sensitive`。新增界面时，凡是把**明文**本地路径、密钥或令牌渲染出来的节点都要自己标上；`type="password"` 的输入框自带圆点掩码，不需要标。
- `observe_application_surface` 是唯一把像素送进模型的观察入口。不要新增只返回媒体引用或“已截图”标记的观察能力——模型看不到画面却会以为看过了；要产生视觉证据就返回 `verificationKind: 'visual_pending_model'` 加合法附件。
- 空间类写入（三维、画布布局）必须配一个结构化验证能力，并在任务图里独立成一个验证 Facet；视觉证据是加成，不能替代结构化验证。
- 视觉观察优先使用领域结构化状态或稳定原生媒体，其次使用专用视口，最后才允许捕获已注册的应用内区域；禁止回退为系统桌面、其他窗口或整屏截图。
- 观察结果只有被主模型或观察模型实际读取后才能标记为视觉验证；只有结构化证据或模态不可用时必须分别标记，不能把媒体引用文本当作已读取内容。
- 为每项能力验证合法输入、非法输入、权限、revision 冲突、成功证据和失败恢复。
- 验证注册 100 项能力时初始上下文仍精简，活动工具不超过 `toolBudget.ts` 声明的上限。
- 涉及跨模块任务时验证稳定引用传递，不得通过名称猜测或原始路径衔接。
- 运行相关 Agent 测试、TypeScript、Lint 和 Electron 构建检查。
- 涉及鼠标交互时只写清用户手动验证步骤，不代替用户操作界面。

## 完成标准

- 能做的事优先通过通用动词暴露；专用能力只用于无法用属性写入表达的算法型操作。
- 声明 `collectionWrite` 的实体类型都注册了 `ApplicationCollectionExecutor`，由覆盖测试拦截。
- 每个实体都有 mutation/collection 执行器或非敷衍的 `writeExclusion.reason`；新增实体后运行 `npm run check:assistant-capabilities`。
- 能力定义是唯一元数据源。
- 正式业务服务是唯一业务执行源。
- 普通界面不显示开发性解释。
- 新代码没有旧 command/query 兼容路径。
- 新代码没有任意 Store Patch、任意脚本执行或 Application API 核心跨层导入。
- 权限、revision、日志、引用和成功证据均有自动化验证。
