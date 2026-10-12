# f5：输入错误说明与工具 schema 摘要

任务日期：2026-10-12。工作区：`D:\VibeCode\henji-wt-f5`，实际分支 `codex/f5`，开始时工作区干净、无上游。按本任务授权只改工作区，不切分支、不执行 Git 写操作，不改 SDK、不删或重装 node_modules、不启停开发实例、不运行 Reality、不调用付费服务。总管理者负责审查、集成、Git 与运行产物。

## 根因与修改范围

- t191 的共享 Zod 错误投影把缺失和错类型合写，只有未知字段显示接受列表，且只展示业务 schema。
- 现有 dispatcher 对每个工具都接受 includeRevisions/includeEvidence/includeDetails；目录原先按工具选择性披露，导致接受列表与实际执行不一致。
- 检查了共享 formatter 的渲染注册器调用方、主进程协议/技能/业务读写捕获、操作账本嵌套失败与查询原操作的投影。缺失、类型/取值、未知字段均逐行返回；必填项标注，通用项单列；只回显收到的类型，不回显实际输入值。缺失对象摘要只列必需键。
- 通用选项复用一份 Zod 声明，目录如实向全部工具披露三个既有选项；选项仍不进入业务输入和幂等身份。无效通用选项不派发操作，并收集业务 schema 的其他错误；格式化失败副本不改持久账本。
- 本次不新增业务实体、专用算法、Surface、权限或副作用，覆盖分级为既有发现契约的能力增量；公共 Pi/MCP 入口共用实现。

## Schema 摘要与版本

- 外部契约 **2.5.2**；全授权、包含技能工具的 tools/list 规范化指纹：`c711211caa843396a4499e054fdc37b8aee45cfa3104301691238728e05fb4d8`，在 toolCatalog.test.ts 登记，不改旧版本指纹。
- 单工具 schemaHash：`SHA-256(UTF-8(JSON({name, description, inputSchema})))` 十六进制前 16 位；递归按对象键排序，数组顺序保留。名称、描述和参数变化可检出；不把哈希追加到工具描述。
- 目录 catalogSchemaHash：按工具 name 排序的 `[{name, schemaHash}]` 用同一算法取前 16 位；只覆盖当前调用者授权目录，不包含用户数据、运行上下文、端口或技能索引。
- `describe_application_contract({names:["get_video_edit_clip_pauses"]})` 返回 `data.toolSchemas: [{name,schemaHash}]`；不传 names 返回全目录摘要，传空数组返回空摘要。
- `describe_application_contract({names:["get_video_edit_clip_pauses"],includeSchemas:true})` 返回同一条目的完整 description/inputSchema。完整 schema 要求非空 names，便于客户端按需分批；未授权或未知名称不返回条目，不泄露隐藏工具 schema。
- `get_current_application_context({})` 返回 data.catalogSchemaHash。目录哈希变化后先查询工具摘要，发现客户端缓存的 schemaHash 不一致时，再按 names/includeSchemas 读取服务端完整 schema 并按其参数调用；重连/通知不刷新客户端缓存时仍适用。
- 复用现有 Zod 4 原生 JSON Schema 与 Node crypto SHA-256；无需引入第三方哈希、规范化或校验库。仅用确定性对象键排序进行契约序列化，已有技术方案满足效果与性能需要。

## 示例错误文本

```text
INVALID_INPUT:缺少必填参数 clipRef（对象 {kind, id}）。
这个工具接受：clipRef（必填）。
通用：includeRevisions、includeEvidence、includeDetails。
```

```text
INVALID_INPUT:limit 应为 1–100 的整数，收到字符串。
这个工具接受：operationId（必填）、resultField、cursor、limit。
通用：includeRevisions、includeEvidence、includeDetails。
```

```text
INVALID_INPUT:不认识的参数：foo。
这个工具接受：clipRef（必填）。
通用：includeRevisions、includeEvidence、includeDetails。
```

## 设计自查

1. 助手只凭名称和说明能否用对？能。错误给出必填、约束与真实接受字段；发现工具说明列出按名称获取摘要/完整参数及缓存不一致时的调用方式。
2. 能否 AI 先做、人只确认？能。Agent 可自行核对目录与缓存、批量获取 schema、一次修正全部输入问题；业务授权与用户确认沿原入口。
3. 产物能否直接流进其他工作区？本任务不产生新媒体或文档产物；既有稳定引用、跨工作区流转、保存和撤销契约保持原实现。

## 匹配验证（L2）

改变共享输入错误和外部发现契约，风险是错误自纠、授权目录与客户端缓存不一致；按 testing.md L2 与公共调用/schema 行运行精确测试、双工程类型检查、主进程导入、依赖图和能力结构检查，不升级全量/Reality/构建。

- `npx vitest run src/core/application-control/inputValidation.test.ts electron/main/services/application-runtime/toolCatalog.test.ts electron/main/services/mcp/server.test.ts electron/main/services/application-runtime/resultProjection.test.ts src/features/application-control/capabilities/registry.test.ts --silent`：首次 54 通过/1 失败；修复后只重跑受影响文件，最终 5 文件 55 项全部通过，无跳过。inputValidation 3、toolCatalog 16、server 22、resultProjection 5、registry 9；有效证据按未变文件复用，不重复整套。
- `npx tsc -p tsconfig.electron.json --noEmit`：首次失败已修复，最终通过。
- `npx tsc -p tsconfig.json --noEmit`：首次失败已修复，最终通过。
- 改动 10 个 TS 文件的文件级 ESLint（`--report-unused-disable-directives --max-warnings 0`）：全部通过；后续变动只精确复验对应文件。
- `npm run check:main-imports`：通过，661 个主进程/preload 文件。
- `npm run check:dependency-graph`：通过，2 个静态值 SCC、0 条冻结跨层边、361 条跨 feature 非 index 导入；59.77 秒。
- `npm run check:assistant-capabilities:structure`：通过，原生能力、Application API 边界、Surface 观察与双端技能同步。
- `git diff --check`（只读）：通过。
- 初轮失败如实记录：直接导入剪辑叶子能力触发现有循环初始化，测试改从正式总注册入口取声明；缺失对象摘要最初列出可选 revision/label，已改为必需键；2.5.2 初次指纹未登记，按实际最终目录登记；主进程 tsc 指出协议 schema 的类型声明缺少显式 type，补明 type="object"，不改变实际 JSON。

## 外部 Agent 复测

1. 总管理者集成并生成新运行产物后复测；读取 describe_application_contract 确认 2.5.2，与 get_current_application_context 的 catalogSchemaHash 比较。
2. 调用 get_video_edit_clip_pauses({})，核对缺少必填 clipRef、对象必需键、必填接受列表与通用选项；调用 get_application_operation({operationId:"有效UUID",limit:"50"}) 核对类型/范围说明；用有效 clipRef 加 foo 核对未知字段，输入拒绝不会启动媒体分析。
3. 同时给 read_application_media 传错误的 includeRevisions/includeEvidence、缺 ref 并多传 foo，检查问题逐行全部返回、输入值不被回显。
4. 按 names 查询目标工具摘要，随后 names/includeSchemas:true 取得完整参数与说明，核对 tools/list 同一工具；按说明的规范化算法计算本地 schemaHash。
5. 在旧客户端缓存仍保留 2.5.1 工具时查询服务端 2.5.2 摘要；发现不一致后按返回的新 schema 调用，确认无需依赖缓存刷新。服务端离线测试不代表 Claude Code 缓存行为已验收。

## 总管理者注意

- 本工作区不是 main；遵照禁止 Git 写操作要求没有切换或建立上游，需由管理者集成。
- toolCatalog、dispatcher、注册器、builtinApplicationCapabilities、localHostContracts、版本指纹与总览是可能的并行任务冲突点；合并导致工具声明变动时按最终目录重新核对 2.5.2 指纹。
- 主进程与渲染运行时代码有变化，外部复测前需管理者更新运行产物；本任务不构建、不启停 Electron。真实 Electron 生命周期、真实 Agent 缓存行为未验证。
- 普通缺陷修复与发现摘要补全，不改变业务可调用的通/不通或既有欠账，不推翻业务能力台账，故不改 assistant-status.md。

## 改动文件

- `src/core/application-control/inputValidation.ts`：共享约束/缺失/类型错误投影、接受字段与通用选项唯一声明。
- `src/core/application-control/inputValidation.test.ts`：三类错误与多问题/范围/格式/脱敏精确断言。
- `src/core/application-control/builtinApplicationCapabilities.ts`：当前上下文输出声明增加目录哈希，更新缓存恢复说明。
- `src/core/application-control/localHostContracts.ts`：外部契约设为 2.5.2。
- `src/features/application-control/capabilities/registry.ts`：业务输入校验向共享投影提供原输入以区分缺失和类型。
- `electron/main/services/application-runtime/applicationToolDispatcher.ts`：通用错误聚合、外部接受列表、完整 schema 查询参数与上下文目录哈希。
- `electron/main/services/application-runtime/resultProjection.ts`：从共用 Zod 声明派生三个通用字段的目录信息。
- `electron/main/services/application-runtime/toolCatalog.ts`：按名称的 schema 摘要/完整输入、稳定哈希与全工具通用字段披露。
- `electron/main/services/application-runtime/toolCatalog.test.ts`：登记 2.5.2 指纹、哈希稳定性/授权过滤与目录投影断言。
- `electron/main/services/mcp/server.test.ts`：正式 HTTP 入口验证目录哈希、完整 schema 与混合输入问题。
- `docs/task/外部智能体能力开放/00-任务总览.md`：仅增加/更新 f5 一行。
- `docs/task/外部智能体能力开放/f5-输入错误与schema摘要.md`：记录设计、自查、复测方式、检查证据和审查风险。
