# t188：open_document 执行前失败被记成 unknown

状态：待验证（实现及本地匹配验证通过，待总管理者审查提交）。仅在 D:/VibeCode/henji-wt-fix8、codex/open-doc-preflight 工作；开始时工作区干净。

## 根因与修法

`applicationWriteChannel` 在进入 handler 前执行 `execution.run`，先设置 started=true。`open_document` 原来直接调用 DocumentOperations 和工具打开器，JSON 读取的 PersistenceError 没有前置失败标记；包装以“已进入 handler、缺权威回执”保守返回 notExecuted=false，而 targetMutation 仍是准备阶段默认 none。协调器因此记为 unknown/unresolved。通用实体写入的引擎已把计划与加载前错误标为 ApplicationPreflightFailure，因此能正确记为 not_executed。

本次沿既有统一通道修复，没有创建第二份执行或账本实现：

- DocumentOperations 的共用打开入口先检查打开器、缺失状态，并通过正式 JSON 读取校验未打开的 JSON 文档。预检发生在嵌入标记、工具离开当前文档与界面导航之前，异常经 execution.preflight 返回明确零执行。
- open_document 的查找与嵌入宿主解析也经过相同 preflight，并把同次 execution 交给文档服务。已打开文档以当前会话为真相源；图片单文件包不使用 JSON 仓库读取。
- ApplicationPreflightFailure 保留 cause。公共错误映射保留文档/项目找不到的 NOT_FOUND、恢复提示及原始格式错误文字。格式不支持/损坏提供改用支持文档、从备份恢复、在支持旧格式的版本中导出素材的行动提示；recoverable=true 表示纠正目标或恢复文件后可继续，不表示原输入会被自动重放。
- 统一包装对已派发、未计费、无修改回执的普通异常报告 targetMutation=unknown，避免默认 none 被误读为已确认未修改。前置拒绝仍为 none/notExecuted=true；已付费、已修改、保存失败及后置验证的保守判断不变。
- Surface 共用打开/关闭服务在修改导航前就标记不存在目标的拒绝。

覆盖分级：既有能力的执行与失败恢复语义修复，不新增工具、实体、字段或权限。工具参数、输出 schema、错误码集合与外部契约版本不变，不需版本 2.4.2 或指纹登记；错误 details 是既有开放对象，targetMutation=unknown 已用于运行时恢复事实。

选型：复用本项目 ApplicationWriteExecution、ApplicationPreflightFailure、DocumentOperations 和现有原生 SQLite 测试运行器。属于执行事实边界修复，无需新增开源库或自研状态机，未安装依赖。

## 同类路径核对与边界

- 通用 JSON 打开：剪辑、画布、口播、镜头参考的 open_document 共享该前置校验，失败不进入工具打开器；文档查找、嵌入宿主解析、缺失文件及无打开器也在修改之前拒绝。
- switch_workspace 与 open_application_surface 的非法参数由公共注册器 schema 预检挡住；Surface 服务本身不存在页面的打开/关闭也标为前置拒绝。
- 独立 open_canvas_project、open_camera_stage_project 已移除，公共项目打开由通用文档入口承担。剪辑领域 openVideoEditProject 仍可能创建缺失的主剪辑或登记主文档；不能把其后读取失败一概视为零执行。
- focus_application_entity 及工具内部直接加载还可能先离开当前文档、附着实例、改变选择或登记最近打开时间；未改为按异常文案猜零执行。此类已经可能改变状态的失败继续保守处理，本次不声称它们的整个生命周期已实测。
- 图片文档的打开器目前请求编辑器加载并切页，由独立包加载器处理；本次仅覆盖摘要缺失等通用前置检查，未把异步包加载结果伪装成 JSON 读取事实。

## 设计自查

1. 助手只凭名称和说明能否用对？能，沿用 open_document、list_documents、稳定文档引用；失败说明下一步改目标、恢复文件或导出素材，执行事实明确区分未执行和未知。
2. 能否 AI 先做、人只确认？能，应用自动完成前置校验；助手可据提示纠正目标，文件恢复与旧格式素材导出需要用户提供可用来源，不自动重复未知修改或付费任务。
3. 产物能否直接流进其他工作区？能，继续使用原文档和素材引用；本次不生成副本文档、不改变跨工作区数据模型。

## 改动文件

- src/core/application-control/execution/transactionFailure.ts：保留前置失败的原始 cause。
- src/core/application-control/execution/writeExecution.ts：派发后无权威修改回执用 unknown 表达。
- src/core/application-control/execution/writeExecution.test.ts：明确零执行、领域原因及不伪造 none 的断言。
- src/features/documents/documentOperations.ts：共享打开入口的执行前 JSON/缺失/打开器校验。
- src/features/documents/documentOperations.test.ts：拒绝时原文档、嵌入标记和版本不变。
- src/features/documents/application/registerDocumentsCapabilityHandlers.ts：查找与宿主解析的 preflight 及同次 execution 传递。
- src/features/documents/application/documentsReflectionResult.test.ts：正式 open_document 的格式、损坏与找不到三种加载前拒绝。
- src/features/application-control/capabilities/registry.ts：保留文档错误身份和可行动恢复提示。
- src/features/application-control/capabilities/domainCapabilityHandlers.test.ts：镜头参考打开测试的读取边界替身与释放。
- src/features/navigation/application/surfaceNavigationService.ts：共用打开/关闭页面的前置拒绝。
- src/features/navigation/application/surfaceCapabilityService.test.ts：不存在页面零执行且导航不变。
- electron/main/services/application-runtime/operationStore.test.ts：统一加载拒绝落原生账本为 not_executed/verified。
- docs/task/外部智能体能力开放/00-任务总览.md：仅新增 t188 行。
- 本任务文件：记录根因、设计、证据与边界。

## 验证

按 testing.md L2：共享执行状态及文件读取边界变化，采用对应精确测试和所属工程类型检查；新增原生账本断言，按任务明确要求运行 test:assistant-persistence。

- 精确 Vitest（--silent）：writeExecution、documentOperations、documentsReflectionResult、domainCapabilityHandlers、writeCapabilityExecution、registry、surfaceCapabilityService 七文件共 59 项通过。首轮 58 通过/1 失败：旧断言仅接受外层 DocumentNotOpenableError；更新为断言 cause 保留该领域错误后，documentOperations 与更新了替身的 domainCapabilityHandlers 两文件 19 项定向重跑通过，其余未变的通过证据复用。
- npm run test:assistant-persistence：Electron 原生 SQLite 9 文件、98 项、0 跳过，通过。
- npx tsc -p tsconfig.json --noEmit：通过。
- npx tsc -p tsconfig.electron.json --noEmit：通过。
- 未运行全量、Reality、构建或静态门禁，按任务其余交给 CI。普通缺陷修复未改变能力通路或欠账清单，不更新 assistant-status 台账。

## 管理者注意

- 未打开 JSON 文档先增加一次正式只读校验，再由工具自己的加载路径读取；复用已有入口保障错误先于离开/切页，没有改为缓存真相。大文档会增加读取/解析开销，本次未做真实文件规模验收。两次读取间文件若被外部修改，后续错误仍保守报告未知，不能承诺 TOCTOU 不存在。
- 旧 unknown 操作没有被自动改判或重放；现场原 operationId 的核对恢复留给已有正式恢复入口。
- 实际 Electron、外部 Agent 全链路与图片包加载未验。管理者更新运行产物后再做现场复测，本任务没有启停任何开发实例。
- 没有 Git 写操作、SDK 改动、密钥读取、付费调用、依赖删除/重装或主仓写操作。总管理者负责审查、Git 提交与后续集成。
