/**
 * 大语言模型（openai-compatible 协议）相关能力：供应商协议差异、思考参数请求体处理、
 * 内置模型能力目录、供应商预设、供应商无关的默认值、模型步契约、共享类型。
 *
 * 任务 4.1 从 `src/core/llm/` 迁入。痕迹AI 的助手与提示词优化业务逻辑
 * （`promptOptimization*.ts`、`agentProfiles.ts`、`capabilitySmoke*.ts`、`events.ts`）
 * 不属于"供应商无关的纯逻辑"，仍留在应用侧 `src/core/llm/`。
 */
export * from './reasoning'
export * from './providerProtocol'
export * from './providerReasoningRequest'
export * from './modelCatalogEntries'
export * from './modelCatalog'
export * from './modelStep'
export * from './types'
export * from './defaults'
export * from './providerPresets'
export * from './endpointProfiles'
export * from './providerSetup'

// 任务 4.2 迁入：LLM 执行层——原生 SSE 流式聊天路径（`chatTypes`/`streaming`/`chat`/
// `requestContract`/`discovery`）与 Vercel AI SDK 模型步路径（`./sdk`，供应商无关执行逻辑）。
// trace（助手结构化追踪）、capability-smoke（依赖仍留痕迹AI 的 `src/core/llm/capabilitySmoke.ts`
// 请求/结果 schema）、scripted-model-step（助手测试替身）三处按重要记录.md 记录 014 决定
// 不迁入 SDK，理由与依赖分析见该记录。
export * from './chatTypes'
export * from './streaming'
export * from './chat'
export * from './requestContract'
export * from './discovery'
export * from './sdk'
