/**
 * Vercel AI SDK 模型步路径（`llm:modelStep`）的供应商无关执行层。
 * 任务 4.2 从 `electron/main/services/llm/sdk/` 迁入（trace/capability-smoke/
 * scripted-model-step 三处按重要记录.md 记录 014 决定留在痕迹AI，不在此列）。
 *
 * openai-compatible adapter 由 `resolveModelStepProviderAdapter` / `createModelStepLanguageModel`
 * 首次使用时惰性装入，不依赖模块加载副作用，确保发布包可安全声明 `sideEffects: false`。
 */
export * from './toolSchema'
export * from './retryPolicy'
export * from './providerAdapter'
export * from './provider'
export * from './modelStep'
export * from './runtime'
