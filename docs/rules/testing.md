# 验证与任务完成标准

> 读取时机：准备收尾任何代码改动前。
>
> 核心原则：**用能证明本次改动正确的最小验证集，不按测试文件数量、目录大小或“保险起见”扩大范围。** 本地验证负责快速反馈，CI 负责全量兜底。

## 一、先定验证级别

### L0：不改变运行行为

适用：规则/文档、注释、纯文案、README、未被运行时读取的示例。

- 默认不跑 ESLint、TypeScript、Vitest、Electron 构建
- 只做与改动直接相关的格式、链接、引用或生成结果核查
- 文档里出现命令、路径或脚本名时，用搜索确认它们真实存在

### L1：局部、低风险改动

适用：单个纯函数、局部组件实现、局部样式、已有测试覆盖的叶子模块。

按需选择，不要求全部执行：

```bash
# 有明确对应测试时，只跑测试文件
npx vitest run path/to/module.test.ts

# 依赖关系不完全明确时，只跑受改动源文件影响的测试
npx vitest related --run path/to/changed-source.ts --passWithNoTests

# 只检查本次改动的 TS/TSX 文件
npx eslint path/to/changed.ts path/to/changed.tsx --report-unused-disable-directives --max-warnings 0
```

- 纯样式、文案、静态资源替换不因“文件是 `.tsx`”就自动跑全量单测或全量类型检查
- 只改测试文件时，只运行该测试文件；除非同时改了共享测试设施，不跑全量套件
- `vitest related` 只接收**源文件**；已知测试路径时优先直接运行测试文件

### L2：共享或高风险模块改动

适用：导出类型/公共契约、共享 store、持久化/迁移、权限、网络与文件 I/O、重试/取消、异步状态流、跨多个直接消费者的模块。

执行：

1. 受影响模块的精确测试；边界不清时使用 `vitest related`
2. 所属 TypeScript 工程的类型检查
3. 与风险对应的专项检查

```bash
# 渲染层
npx tsc -p tsconfig.json --noEmit

# Electron 主进程 / preload
npx tsc -p tsconfig.electron.json --noEmit
npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0
```

只有确实跨越渲染层与 Electron 边界时，才同时跑两个 TypeScript 工程。

### L3：全量验证

仅适用于以下情况：

- 无法可靠界定影响范围的跨目录/跨层重构
- 修改构建配置、测试基础设施、核心公共契约或关键依赖
- 合并前的高风险检查、发布、复现 CI 全量失败
- 用户明确要求全量验证

```bash
npm run lint
npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.electron.json --noEmit
npx vitest run
```

`npm test` / `npx vitest run` 是全量单测，**不是每次代码改动的默认收尾命令**。`electron:build` 也不是全量单测的替代品。

## 二、验证范围只能因风险升级

按以下顺序选择验证，不得倒序从全量开始：

1. 明确本次改动改变了什么行为、有哪些直接消费者
2. 先跑精确测试或单个专项检查
3. 影响边界不清时扩大到 `vitest related`
4. 只有发现共享契约影响、相关测试失败指向更广范围，或符合 L3 条件时才跑全量

禁止做法：

- 因“测试很多”“这个目录重要”或“保险起见”直接跑全量
- 同时串行运行已互相包含的测试脚本，重复执行同一测试文件
- 为了显得验证充分，把 lint、两个 tsc、全量 Vitest、build、smoke 无差别全部叠加
- 在精确测试已经失败时继续盲目跑更大的套件；应先定位并修复当前失败
- 把 CI 会执行全量检查理解成本地也必须重复执行全量检查

## 三、哪些测试值得保留

优先保留或补充：

- 修复过的真实缺陷，且测试能阻止同类回归
- 状态机、调度、并发、取消、恢复、重试和错误收口
- 持久化、迁移、权限、安全、金额/配额、数据完整性
- provider 适配、IPC/跨层契约、导入导出格式等稳定边界
- 分支较多但输入输出确定的领域逻辑
- 用户关键路径中可自动、稳定、低成本验证的行为

测试不是越多越好。满足以下任一情况时应合并、降级为专项检查或删除：

- 同一行为在同一抽象层被重复断言，没有新增风险覆盖
- 只验证 TypeScript 编译器已经保证的类型事实
- 紧耦合私有实现、重构即碎，但不保护用户可见行为或稳定契约
- 只断言文案、类名、DOM 层级或大快照，且变化本身通常是合法的
- 没有有效断言，或测试永远 skip、长期无法在任何明确命令中运行
- 依赖真实外网、随机时序或机器性能，导致不稳定，却被放进日常单测

基准、视觉、真实服务、长耗时和人工探针测试可以有价值，但必须是**显式专项命令或环境变量启用**，不得混成日常必跑项。不要仅因文件名含 `benchmark`、`probe`、`baseline` 就删除；先判断它实际是否快速、确定、保护稳定约束。

助手剧本的正路优先**录制**而不是手写（`npm run assistant:record -- --list`）：手写正路等于替模型想它会怎么做，必然漂移到不现实；真模型写出来的脚本才代表它实际会写什么，契约变更时也只需重录一次。手写留给故意的坏输入——撞墙、拒绝、歧义、冲突，这些真模型很难稳定复现。录制源是 `agent_model_traces`（需 `--trace detailed`），不是 `agent_events`：后者的 `ToolRequested` 只存 `inputDigest`，没有入参。

### 真实性测试统一入口

当问题必须回答“在真实应用里到底通不通”，统一走 `npm run test:reality`，按证据成本选层，禁止另写一条临时 Electron/Playwright 启动链：

| 层 | `--suite` | 使用的真实性 |
|---|---|---|
| 精确逻辑 | `unit --test <文件>` | 正式代码与精确输入，不启动应用 |
| 运行时集成 | `integration` | 真注册表、真 Gateway、真解释器、真执行器；只替换进程边界 |
| 界面操作 | `ui` / `ui-audit` | 真实 Electron、真实 DOM/WebGL、Playwright 操作、截图/规则与运行时证据 |
| 外部真机 | `live` | 真实模型、网络、API 密钥、付费请求与业务数据 |

数据模式与副作用必须彼此独立：

- 默认 `--profile temporary`，使用隔离临时 userData，退出后回收；适合创建、删除和任意 fixture。
- `--profile real` / `--real-data` 才复用用户正在使用的工程、设置与系统密钥链。它不是把密钥复制到临时目录，而是让测试进程使用正式 Electron 资料目录，避免 safeStorage 与配置漂移。
- real 模式默认跳过声明了 `writesUserData` 的 UI 场景；只有用户明确授权后才传 `--allow-writes`。
- `live` 同时要求 `--profile real --allow-paid --allow-writes`，三项缺一即在启动外部请求前拒绝。用户只要求“支持真实环境”不等于授权本次产生费用或写入。
- 同一入口可以重复传 `--suite`，但任一层失败立即停止；不得用后续更多通过项稀释前面的失败。

```bash
npm run test:reality -- --suite unit --test src/features/example.test.ts
npm run test:reality -- --suite integration
npm run test:reality -- --suite ui --only 3D --size 1440x900
npm run test:reality -- --suite ui --profile real --only 设置
npm run test:reality -- --suite live --profile real --allow-paid --allow-writes --only camera
```

UI 真实性测试不能只证明“脚本点完了”或“截图生成了”。每个场景同时订阅浏览器 `console error` / `pageerror`，并通过应用正式 logging 查询接口用 `afterTimestamp + level + limit` 截取该场景之后的结构化错误与警告。错误进入失败判据，警告进入 `evidence.json` 供诊断。**不要让测试脚本直接读取整份日志文件**：日志文件仍是唯一持久化来源，主进程接口负责流式过滤、限量和脱敏，脚本只消费窄结果；只有日志 IPC/查询服务本身坏掉时，才把直接读文件作为救援路径。

真实应用视觉审查按固定顺序执行：需要时先 `electron:build` → 确认并暂停占用同一真实资料目录的当前仓库开发实例 → 用 `test:reality --suite ui|ui-audit --profile real` 运行只读场景 → Agent 逐张打开实际截图检查对齐、裁切、层级、颜色与文案 → 核对 `evidence.json` 和结构化日志 → 退出巡检实例 → 按任务完成标准恢复或重启开发环境。禁止用浏览器、ego-browser、Chrome、裸 Vite 或临时 profile 的截图冒充真实用户环境；DOM 断言通过也不能替代目视截图。项目正式 Electron 自动化可以执行点击、悬浮和画布交互，不受下文“不要人工上手”的限制。

## 四、按改动类型追加专项检查

以下命令也遵循“只在直接相关时运行”，不是累加清单。

### 界面改动

按改动内容选择：

```bash
npm run check:colors
npm run check:surface
npm run check:icons
```

`check:surface:strict` 与 `check:icons:strict` 已接入 `build` / `electron:build`。确需例外时加**行级** `ui-surface-allow` 注释并写明理由，禁止文件级豁免。

- 局部样式/文案：专项静态检查 + 用户人工验证即可，不要求 `electron:build`、`ui:tour` 或全量 Vitest
- 共享页面骨架、设计令牌、弹窗/滚动/溢出机制：再考虑构建后运行相关视觉检查
- `ui:tour` 必须用 `--only` 和必要的 `--size` 缩小场景；只有全局 UI 改造才跑全部场景

```bash
npm run ui:tour -- --only 设置 --size 960x640
npm run check:ui-visual
```

### 画布

- 节点业务逻辑：运行对应节点/画布模块测试
- 节点盒、minimap、连线、溢出几何：构建后运行 `npm run check:canvas-visual`
- 只有改动渲染热路径、LOD、视口裁剪或性能机制时，才运行性能基准：

```bash
BENCH_MULT=4 npm run electron:pan-bench
```

样式、文案或普通节点功能改动不得触发性能基准。

### 模型 / 参数 schema

```bash
npm run gen:model-manifest
npm run check:model-i18n
```

再运行改动模型、参数转换或请求构建的精确/相关测试；默认不跑全量 Vitest。

### 智能助手能力

下面的"必须"**按改动类型触发，不是每次助手改动的清单**。先对号入座，只读命中的行：

| 本次改了什么 | 适用条款 |
|---|---|
| 能力登记、surface、schema | 第 1–2 条 |
| runner、状态机、调度、审批、模型适配 | 第 3–5 条 |
| 新增写域、动态 availability | 第 6 条 |
| 持久化 / 派生编译结果 | 第 7 条 |
| 通用写入执行器、Effect Receipt | 第 8–9 条 |
| Henji Script 编译器、预检、脚本 API 投影 | 第 10–11 条 |
| 跨领域结果传递、桥梁能力 | 第 12 条 |
| 助手终态、封存、外部等待续跑 | 第 13–14 条 |
| 拒绝信息（能否被自我修正） | 第 15 条 + 断牙验证 |
| 域清单、能力目录、发现投影体积或深度 | 第 16 条（L-A 静态不变量） |
| 拒绝路径、实体读写回环、脚本执行链路 | 第 17 条（L-B 剧本 harness） |

一条都没命中就不适用，按前面 L0–L3 选最小验证集即可。

#### 助手验证的三层分工

**别用最贵的工具做本该便宜做的事。** 助手行为的验证分三层，成本差两个数量级：

| 层 | 手段 | 成本 | 只能回答 |
|---|---|---|---|
| **L-A 静态不变量** | 普通 vitest，对注册表做穷举，不驱动运行 | 秒级、零成本 | 注册数据自身是否自洽 |
| **L-B 剧本 harness** | `createScriptedModelStepExecutor` 驱动真运行时，替身只在进程边界上 | 十几秒、零成本 | 如果模型这么做，运行时对不对 |
| **L-C 真机** | `assistant:live:suite` | 分钟级、真实付费 | 模型看不看得懂 |

判断某个助手缺陷该由哪一层守，问一句：**它与"模型怎么想"有关吗？**

- 与注册数据有关（域没登记、能力找不到、投影超限）→ L-A
- 与执行链路有关（拒绝消息、revision、读写落地、Effect 记账）→ L-B
- 只与模型理解有关（领域词汇、会不会绕路、提示词改动后的语义质量）→ L-C

L-B **不证明**"模型会这么做"，只证明"这么做的话运行时是对的"。拿 L-B 通过去论证模型行为是越界。

真机层因此收缩到四种触发条件：提示词层改动、模型或参数变更、发布前、L-B 已绿但仍怀疑语义。
**不再**用于"这个域没验证过所以跑一遍"——那是 L-A/L-B 的活。想覆盖新领域优先用
`--probe` 词汇探针，它只跑到模型第一次表态为止；但探针**不必然便宜**，实测 image_edit 30 秒
1.4 万 token，toolbox 却跑到 203 秒 11.7 万 token，收敛差的域探针也会拖长。

- 只改能力登记、surface/schema：`npm run check:assistant-capabilities` + 对应精确/相关测试
- `check:assistant-capabilities` 同时执行全域写入覆盖与双路径一致性门禁；失败时按输出补齐 mutation/collection 执行器、`writeExclusion.reason`，或恢复清单指定的共享入口
- 改 runner、状态机、调度、审批、持久化、模型适配：运行对应测试文件或最小专项脚本
- `npm run test:assistant-production` 仅用于助手运行时的跨模块重构、生产验收或发布前检查，不是任意助手改动的默认命令
- 多个助手专项脚本可能包含相同测试文件；一次任务中避免无理由串行叠加
- 新增写域或动态 availability 时，必须补正式反射结果测试：走 Registry、通用适配器、事务引擎和正式执行器，最后读取领域真相源；不能用 completed/evidence 代替世界状态断言。任何写入 recovery 的操作步骤也必须由这类测试先证明。
- 持久化状态存在派生编译结果时，schema 测试必须证明序列化只保存唯一真相源，保存后重载并重新编译的结果与保存前一致；不得让派生轨道重新成为第二份真相。
- 多步通用写入的结果测试必须覆盖生产调用形状：至少一条在同一次 `change_application_entities` 中重复写同一属性，并在末尾执行依赖前序状态的控制写入；只按时间点拆成多次调用不能替代该场景。
- 每条写结果场景还必须对账 Effect Receipt：正式状态源中的每项持久差异都有 receipt，每项 receipt 都能在最终状态中找到对应变化；`evidence.data.applicationEffect` 等文本标记不得当成写入证据。
- Henji Script 必须成对验证编译安全与真实结果：禁止语法、动态属性、未发现 API、截断引用都必须在 Gateway 调用数为 0 时拒绝；通过脚本则必须走真实 Registry、Gateway、领域执行器与正式状态源。Recipe 要验证展开后仍是同一 IR/解释器，禁止出现第二套 workflow/program 内核。
- 脚本发现测试必须证明真实反射属性约束在首次 `scriptApi` 结果可见；至少覆盖一个 enum 和一个范围/引用形状。预检测试必须故意放入非法字面量或三元分支，断言 Gateway 调用数为 0；只测试领域执行器最终拒绝不算通过。
- 跨领域结果传递必须同时覆盖：稳定结果引用的桥梁能力进入租约、桥梁调用正式领域写入并从真相源读回。领域名词的同义表达（如“海报”未附带“图片”）至少保留一条原话回归。
- 改助手终态时必须成对测试：成功封存后的最终模型失败为 `completed_with_warning` 且没有 `RunFailed`；封存前同类失败仍为 `failed`。持久化 migration 需用业务工程哨兵证明只清运行态、不误删业务数据。
- 改外部任务等待或自动续接时，必须用同一结果测试覆盖“受控 IR 断点与源写入回执持久化 → 子运行先做一次权威读取 → 同一解释器只执行剩余指令 → sealed_success”；同时断言原提交步骤没有重放、断点丢失时禁止进入等待态，且权威读取不因旧 revision 产生一次可避免的 `STALE_CONTEXT`。
- **任何新增或修改的拒绝路径，都要有一条断言「拒绝信息能被自我修正」的测试**：错误里必须带上运行时**已经知道**的事实——实体类型写错就列出该域注册了哪些、属性写错就列出这个实体有哪些、参数被静默丢弃就说清丢了哪些键、容量不够就给出上限。只给一个错误码等于让模型继续猜，而它猜不中就是死循环。实测同一形状的缺陷在一个会话里出现了八次，代价从多烧一轮到整次运行报废不等（一次改设置：5 回合 3.8 万 token → 18 回合 25 万 token）。
- 同样禁止**把模型的提问当事实回答**：`scriptApi` 的实体/属性清单只能来自注册表，不得回声请求里的 `entityTypes` 或从 `queries` 正则抠出的标识符。宁可少说，不能乱说——模型看不到某个实体会去发现，看到一个不存在的实体只会一直撞墙。
- 真实助手矩阵统一走 `npm run assistant:live:suite`；每个场景检查强类型 Effect、正式验证和成功封存。判据是「有没有做完 + 有没有白干」，不是「用了几步」：只设跑飞天花板（脚本 8 次 / 回合 16 / 工具失败 6 次）抓真回归，效率靠 tokens/turns 数字自己说话。生成场景必须带 `--await-generation` 并验证断点续跑后的正式画布状态。词汇探针（`--probe`）是只读的，不传 `--require-verified-write`，判据只有「有没有发起发现」与「有没有当场宣称应用没有这个能力」——拿写入判据判只读场景只会得到一句必然的失败。
- **（第 16 条）改域清单、能力目录或发现投影时，静态不变量必须全域穷举，不许手挑场景。** 手挑守的是「我想到的那几个域没问题」，而问题是注册数据的函数：某个域多注册两条能力、某条 schema 深一层就可能越线，没被挑中的域没有任何东西盯着它。四条现成的：域非空与可路由（`capability-domain-coverage.test.ts`）、投影体积与深度（`capability-discovery-size.test.ts`）、评测用例点名的工具真实存在（`regression-cases.test.ts`）、并发基线发布得出来且认得出来（`hostScopeCoverage.test.ts`）。**门禁必须与生产用同一把尺子**——阈值、档位、作用域解析一律从生产函数取，写死常量或另写一份平行判断会造出假红假绿，实测三处都发生过。

  **「注册了但用不上」是一整类事故，不是几个孤立 bug。** 已经出现四种形状：域名没进工具契约（模型说不出）、域没有任何能力（说得出但目录是空的）、发现结果撞输出深度上限（连目录都拿不到）、并发基线发布不出来（拿得到目录但写不进去）。每一种都是"声明齐全、实际走不通"，而覆盖门禁（`propertyCoverage` / `storeActionCoverage`）看不见它们——那些守的是"声明与执行器一致"，不是"这条路经 Gateway 走得通"。新增这类门禁时按同一形状写：遍历注册表、走生产同一条路、把欠账登记成**会缩短的清单**而不是豁免表。
- **（第 17 条）改拒绝路径、实体读写落地或脚本执行链路时，跑 `npm run test:assistant-harness`。** 这层用剧本驱动真运行时（真注册表、真 Gateway、真解释器、真领域执行器、真 zustand）。替身只允许出现在进程边界和外部付费/像素边界上——目前只有两个：LLM（剧本），以及需要创建实例的用例装的内存 `window.henjiNative`（`src/tests/harnessNativeStorage.ts`）。schema、权限、revision、动态 availability、执行器、真相源一旦出现替身，这层立刻变成漂亮的假绿。判断方法：把替身撤掉后，被测行为的**判断逻辑**有没有任何一条搬进了替身里。

  **存储替身只能存，不能判。** 它复刻的只有存储语义（主键/唯一冲突、行不存在、排序、upsert 保留 createdAt、边界上的结构化克隆），不复刻边界之后主进程在存储之上的加工，因此这一层不能用来断言那些加工。**没实现的方法必须抛错，不许返回空值或假成功**——返回空值等于悄悄伪造业务结果，调用方会把"没这个能力"当成"查到了但是空的"继续走，最后在离现场很远的地方失败。这条本身要有测试钉住（`harnessNativeStorage.test.ts`）。

  harness 自身必须有防空转自检（注册工具数、前端能力数下限）与保真锚点（写域用例断言**该实体自己声明的** scope 的 revision 真的推进了）——实测最初版本忘了 `retainHostContextTracking()`，所有 revision 停在 0，整层对乐观并发失明还一路绿灯；后来那句"任意 scope 大于 0"同样是假绿，revision 是进程内累计计数器，第一个域写完之后它就恒真了。
- 真机场景按**交互模式**组织，不按领域。运行时与领域无关（所有前端能力走同一条适配路径，Gateway、租约、revision 都不看域），所以「A 域通 B 域不通」只可能来自注册数据（L-A）、领域执行器（L-B）或模型对该域词汇的理解（只有 L-C）。前两类不该占用真机预算。
- 真机场景里**不得嵌入每次运行都变的值**。目标文本用 `nonce`（`n` + 6 位 36 进制随机串）而不是时间戳：纯数字反替换时会误伤坐标、时长这类正常数值，而录制器要把它整份换成 `{{nonce}}` 才能回放。运行时产物 id（taskId、projectId 等）不能替换成常量——它们是真实产物，只能参数化成对前序步骤结果的引用，或把该剧本降级为手写；`npm run assistant:record` 检测到未参数化的产物 id 会告警，加载器拒绝回放。

新增或扩展门禁时必须做一次断牙验证：临时撤掉它要保护的修复，确认目标命令稳定变红且错误能定位，再恢复代码并确认转绿。把失败断言摘要记入对应任务执行记录；未证明能变红的门禁不算完成。

### Electron 主进程能力

按风险一一对应，不得全部追加：

- **只要往 `electron/main/**` 或 `electron/preload/**` 新增了跨 `src/` 的 import**：必跑

  ```bash
  npm run check:main-imports
  ```

  `@/` 别名只配在 `electron.vite.config.ts` 的 `renderer` 块，main/preload 解析不了。引到依赖链上带 `@/` 的 `src` 模块时，`tsc`（两个工程都配了 paths）和 `npm test`（走 vite alias）**都会通过**，只有实际构建才报 `Failed to resolve import`。这条检查是同一判断的静态版本，一秒出结果，已接入 `electron:build`。
- IPC / preload / 启动 / 数据库 / 打包链路：构建后考虑 `npm run electron:smoke`
- 窗口尺寸、缩放、DPI：`npm run electron:dpi-check`
- 自动更新：`npm run electron:updater-e2e`
- 普通主进程纯逻辑：优先精确测试 + 主进程类型检查，不要求 smoke、DPI、updater 全跑

`electron:dist` 只用于确实需要安装包的发布/分发验证，不用于日常开发收尾。

## 五、人工核查

以下检查仅在改动可能引入对应问题时执行：

```bash
# 原生控件检查（业务代码里的命中都要处理；测试替身与 ui 基元层除外）
grep -rn --include='*.tsx' -E '<(button|input|select|textarea)\b' src \
  | grep -vE '\.test\.tsx:|src/components/ui/' \
  | grep -vE ':[[:space:]]*(\*|//)'

# 文件行数治理（重点关注本次新增/修改后超过 500 行的文件）
find src electron \( -name '*.ts' -o -name '*.tsx' \) \
  | xargs wc -l | awk '$1 > 500 && $2 != "total"' | sort -rn
```

第一条排除了测试替身、`src/components/ui/` 基元层和注释行。**任何剩余命中都是需要处理的违规**——存量已于 2026-08-26 清零（最后一处是 `ModelSyncDialog` 的分组折叠按钮，已改用 `UiOptionButton variant="menu"`），现在这条命令应当无输出。

不要人工接管用户鼠标做验收。拖拽、点击、悬浮、画布交互优先补入并运行正式 Electron UI 场景；尚未覆盖或必须由用户主观判断的交互，再把具体操作步骤和验证点交给用户。真实 API key 下的生成链路、真实项目包导入导出、macOS 真机行为仍交给用户，除非用户已明确授权对应真实副作用。

## 六、任务完成标准

一次改动可以视为完成，当且仅当：

1. 已说明本次选择了 L0/L1/L2/L3 中哪一级，以及选择依据
2. 该级别中与改动**直接相关**的最小检查已实际执行并通过；不相关命令不需要跑
3. 有失败的，如实报告失败输出，不隐瞒、不用无关测试数量淡化
4. 需要用户手动验证的部分，已写出可照做的步骤和验证点
5. 最终回复前已检查当前仓库的 `npm run electron:dev`：未运行则启动；已运行且本次需要重启则仅重启当前仓库的开发进程树；已运行且无需重启则保持单实例。进程归属必须通过当前仓库工作目录或明确的命令链确认，禁止宽泛结束其他 `node` / `Electron` 进程。启动后要看到开发服务就绪或 Electron 窗口启动证据，失败必须保留输出并如实报告
6. 新增/改造的关键业务链路已按 [logging.md](logging.md) 补齐结构化日志

完成报告只列实际执行的检查及结果，不需要为未运行且不相关的全量命令道歉。

开发环境状态统一写成以下四种之一：`🟢 开发环境已启动` / `🔄 开发环境已重启` / `✔️无需重启（开发环境保持运行）` / `🔴 开发环境启动失败`。

## 七、CI 全量兜底

`.github/workflows/build.yml` 的代码检查 job 仍执行生成器、静态规则、渲染层/主进程 lint 与类型检查、全量 Vitest。CI 全量覆盖与本地最小验证分工不同，不应互相替代。

构建 job 只在标签或手动触发时运行 `npm run electron:build` 并打包发布。
