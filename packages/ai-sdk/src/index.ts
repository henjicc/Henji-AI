/**
 * @henjicc/ai-sdk 根入口。
 *
 * 五个子路径入口（runtime/providers/catalog/llm 与包根）保留模块边界，包根同时重新导出
 * 公共内容。原因是 `tsconfig.electron.json` 的
 * `moduleResolution: "node"`（TS 经典 Node10 解析）不识别 package.json 的 `exports`
 * 字段，只认顶层 `main`/`types`，实测子路径导入会直接报
 * `Cannot find module '@henjicc/ai-sdk/runtime'`（见任务 2.1 执行记录 /
 * docs/task/模型SDK抽离/重要记录.md 记录 012）。因此 Electron 主进程代码
 * （如 `electron/main/services/ai-runtime/sdk-runtime.ts`）必须统一从包根导入，
 * 根入口需要把子路径的内容再导出一份。子路径导出（`./runtime` 等）仍然保留，
 * 供支持 `exports` 条件解析的消费方（Vite/Rollup、`moduleResolution: "bundler"`/
 * `"node16"`/`"nodenext"`）按需只导入需要的子集。
 *
 * 包名与分发渠道已在任务 6.2 确认为私有 GitHub Packages：`@henjicc/ai-sdk`。
 */
export * from './client'

export * from './runtime'

// 任务 2.2 迁入：供应商无关的纯逻辑层（协议模板、媒体字段识别、PPIO 媒体判定、
// 生成模型运行时契约类型）。同样重新导出到包根，理由与上面对 `./runtime` 的说明一致——
// `tsconfig.electron.json` 的经典 Node 解析不识别 `exports` 子路径。
export * from './protocols'
export * from './upload'
export * from './providers'
export * from './types'

// 任务 3.1 迁入：模型目录（纯函数 defineModel + 运行时校验）。同样重新导出到包根，
// 理由同上：`tsconfig.electron.json` 的经典 Node 解析不识别 `exports` 子路径。
export * from './catalog'

// 任务 4.1 迁入：LLM（openai-compatible 协议）供应商无关的纯逻辑层——协议差异、思考参数、
// 模型能力目录、供应商预设、默认值、模型步契约、共享类型。理由同上：`tsconfig.electron.json`
// 的经典 Node 解析不识别 `exports` 子路径，Electron 主进程必须能从包根拿到这些导出。
// 任务 4.2 追加：LLM 执行层——原生 SSE 流式聊天路径（`chatTypes`/`streaming`/`chat`/
// `requestContract`/`discovery`）与 Vercel AI SDK 模型步路径（`llm/sdk/`）。均已在
// `./llm/index.ts` 内部重新导出，这里不需要再单独加一行。
export * from './llm'
