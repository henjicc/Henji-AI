# 智能助手任务交接

## 当前工作

- 当前阶段：第六阶段 · 后续增强已收口
- 状态：6.1、6.2 已完成；6.4、6.5 实现完成待最终真机/长稳验证；6.3 因无真实需求取消
- 下一任务：重新读取阶段记录并进入 7.1～7.4，全面接入内置生成、画布/项目、工具箱/素材与确定性跨工作区工作流
- 阻塞问题：无代码阻塞

## 下一步

1. 完成第七至第八阶段代码、自动化与任务记录，再统一执行真机/真实 Provider 验收，不在中途要求用户分批测试。
2. 最终复验自然语言生成时，确认执行思路来自 router 语义判断，批准方式按选择生效，创建任务仅显示“已提交/生成中”，Provider 完成后才显示成功。
3. 最终复验诊断时，确认只查询一次紧凑证据，答复先给结论和解决步骤，Markdown 可读，不再显示多张大结果卸载卡。
4. 最终复验 KIE 网络故障时，通过日志中的网络错误码区分连接前失败与不明确失败，并确认不产生重复任务。
5. 最终复验停靠、悬浮、拖动与缩放，重点观察已有长消息时的跟手性。

<!-- 以下为第五阶段原始验收步骤，保留供最终测试清单合并。 -->
1. 重启 `npm run electron:dev`，在生成工作区和其他工作区分别输入“生成一张剪纸风格的猫咪的那种照片”；确认计划直接显示生成工具域，先搜索模型、读取最终 schema、按批准方式处理后创建可见任务，不再连续搜索空能力目录。
2. 重启 `npm run electron:dev`，在“设置 → 平台密钥 → 助手用户指令”保存包含供应商偏好、普通本地路径、带查询参数网址以及虚构 API Key/Cookie/密码形态的内容；确认普通内容保留、秘密进入模型前脱敏，再通过对话要求助手长期记住供应商/模型或回答风格偏好，检查 R2 审批与下一次 run 的选型/表达。
3. 在 `src/core/modelCatalog/generationModelDescriptions.ts` 补充至少两个同模型跨供应商条目的定性描述，重启后确认模型目录查询返回同一描述且能力筛选仍由 tags/schema 决定。
4. 确认 Agent Profile 已对目标真实模型完成 capability smoke；复验第四阶段停靠/悬浮/缩放与长对话实时排版。
5. 按 `首用例操作脚本.md` 分别完成可见生成任务和 requestId 诊断：批准具体预览，核对 taskId 跳转、证据编号、低置信度表达和无敏感原文。
6. 按 `护栏验收清单.md` 验证取消、暂停/恢复、批准/拒绝/过期、revision 变化、renderer 重载、非法参数、注入文本和日志可解释性。
7. 按 `画布闭环操作脚本.md` 在明确项目中创建上传/图片节点、连接、定位、重开和撤销；切换项目验证冲突不会写入错误项目。
8. 按 `最小评测结果.md` 用固定 Profile 对生成、诊断、画布各重复至少 3 次，并在日志窗口按 runId/toolCallId 抽查事件与敏感探针；全部通过后进入 6.1。

## 阻塞与风险

- 未使用真实 API Key 自动发起 capability smoke，避免未经用户确认的外部请求与费用；真实模型能力仍需用户显式验证。
- 2026-07-23 首次 DeepSeek 实测确认 `json_schema` 返回 “This response_format type is unavailable now”；已改为按 `json/schema` 模式映射，修复后真实结果待用户复验。
- `npm run electron:smoke` 捕获用户历史外部媒体 `E:\图片\…\VID_20260630_204459.mp4` 的 `henji-media://` 403；初始加载诊断确认来源，与第二阶段代码无关。
- 2.2 的 UI 动作涉及鼠标和真实长任务，按项目约定只提供步骤，不由自动化代替用户验证。
- 4.1 几何与局部工作区避让已由单测覆盖；尺寸帧只写助手与工作区两个必要 DOM，长对话离屏块跳过布局/绘制，代码路径已消除逐帧根级样式失效和 React/Zustand 重渲染。真实鼠标跟手性、复杂工作区重排和不同 DPI 下的实际感受仍需用户确认。
- 助手 UI 已可发起真实 run，但没有使用真实 API Key 自动请求 Provider，避免未经用户确认的费用；完整 Runner → 工具 → observation 闭环仍由 5.1 验收。
- run/thread/event/checkpoint/artifact 已落 SQLite；应用或 utility 重启后的活动 run 会进入 `recovery_required`，只能显式创建重试 run，不会自动重放未知副作用。
- 诊断入口只保证受限证据读取与表达约束；真实日志质量、Provider 错误覆盖率和诊断效果需在 5.4/6.2 评测校准。
- token/压缩阈值是初始值，后续必须由 5.4/6.2 真实评测校准。
- 第五阶段确定性评测已通过，但真实模型具有随机性且可能产生费用；未自动调用真实 Provider，成功率、延迟和 token 基线仍需用户显式执行。
- 画布 MVP 只开放上传节点与图片节点，完整节点/项目能力仍由 7.2 接入；当前 undoRef 只允许严格撤销 Agent 自己的栈顶动作，用户后续编辑会使旧引用失效。
- 中央模型描述目前按用户要求保留为空，未填写时不会注入模型元数据；真实选型效果需要用户补充描述后复验。
- 用户指令文件允许手工编辑，最多 4000 字；超限或包含空字符时明确报错且不自动覆盖。凭据形态会在 UI 提示并在进入模型前脱敏，普通路径、网址和自然语言保持原样，但仍不应主动把密钥写入指令文件。
- 旧 `model-preferences.json` 已退出运行时读取和迁移链路；即使本地残留也不会影响 `user-instructions.md`，无需专门清理。
- 真实 run `8aa28be8` 的失败不是模型未适配或 KIE 缺失，而是生成意图漏词、router 输出校验降级、能力目录整句/category 检索和发现结果未激活共同造成；以上代码路径均已修复，真实费用任务仍需用户复验。
- 助手长期记忆已经实现但默认关闭；候选需确认，支持来源、scope、TTL、冲突、编辑删除清空和相关性检索。真实交互与隐私抽查留到最终测试。

## 必读交付物

- `src/core/assistant/hostContracts.ts`
- `src/features/assistant/frontendTools/hostCommandRegistry.ts`
- `electron/main/services/assistant/frontend-tool-bridge.ts`
- `src/core/llm/modelStep.ts`
- `electron/main/services/llm/sdk/model-step.ts`
- `src/core/llm/agentProfiles.ts`
- `src/core/assistant/events.ts`
- `src/core/assistant/runtimeContracts.ts`
- `src/core/assistant/toolContracts.ts`
- `src/core/assistant/userInstructions.ts`
- `src/core/modelCatalog/generationModelDescriptions.ts`
- `electron/main/services/agent-runtime/runtime.ts`
- `electron/main/services/agent-runtime/runner/runner.ts`
- `electron/main/services/agent-runtime/tools/gateway.ts`
- `electron/main/services/agent-runtime/context/builder.ts`
- `src/features/assistant/AssistantSidebar.tsx`
- `src/features/assistant/hooks/useAssistantPanelInteraction.ts`
- `src/features/assistant/hooks/useAgentRun.ts`
- `src/features/assistant/conversation/agentRunReducer.ts`
- `src/features/assistant/diagnostics/openAssistantDiagnosis.ts`
- `electron/main/services/agent-runtime/diagnostics/query-diagnostic-events.ts`
- `electron/main/services/agent-runtime/tools/builtin/frontend-canvas.ts`
- `electron/main/services/agent-runtime/tools/builtin/user-instructions.ts`
- `electron/main/services/assistant/user-instructions.ts`
- `electron/main/services/agent-runtime/evaluation/minimal-evaluator.ts`
- `src/features/canvas/domain/agentCanvasCatalog.ts`
- `src/features/canvas/application/agentCanvasActions.ts`
- `docs/task/智能助手/任务/第五阶段-闭环验证/最小评测结果.md`
