# t115 / R12：死入口、IPC 释放与 Knip 门禁

状态：实现及匹配验证完成，待总管理者审查与 Git。只修改工作区，未执行 Git 写操作；未改体检报告、SDK 源码或 R04/R05 保护文件。

## 范围、选型与实现

- 删除旧 `ai:getProviderKeyStatus` handler。仓内 src/electron/scripts 联合搜索只找到原注册和 keystore-boundary 测试中的旧通道字符串；自动化脚本调用 preload 的 `ai.getProviderKeyStatus()`，实际走 `ai:getRuntimeProviderKeyStatus`。`getAiProviderKeyStatus` 服务仍被新运行时调用，保留。
- streamEcho 先订阅再 invoke，启动失败（transport 拒绝或 IPC 错误 envelope）立即移除自己的 listener 并原样抛错；成功返回 disposer，取消请求失败前也已经移除 listener。
- 联合扫描全部 preload 的 `ipcRenderer.on`、subscribe/listen 包装与 invoke：chatStream 的 finally、modelStep 的 finally 已覆盖失败；其余是独立订阅或进程生命周期的 sharedTexture/port 事件桥，没有发现第二处相同的启动失败泄漏。未扩大成所有 Worker/GPU 资源释放审计。
- 使用成熟 Knip **6.40.0** 精确 devDependency；未自研另一套死代码分析器。对比已有 Madge：它适合依赖图/SCC，不能替代 Knip 的未使用依赖与导出分析。IPC 小门禁复用仓内 TypeScript AST/checker，不运行 Electron/业务模块。
- `docs/rules/architecture.md` 同步移除已删除 FactoryRegistry 的示例引用，保留 renderer 不执行 provider 的原边界。
- 官方依据：[Knip 配置](https://knip.dev/reference/configuration)、[入口与项目文件](https://knip.dev/guides/configuring-project-files)、[工作区](https://knip.dev/features/monorepos-and-workspaces)。按入口/项目区分校准，不将每个业务文件登记为入口来消掉报告。

安装使用 `npm install -D --save-exact knip@6.40.0 --ignore-scripts --cache node_modules/.cache/npm`，删除依赖使用同样的 ignore-scripts/cache 参数；不触发 postinstall 的 SDK 构建。默认 npm cache 在 writable root 外，首次 npm view 因 EPERM 失败，改用仓内忽略目录的单次 cache 参数，未改 npm/代理/TLS 配置。

## 删除清单与证据

每项都检查源码职责，并以含 renderer/main/preload、测试、脚本、公共桶、Worker/utility、反射入口的 Knip 图联合复核；再以路径和导出符号搜索排除仅同名而来自其他模块的匹配。删除后两套类型检查验证没有遗留导入。未使用文件未参与运行时装载，不宣称删除等量减少首屏包体。

| 删除文件 | 证据与用途 |
| --- | --- |
| `src/config/presetStateMapping.ts` | createPresetSetterMap/PresetSetters 无调用或导入；旧逐字段 setter 映射。 |
| `src/hooks/useDropdown.ts` | useDropdown 仅自身定义；现有 Dropdown 使用自己的正式入口。 |
| `src/hooks/useKeyboardNav.ts` | useKeyboardNav 仅自身定义，无测试/脚本消费。 |
| `src/hooks/usePresetLoader.ts` | usePresetLoader/PresetApplyResult 仅自身定义；旧预设 hook。 |
| `src/types/schema.ts` | 旧参数类型表没有导入；同名 ParamDef 等实际来自 core/types。 |
| `src/utils/aspectRatio.ts` | 整个文件无导入；同名比例/裁剪符号实际来自共享媒体与画布实现。 |
| `src/utils/fileUtils.ts` | getExtensionFromMimeType/getMimeTypeFromDataURI 仅自身定义。 |
| `src/utils/modelConfig.ts` | 无导入；同名 ProgressConfig 实际从正式模型类型消费。 |
| `src/utils/modelNameSort.ts` | compareModelNamesForSettings 仅自身定义；pinyin-pro 唯一导入也在此。 |
| `src/utils/polling.ts` | pollUntilComplete/PollingOptions 仅自身定义，无运行/测试消费。 |
| `src/utils/progress.ts` | calculateProgress 仅旧冷 polling 使用，两者一并删除。 |
| `src/utils/qwenResolutionCalculator.ts` | 无导入；同名 findClosestAspectRatio 来自正式 linkage 实现。 |
| `src/utils/referenceParser.ts` | 无导入；DOM Element 同名搜索不是引用此旧 parser。 |
| `src/utils/resolutionCalculator.ts` | 无导入，仅冷模块定义/同名类型；正式比例计算另有入口。 |
| `src/utils/stateManager.ts` | 旧预设 capture/restore 状态映射无导入或消费。 |
| `src/core/providers/ProviderFactoryRegistry.ts` | factory=never，create 只抛不可用；类/实例/类型均无调用方。 |
| `src/core/providers/base/paramTransforms.ts` | 无文件导入；旧 renderer provider 媒体转换辅助。 |
| `src/core/providers/base/polling.ts` | pollTaskStatus 无消费；正式运行时经 SDK，不使用此循环。 |
| `src/core/providers/base/requestBodySummary.ts` | summarizeRequestBody 无消费；旧请求摘要实现。 |
| `src/services/presets/migration.ts` | 仅公共桶重导出，无调用；按开发期规则删除旧 localStorage 迁移并同步桶。 |
| `src/features/cameraStage/export/cameraStageAspectCrop.ts` | cropDataUrlToAspectRatio/Bytes 无消费；旧 dataURL 裁剪。 |
| `src/features/canvas/nodes/config.ts` | nodeConfig/toolbarConfig 无消费；旧静态尺寸表。 |

依赖删除：`@types/react-window`、`react-window`、`react-image-crop` 没有 src/electron/scripts 引用；`pinyin-pro` 仅由上述冷 modelNameSort 引用。package.json 与 lockfile 同步。Knip 新增 native parser 的平台可选依赖导致 lockfile 较大；npm 同时更新既存 `@emnapi/runtime 1.11.1→1.11.2`、`tinyglobby 0.2.15→0.2.17` 及其嵌套 `picomatch 4.0.3→4.0.7`，请总管理者审查。SDK workspace 的 lock 元数据没有变更。

## 保留例外（覆盖报告 3.8 全部 35 项）

| 文件或入口 | 保留理由 / 配置方式 |
| --- | --- |
| `src/features/documents/index.ts` | 公共桶；保留公开契约，不以暂无直接消费者删除。 |
| `src/features/imageEdit/index.ts` | 公共桶且 R04 保护范围。 |
| `src/core/panels/index.ts` | 公共桶；保留公开入口。 |
| `src/services/presets/index.ts` | 公共桶；只移除被删旧 migration 的重导出。 |
| `src/features/imageEdit/tools/index.ts` | 公共桶且 R04 保护范围。 |
| `src/features/imageEdit/v3/gpu/index.ts` | 公共桶且 R04 保护范围。 |
| `src/core/examples/linkageExamples.ts` | 可独立阅读/校验的示例，显式 entry。 |
| `src/core/examples/modelDefinitionExamples.ts` | 示例，显式 entry。 |
| `src/core/examples/paramDefExamples.ts` | 示例，显式 entry。 |
| `src/core/panels/validatePanelConfig.ts` | 从保留的 panels 公共桶可达，公开验证工具；不能仅凭生产入口暂无调用判死。 |
| `src/features/canvas/extensions/CanvasExtension.ts` | 预留第三方扩展设计，本次未授权撤销设计；显式 entry，不宣称已装载。 |
| `src/features/documents/application/documentPromptStoreLedger.ts` | 能力门禁通过反射/源扫描读取的账本；显式 entry。 |
| `src/features/videoEdit/engine/videoEditColorGradeShader.ts` | WGSL 重导出，benchmark 按历史文件名识别；显式 entry。 |
| `src/core/imaging/effects/gaussianMeasurements.ts` | 本次 Knip 额外发现的冷候选，位于 R04 保护目录；只记基线，不删。 |

Knip 配置以 `src/**/index.{ts,tsx}` 保留公共桶，以 `src/core/examples/*.ts` 保留示例；对应模式若新增条目，须仍符合公开桶/示例职责。main/preload/renderer 为真实根入口；Electron utility/worker 与 renderer Worker 作为宿主装载入口；所有测试、CLI/生成/验证脚本和构建配置作为独立入口。动态 import 和 import.meta.glob 由 Knip/Vite 分析，着色器生成源/开发导航的现有静态装配链保持不动。忽略 SDK workspace 仅限定本任务分析范围，宿主 SDK 导入仍参加依赖检查。

系统二进制例外逐条：`attrib` 为 Windows 属性命令；`cargo`、`rustup` 为 Rust 构建工具；`dumpbin` 为 MSVC 检查工具；`powershell`、`pwsh` 为宿主 shell；`ffmpeg`、`ffprobe` 为随包媒体程序。它们不是应从 npm 安装的包。

## 两个新门禁

**IPC：** `npm run check:ipc-contract` 使用 TypeScript AST 与符号解析读取主进程注册及 preload 调用，解析字面量、import 常量别名、对象属性、条件表达式与 PORT_CALL_CHANNELS 索引映射。请求 handler/invoke 集合完全一致；消息/MessagePort 的 ipcMain.on 与 preload send/postMessage 分表完全一致；主进程事件发送与 preload 订阅分表完全一致。通用 registry/nativeInvoke/on/postMessage 的形参转发由调用点消费，无法解析的实际请求端点直接失败。并非任意 JavaScript 动态求值器，新动态通道表达式须可静态对账。无存量不匹配基线、无整组豁免。

当前集合：**347 请求 / 2 消息端口 / 25 事件**。夹具证明新增未消费 handler、调用未注册通道、未解析动态端点、事件和请求混淆都会失败；导入常量别名与端口映射可正确解析。

**死代码：** `npm run check:dead-code` 执行真实 Knip JSON reporter，只阻断新增未使用文件/依赖；导出/类型及 unlisted/unresolved/binaries 只报告。工具失败、非 JSON 或基线损坏不是通过。基线 `scripts/dead-code-baseline.json` 为 **1 文件 / 0 依赖**，唯一文件是上面的 R04 候选。`npm run dead-code:baseline` 只允许写回缩减集合，发现任何新增时失败且保持原基线字节不变；首次登记用显式 `--initialize <理由>`，已有基线不可重新初始化。不提供扩大基线开关。

未使用导出详情可执行 `npx knip --include exports,types --no-progress --no-exit-code`；门禁显示汇总计数，未自动删除公共导出。现有缺声明候选（esbuild、nanoid、@electron/asar、vite-node）未夹带修复，SDK 检查脚本也会因根 scripts 引用而出现在报告；构建输出相对路径 Worker .cjs 的 unresolved 属于产物命名，源码 entry 已登记。CI checks 静态阶段加入两个门禁，并复用 Node test 夹具自检阶段。

依赖图检查通过，现存基线仍为 2 SCC / 0 冻结跨层边 / 426 跨 feature 非 index 导入 / 首屏 979 模块；删除的冷模块未参与原入口图，集合没有进一步缩减，故不写回无变化基线。

## 验证与风险

- 精确 Vitest：keystore-boundary 1 项、diagnostics-stream 3 项通过，覆盖启动失败释放、先订阅、按 streamId 隔离、取消失败前释放。
- Node 门禁夹具：IPC 4 项通过；dead-code 2 项通过（含真实 Knip、基线拒绝增长与可缩减）。
- `npx tsc -p tsconfig.json --noEmit`、`npx tsc -p tsconfig.electron.json --noEmit`：通过。
- 本次 5 个修改/新增业务 TS 文件 ESLint：通过；新 CJS 脚本及测试 `node --check`：通过。
- `check:main-imports`（608 文件）、`check:dependency-graph`、`check:ui-residue`：通过。
- `check:assistant-capabilities` 按同一脚本拆成 structure/coverage/invariants 并向两个 Vitest 阶段传 `--silent`：结构通过，coverage 13 项、invariants 199 项通过。仅因用户指定删除后的清单运行，未扩大到全量单测。
- `check:ipc-contract`：通过；`check:dead-code`：通过，1 文件 / 0 依赖，导出/类型仅报告。
- `npx electron-vite build`：通过，main 27.02 秒、preload 242 毫秒、renderer 2 分 23 秒，退出 0；本次主进程打包用于排除 tsc 无法捕获的别名/打包风险，不升级 electron:build。产物位于忽略目录 out/；未启动应用。
- 初次失败均已明确修正：Knip package.json 不导出（改从正式 package entry 定位 CLI）；Electron mock 缺 sharedTexture（补齐）；afterEach 直接返回 VitestUtils 的类型错误（改 void block）。未掩盖失败或删除负例。
- 不跑 Reality、不启动/重启 electron:dev、不执行真实生成/付费调用、不提交或推送。未审查所有未使用导出，未验证 Linux CI 时长；总管理者需审查 lockfile 传递变动及共享工作区最终集成。

## 设计自查

1. **助手只凭名称和说明能否用对？** 不新增业务能力；两个门禁用明确命令和真实通道/路径报告结果，开发助手可据此定位。业务助手仍走现有正式运行时与领域入口，删掉无法执行的旧 factory 与通道避免误用。
2. **能否 AI 先做、人只确认？** 两端集合和未使用增量由 CI 自动核对；人审查具体删除证据与例外。没有要求用户手工逐个核对几百个通道。
3. **产物能否直接流进其他工作区？** 没有新媒体产物/搬运流程；保留文档公共桶、反射账本、动态加载和跨工作区正式操作。只清理不可达旧实现，现有产物流转保持同一契约。
