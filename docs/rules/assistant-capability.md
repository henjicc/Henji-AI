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
- **声明可写的每一条属性，都必须出现在执行器的 `writableProperties` 里**，且该集合必须由 `ApplicationPropertyWriterTable` 派生（`writableProperties(TABLE)`），不许手写字面量。属性写入执行器**禁止**用手写 if-else 属性链——链条无法被枚举，覆盖门禁就看不见"声明可写但执行器没有对应分支"这类缺口（`camera_stage.shot.time` 就是这么漏掉的，实体级门禁一直全绿）。
- 属性接受的 operation 由写入表的 `operations` 声明，不写默认只接受 `set`。集合类属性（如 `asset.library_refs` 只吃 `append`/`remove`）必须显式声明，否则模型只能靠试错。

### 界面动作覆盖

- **每个带 store 的 feature 必须有 `<feature>StoreLedger.ts`**，store 的每一个函数键都要归类：绑定到属性 / 集合 / 能力，或标为 `excluded`（有意不开放，写明由谁维护），或标为 `gap`（人能做、助手还不能做，写明缺什么与归到哪一期）。
- 账本用 `Record<ActionName, …>` 而不是 `Partial`：界面新增动作却没建账，`tsc` 阶段就会点名缺哪个 key。
- `excluded` 表达的是**不可写**，不是**不可见**。视图态助手仍然要读得到——它得知道用户现在在看什么。
- `gap` 总数是人机差集的燃尽基线，在 `storeActionCoverage.test.ts` 里钉住，只许降不许升。
- feature 整体没接助手（既无 Reflection 也无账本）必须登记进 `check-assistant-capabilities.cjs` 的 `ASSISTANT_BLIND_FEATURES` 并写明原因——那是一张**会缩短的清单**，不是豁免表。

## 禁止事项

- **禁止**新增旧式 `HostCommand`、`HostQuery`、`kind: 'command'`、`kind: 'query'`、固定前端命令/查询执行表，或依赖兼容描述生成器的 Agent 工具
- 能力处理器**必须调用正式业务服务**，不得复制业务逻辑
- 后台可完成的操作，不得为了复用页面组件而强制切换页面
- 跨模块传递实体必须用 `ApplicationRef` 或 artifact 引用，**不得**向模型暴露原始密钥、本地路径或不受控的大对象
- **不得**以"助手已判断"为理由绕过安全边界
- **禁止**从能力处理器直接调用 Store `setState` 做任意 Patch；仅允许正式领域服务内部对已声明字段执行确定性状态提交
- **禁止**在 Application API、能力定义或 Agent Runtime 增加 `eval`、`new Function` 或任意脚本执行入口

## 必须接入的现有机制

新能力必须接入：权限审批、revision、幂等、撤销、并发、脱敏、结构化日志、成功证据验证。

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
