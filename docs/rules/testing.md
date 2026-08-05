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

- 只改能力登记、surface/schema：`npm run check:assistant-capabilities` + 对应精确/相关测试
- `check:assistant-capabilities` 同时执行全域写入覆盖与双路径一致性门禁；失败时按输出补齐 mutation/collection 执行器、`writeExclusion.reason`，或恢复清单指定的共享入口
- 改 runner、状态机、调度、审批、持久化、模型适配：运行对应测试文件或最小专项脚本
- `npm run test:assistant-production` 仅用于助手运行时的跨模块重构、生产验收或发布前检查，不是任意助手改动的默认命令
- 多个助手专项脚本可能包含相同测试文件；一次任务中避免无理由串行叠加

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

```powershell
# 原生控件检查（命中应仅在 primitives.tsx）
$files = Get-ChildItem src -Recurse -Include *.tsx
$hits = $files | Select-String -Pattern '<button','<input','<select','<textarea' -CaseSensitive
$hits | Where-Object { $_.Path -notlike '*src\components\ui\primitives.tsx' }

# 文件行数治理（重点关注本次新增/修改后超过 500 行的文件）
Get-ChildItem -Path src,electron -Recurse -Include *.ts,*.tsx |
  ForEach-Object { $n = (Get-Content $_.FullName).Count; if ($n -gt 500) { "$($_.FullName)`t$n" } }
```

涉及鼠标操作的验证不要自己上手——拖拽、点击、悬浮、画布交互等把具体操作步骤和验证点交给用户。真实 API key 下的生成链路、真实项目包导入导出、macOS 真机行为同样交给用户。

## 六、任务完成标准

一次改动可以视为完成，当且仅当：

1. 已说明本次选择了 L0/L1/L2/L3 中哪一级，以及选择依据
2. 该级别中与改动**直接相关**的最小检查已实际执行并通过；不相关命令不需要跑
3. 有失败的，如实报告失败输出，不隐瞒、不用无关测试数量淡化
4. 需要用户手动验证的部分，已写出可照做的步骤和验证点
5. 已明确告知是否需要重启 `npm run electron:dev`：`✔️无需重启` / `⚠️ 需要重启`
6. 新增/改造的关键业务链路已按 [logging.md](logging.md) 补齐结构化日志

完成报告只列实际执行的检查及结果，不需要为未运行且不相关的全量命令道歉。

## 七、CI 全量兜底

`.github/workflows/build.yml` 的代码检查 job 仍执行生成器、静态规则、渲染层/主进程 lint 与类型检查、全量 Vitest。CI 全量覆盖与本地最小验证分工不同，不应互相替代。

构建 job 只在标签或手动触发时运行 `npm run electron:build` 并打包发布。
