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
npx vitest related --run path/to/changed-source.ts

# 只检查本次改动的 TS/TSX 文件
npx eslint path/to/changed.ts path/to/changed.tsx --report-unused-disable-directives --max-warnings 0
```

- 纯样式、文案、静态资源替换不因“文件是 `.tsx`”就自动跑全量单测或全量类型检查
- 只改测试文件时，只运行该测试文件；除非同时改了共享测试设施，不跑全量套件
- `vitest related` 只接收**源文件**；已知测试路径时优先直接运行测试文件
- `related` 找不到测试不等于已有覆盖；必须补充或指出真正覆盖该行为的测试，不能凭 `--passWithNoTests` 的退出码报通过

Agent 日常优先使用统一入口，并显式列出**本次任务自己的文件**：

```bash
npm run verify:changed -- --level L1 src/path/source.ts src/path/source.test.ts
```

该命令只支持 L0–L2，不读取整个 `git diff`。先加 `--dry-run` 核对范围与去重：现实现可能同时安排精确测试和 `related --passWithNoTests`，必要时手动执行去重后的明确命令。它对 package/锁文件、workflow、tsconfig、Vite/Vitest 配置固定拒绝局部验证；有界改动可按本规则说明风险依据、手选检查，但不能声称自动入口已经支持，也不能绕过必需 CI 门禁。

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
npx eslint electron/main/path/to/changed.ts --cache --cache-location node_modules/.eslintcache-electron --report-unused-disable-directives --max-warnings 0
```

文件级 ESLint 使用仓库现有 `.eslintrc.json`，不必为主进程叶子改动全扫 `lint:electron`。两套 TypeScript 工程有增量缓存，仍只检查改动所属工程；也可用显式文件入口：

```bash
npm run verify:changed -- --level L2 electron/main/path/to/changed.ts
```

只有确实跨越渲染层与 Electron 边界时，才同时跑两个 TypeScript 工程。

SDK 的请求/响应、轮询、SSE、WebSocket 或流式 parser 属于 L2 起步；除精确测试与类型/可移植性检查外，必须按 [SDK 文档采集手册](../../packages/ai-sdk/docs/model-adaptation/文档采集手册.md) 的事件矩阵从官方 fixture 推导正反场景，并实际执行断牙验证。SDK 发布再按该手册的首发顺序升级到全量、打包与回装验证。

### L3：全量验证

仅适用于以下情况：

- 无法可靠界定影响范围的跨目录/跨层重构
- 改变全局构建/测试执行或覆盖语义且无法局部证明影响范围，或修改核心公共契约、关键依赖
- 合并前的高风险检查、发布、复现 CI 全量失败
- 用户明确要求全量验证

```bash
npm run lint
npm run lint:electron
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.electron.json --noEmit
npx vitest run
```

`npm test` / `npx vitest run` 是全量单测，**不是每次代码改动的默认收尾命令**。`electron:build` 也不是全量单测的替代品。

配置、测试工具的有界局部修复按实际风险选 L0–L2；只改测试文件不自动成为“测试基础设施 L3”。不得借此省略真正的全局覆盖、构建或核心公共风险检查。

历史任务文件中的验证清单不具有持续升级权：`docs/task/**` 只记录当时范围和证据。恢复旧任务时仍按本文件重新判级；只有用户明确要求复现原验收、发布或当前改动本身满足 L3，才照搬其中的全量命令。

## 二、验证范围只能因风险升级

先用一句话确定：**改变了什么行为 → 哪个风险会出错 → 最低哪层证据能证明它。**

- 普通叶子优先一份定向测试，覆盖正常路径、实际缺陷及相关失败边界；状态机按受影响的转移选例，不硬凑测试数量。
- 跨边界时选择覆盖相关风险的最短集成链路，不设“一条”的硬上限；已由精确测试证明的细节不在每层重复。影响范围不清再用 `related` 或按 L3 升级。
- GUI 默认只跑一个故障尺寸；响应式、DPI、尺寸相关问题或用户明确矩阵才跑双尺寸。重规模优先一个临界规模，保留真实处理路径；互不影响的风险不做无意义的场景×尺寸×设备笛卡尔积。
- 修复测试失败后先重跑失败精确项；修改稳定后把仍需验证的受影响文件去重合并一次，不在每次小编辑后重跑全套。
- 同代码、同依赖、同环境、同范围的通过证据可复用。主代理审查子代理的命令和结果，不默认重复全跑；相关代码、依赖或环境变化后只重验失效范围，整体验收另按真实集成风险选择。

禁止做法：

- 因“测试很多”“这个目录重要”或“保险起见”直接跑全量
- 同时串行运行已互相包含的测试脚本，重复执行同一测试文件
- 为了显得验证充分，把 lint、两个 tsc、全量 Vitest、build、smoke 无差别全部叠加
- 在精确测试已经失败时继续盲目跑更大的套件；应先定位并修复当前失败
- 把 CI 会执行全量检查理解成本地也必须重复执行全量检查
- 为省时间放松像素/性能/数据阈值，或删除、跳过尚未解决的失败测试

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


### 真实性测试统一入口

当问题必须回答“在真实应用里到底通不通”，统一走 `npm run test:reality`，按证据成本选层，禁止另写一条临时 Electron/Playwright 启动链。需要新产物时显式传 `--build`，它只运行轻量 `electron:bundle`，不会附带完整质量门禁：

> 默认读取 `out/`，`scripts/lib/electronLaunch.cjs` 的 `assertBuildFreshness` 会拒绝缺失或旧于 `src/`、`electron/` 的产物。改过运行时代码应加 `--build` 或先 `npm run electron:bundle`，不因此升级到完整 `electron:build`。仅为明确的旧产物诊断才可使用 `HENJI_SKIP_BUILD_FRESHNESS=1`，结果不得冒充新代码验证。
>
> 构建前暂停当前仓库中读取同一 `out/` 产物的开发实例，避免在其运行时替换文件；完成后按 [AGENTS.md 完成标准](../../AGENTS.md#完成标准) 恢复开发环境。

| 层 | `--suite` | 使用的真实性 |
|---|---|---|
| 精确逻辑 | `unit --test <文件>` | 正式代码与精确输入，不启动应用 |
| 运行时集成 | `integration` | 正式公共入口、注册表、事务与领域执行器；只替换进程边界 |
| 界面操作 | `ui` / `ui-audit` | 真实 Electron、真实 DOM/WebGL、Playwright 操作、截图/规则与运行时证据 |
| 退出重启 | `restart` | 同一份隔离资料目录跑两次完整 Electron 启动，覆盖渲染层重载证明不了的主进程启动恢复 |
| 外部客户端 | `clients` | 真实外部 Agent 命令行接到真实应用；官方 SDK Client 与测试库只算协议证据，不算这一层 |

数据模式与副作用必须彼此独立：

- 默认 `--profile temporary`，使用隔离临时 userData，退出后回收；适合创建、删除和任意 fixture。
- `--profile real` / `--real-data` 才复用用户正在使用的工程、设置与系统密钥链。它不是把密钥复制到临时目录，而是让测试进程使用正式 Electron 资料目录，避免 safeStorage 与配置漂移。
- real 模式默认跳过声明了 `writesUserData` 的 UI 场景；只有用户明确授权后才传 `--allow-writes`。
- 同一入口可以重复传 `--suite`，但任一层失败立即停止；不得用后续更多通过项稀释前面的失败。

```bash
npm run test:reality -- --suite unit --test src/features/example.test.ts
npm run test:reality -- --suite integration
npm run test:reality -- --build --suite ui --only 3D --size 1440x900
npm run test:reality -- --build --suite ui --only 设置 --size 960x640
npm run test:reality -- --build --suite restart
npm run test:reality -- --suite clients --only claude
```

`restart` 与 `clients` 都不产生付费请求，也不碰真实资料目录。`clients` 在模型侧不可用（额度、登录、版本）时**不判失败**——那不是应用的问题——但必须显式打印任务级未取证；把那条绿线读成「真实 Agent 已验收」是错的。

UI 真实性测试不能只证明“脚本点完了”或“截图生成了”。每个场景同时订阅浏览器 `console error` / `pageerror`，并通过应用正式 logging 查询接口用 `afterTimestamp + level + limit` 截取该场景之后的结构化错误与警告。错误进入失败判据，警告进入 `evidence.json` 供诊断。**不要让测试脚本直接读取整份日志文件**：日志文件仍是唯一持久化来源，主进程接口负责流式过滤、限量和脱敏，脚本只消费窄结果；只有日志 IPC/查询服务本身坏掉时，才把直接读文件作为救援路径。

真实视觉审查运行正式 Electron 的最小场景后，Agent 打开实际截图并核对 `evidence.json`、日志。隔离临时 profile 是合法的真实容器证据；只有问题依赖用户真实工程、配置或密钥链时才需要 `--profile real`，副作用仍须授权。禁止用浏览器、裸 Vite 冒充 Electron，或把临时夹具说成用户真实数据；DOM 断言不能替代目视截图。正式 Electron 自动化可以执行点击、悬浮和画布交互。

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
npm run gen:catalog
npm run check:model-i18n
```

再运行改动模型、参数转换或请求构建的精确/相关测试；默认不跑全量 Vitest。

### 应用能力与智能助手

MCP 应用执行链用正式协议／直接调用入口、统一注册表、领域执行器及状态源验证，不要求经过旧助手模型、脚本或租约。`check:assistant-capabilities` 名称保留，其中结构、属性写入覆盖及业务不变量仍为共享门禁；助手运行、提示词与终态专项仅在实际改动这些行为时执行。不得为绕过 MCP 失败而关闭共享安全检查。

### 公共调用与内置 Pi

按改动类型选择最小匹配检查，不能因涉及助手就重复整套专项。

| 本次改动 | 验证范围 |
|---|---|
| 能力声明、注册、schema、调用面 | `check:assistant-capabilities` 与受影响注册、反射及输出契约测试 |
| 通用读写、事务、保存与恢复 | 对应 `applicationHarness.*.test.ts`，通过正式公共入口执行并读取领域状态 |
| 公共跨域执行链 | `test:application-harness`，不能只选一个页面 |
| 调用者权限、账本、幂等、预算或宿主连接 | 公共运行时精确测试；涉及 SQLite 时使用原生 Electron runner |
| MCP 协议 | 官方 v2 Client 固定现代协议，通过正式 HTTP handler 验证；原始报文证明无初始化握手 |
| Pi 会话、工具投影、等待、打断、消息队列 | 对应 Pi 精确测试；跨模块重构运行 `test:embedded-agent` |
| 工程／文档实例及任务归属 | 页面 A 与后台 B、同目标冲突、保存失败、打开／关闭目标时运行实例保持一致 |

公共调用测试使用正式注册表、权限、schema、事务引擎和领域执行器。替身只在模型、进程、付费供应商或像素边界；不能替代业务判断。`test:assistant-production` 仅用于跨模块集成或发布验收。

- 并发基线来自目标实体的权威读取结果，不能要求未打开工程或主进程领域先进入当前页面快照。测试必须证明真实版本推进、过期版本拒绝且没有额外写入。
- 一次声明自动进入调用面；注册与权限覆盖须遍历正式注册表，不能以手工业务名单自证完整。
- 写入结果以最终领域状态和结构化副作用对账。保存失败保留已发生的修改；恢复只重试保存，不重复生成和业务动作。
- 多步事务覆盖同一调用内重复写属性及依赖前序变化的控制写入。派生数据只从唯一真相重新编译，不保存第二份真相。
- 拒绝路径须返回已知事实和可执行的下一步，并证明修正输入后能继续完成；不把请求里不存在的实体或属性回声成目录事实。
- 幂等测试覆盖同调用者同键重复、输入冲突、不同调用者隔离、响应丢失、迟到回执和未知结果不重放。断开等待不能隐式取消已经提交的业务操作。
- 存储替身只复刻存储语义，未实现方法必须抛错；保真检查见 `harnessNativeStorage.test.ts`。
- 模型语义只能由真实 Pi 运行证明，受控模型测试只证明工具调用后的行为。实际付费生成必须另获明确授权；本轮架构验收使用受控供应商结果。
- 关键新增保护须证明红→恢复→绿，可在隔离工作区临时注入违反契约的输入／依赖；不要新建验收或交接文档。

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

只检查本次可能引入的问题；下列示例路径应替换为明确的本次文件，不扫描整个脏工作区：

```bash
# 改动文件的 lint 与可疑原生控件（搜索命中仍需区分注释）
npx eslint src/App.tsx --report-unused-disable-directives --max-warnings 0
rg -n '<(button|input|select|textarea)\b' src/App.tsx

# 只看本次新增/修改文件的行数
wc -l src/App.tsx
```

原生控件只豁免 `src/components/ui/primitives.tsx` 和测试替身，不能豁免整个 `src/components/ui/`。判断以当前命中为准，不拿历史“清零”推定现状；体积规则沿用 [architecture.md](architecture.md)。

不要人工接管用户鼠标做验收。拖拽、点击、悬浮、画布交互优先补入并运行正式 Electron UI 场景；尚未覆盖或必须由用户主观判断的交互，再把具体操作步骤和验证点交给用户。真实 API key 下的生成链路、真实项目包导入导出、macOS 真机行为仍交给用户，除非用户已明确授权对应真实副作用。

## 六、任务完成标准

一次改动可以视为完成，当且仅当：

1. 已说明本次选择了 L0/L1/L2/L3 中哪一级，以及选择依据
2. 该级别中与改动**直接相关**的最小检查已实际执行并通过；不相关命令不需要跑
3. 有失败的，如实报告失败输出，不隐瞒、不用无关测试数量淡化
4. 需要用户手动验证的部分，已写出可照做的步骤和验证点
5. 是否维护开发环境及启动、重启、页面定位方式，统一按 [AGENTS.md 完成标准](../../AGENTS.md#完成标准) 执行；本文件不另设触发条件
6. 新增/改造的关键业务链路已按 [logging.md](logging.md) 补齐结构化日志

完成报告只列实际执行的检查及结果，不需要为未运行且不相关的全量命令道歉。

## 七、CI 全量兜底

`.github/workflows/build.yml` 每次 push / PR 分四层必跑：代码检查 job 执行生成器、静态规则、渲染层/主进程 lint 与类型检查、`test:suites` 分层完整性门禁及 `test:unit`；WebGPU job 安装官方软件 Vulkan adapter、通过 `vgpu doctor` 真渲染后执行 `test:gpu`（含 HDR probe）；大图导出 job 独占 worker 执行 `test:image-export`；原生 SQLite job 在独立依赖目录中执行 `electron:rebuild`，再用 `test:assistant-persistence` 运行唯一原生清单（历史命令名，现在包含助手与工程持久化）。四套测试互斥并覆盖完整 Vitest 清单；`npm test` / `npx vitest run` 保留本地全量入口，但普通 Node 中的 Electron 条件跳过不代表原生验证通过。

原生清单维护在 `scripts/lib/testSuites.cjs`，新增 Electron 条件测试必须登记。验收器要求所有声明文件实际执行、每文件至少一项、零跳过/待办/失败，并核对报告统计与子进程正常退出；不能只看 `success:true` 或报告文件存在。显式基准开关与平台专属测试不冒充原生清单。缺失设备、ABI 错配或专项失败均不能降级成成功。

稳定的「质量门禁」聚合检查只在四层全部成功时通过，安装包构建依赖该门禁。软件 WebGPU 的像素正确性不代表真实 Electron 的交互流畅度；后者仍由匹配场景的 Reality / 性能专项证明。CI 全量覆盖与本地最小验证分工不同，不应互相替代。

构建 job 只在标签或手动触发时运行 `npm run electron:build` 并打包发布。

## 八、交付证据不能借用历史结论

- 证据须对应本次修改后的代码、具体输入规模和实际命令；历史任务的“已完成”不能替代当前验证。
- 需要真实容器的行为按第三节运行正式 Reality，并记录实际窗口/设备与截图。提交确认、GPU 完成和物理屏幕呈现是不同指标，不得混称。
- 关键保护的红→绿证据按第四节断牙规则提供；同代码与环境的实际通过结果可复用，历史“已完成”标签不可替代证据。
- 本地按 L0–L3 裁剪验证；提交推送后核对**当前提交**的必需远端质量门禁。尚在运行或失败时明确待验证/阻塞，不以旧提交绿灯、取消运行或后续无关通过项代替。
