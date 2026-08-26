import type { LlmModelCatalogEntry } from './modelCatalog'

/**
 * 内置大语言模型能力目录（数据）。
 *
 * 每条都对应 `docs/llm-adaptation/供应商/*.md` 里核对过的官方文档，`docs` 字段指向该文档。
 * **只登记文档明确写出的能力**：文档没写的一律保持保守取值（false / null），由用户手工勾选或
 * 走「验证此模型」动态探测补齐，不靠模型名猜。
 *
 * `input` 记录的是**在本项目当前请求路径下真实可用**的输入模态，不是模型宣传的模态：
 * 画布文本处理与提示词优化走原生流式路径（`streaming.ts`，image/video/audio 三种内容块都能发），
 * 智能助手走 AI SDK 模型步骤（`provider.ts`，当前只能表达 image/audio）。某个模态只在项目尚未
 * 实现的协议（Responses API / Anthropic Messages）下可用时，一律记为 false 并在 `note` 里写明原因，
 * 否则用户会得到"勾了但发过去没反应"的静默失效。
 */
export const LLM_MODEL_CATALOG_ENTRIES: readonly LlmModelCatalogEntry[] = [
  // ---------------- DeepSeek ----------------
  {
    id: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    vendor: 'DeepSeek',
    input: { image: false, video: false, audio: false },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    note: '思考模式下 temperature / top_p 传了也不生效。',
    docs: 'docs/llm-adaptation/供应商/DeepSeek.md',
  },
  {
    id: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    vendor: 'DeepSeek',
    input: { image: false, video: false, audio: false },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    docs: 'docs/llm-adaptation/供应商/DeepSeek.md',
  },
  {
    id: 'deepseek-v4-flash-vision-exp',
    displayName: 'DeepSeek V4 Flash Vision (实验)',
    vendor: 'DeepSeek',
    // 官方文档：图片只能通过 Responses API 的 input_image 内容块发送，本项目还没有该协议适配器；
    // 走 Chat Completions 发图不会报错，而是被替换成占位文本，属于静默失效，因此这里记为不支持。
    input: { image: false, video: false, audio: false },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    note: '模型本身支持图片输入，但官方只开放在 Responses API 上；本项目当前只有 Chat Completions 协议，发图会被静默替换成占位文本，所以未勾选图片输入。',
    docs: 'docs/llm-adaptation/供应商/DeepSeek.md',
  },

  // ---------------- Kimi（Moonshot） ----------------
  {
    id: 'kimi-k3',
    displayName: 'Kimi K3',
    vendor: 'Moonshot',
    input: { image: true, video: true, audio: false },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'schema',
    reasoning: true,
    // 官方文档把 temperature / top_p 等列为固定值并明确"建议不要显式传入"，
    // sampling=false 会让模型步骤不再下发这两个参数。
    sampling: false,
    contextWindow: 1_048_576,
    maxOutputTokens: 131_072,
    note: '思考模式始终开启无法关闭；图片必须用 base64 data URL，不接受公网直链；视频要先经 Files API 上传再用 ms://<file-id> 引用。',
    docs: 'docs/llm-adaptation/供应商/Kimi.md',
  },
  {
    id: 'kimi-k2.6',
    displayName: 'Kimi K2.6',
    vendor: 'Moonshot',
    input: { image: true, video: true, audio: false },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    contextWindow: null,
    maxOutputTokens: null,
    note: '沿用项目既有内置配置的模态标注，未逐项核对官方文档；上下文与输出上限留空由动态验证或用户补齐。',
    docs: 'docs/llm-adaptation/供应商/Kimi.md',
  },

  // ---------------- 智谱 GLM ----------------
  {
    id: 'glm-5.3',
    displayName: 'GLM-5.3',
    vendor: '智谱',
    // 官方模型页原文："目前仅支持处理文本模态"。视觉场景要换 glm-5v-turbo。
    input: { image: false, video: false, audio: false },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    note: '始终开启思考且无法关闭；官方明确只支持文本模态，需要看图看视频请改用 GLM-5V-Turbo。',
    docs: 'docs/llm-adaptation/供应商/智谱GLM.md',
  },
  {
    id: 'glm-5v-turbo',
    displayName: 'GLM-5V-Turbo',
    vendor: '智谱',
    input: { image: true, video: true, audio: false },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    note: '官方明确不支持在一次请求里同时理解文件、视频和图像，一次只能带其中一种。',
    docs: 'docs/llm-adaptation/供应商/智谱GLM.md',
  },

  // ---------------- 火山引擎（豆包 / Ark） ----------------
  {
    id: 'doubao-seed-evolving',
    displayName: 'Doubao-Seed-Evolving',
    vendor: '火山引擎',
    input: { image: true, video: true, audio: false },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    contextWindow: 1_048_576,
    maxOutputTokens: 262_144,
    note: 'Model ID 固定、版本自动滚动；联网搜索等内置工具只在 Responses API 可用，本项目当前协议下拿不到。',
    docs: 'docs/llm-adaptation/供应商/火山引擎.md',
  },
  {
    id: 'doubao-seed-2-1-pro',
    displayName: 'Doubao-Seed-2.1-Pro',
    vendor: '火山引擎',
    input: { image: true, video: true, audio: false },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    contextWindow: 262_144,
    maxOutputTokens: 262_144,
    docs: 'docs/llm-adaptation/供应商/火山引擎.md',
  },
  {
    id: 'doubao-seed-2-1-turbo',
    displayName: 'Doubao-Seed-2.1-Turbo',
    vendor: '火山引擎',
    input: { image: true, video: true, audio: false },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    contextWindow: 262_144,
    maxOutputTokens: 262_144,
    docs: 'docs/llm-adaptation/供应商/火山引擎.md',
  },

  // ---------------- 小米 MiMo ----------------
  {
    id: 'mimo-v2.5-pro',
    displayName: 'MiMo-V2.5-Pro',
    vendor: '小米',
    input: { image: false, video: false, audio: false },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
    note: '多轮工具调用时官方建议把历史轮次的 reasoning_content 一并回传。',
    docs: 'docs/llm-adaptation/供应商/小米MiMo.md',
  },
  {
    id: 'mimo-v2.5',
    displayName: 'MiMo-V2.5',
    vendor: '小米',
    input: { image: true, video: true, audio: true },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
    note: '官方标注全模态理解，图片 / 音频 / 视频均可作为输入。',
    docs: 'docs/llm-adaptation/供应商/小米MiMo.md',
  },

  // ---------------- 阿里云百炼 Qwen ----------------
  {
    id: 'qwen3.8-max',
    displayName: 'Qwen3.8-Max',
    vendor: '阿里云百炼',
    aliases: ['qwen3.8-max-prime'],
    input: { image: true, video: true, audio: false },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    // 官方文档只写"超长文档与长视频"，没有给出可引用的上下文 token 数，留空走回退预算。
    contextWindow: null,
    maxOutputTokens: null,
    note: '必须走多模态接口：即使是纯文字对话，content 也要写成内容块数组，直接传字符串会报 url error。',
    docs: 'docs/llm-adaptation/供应商/百炼Qwen.md',
  },

  // ---------------- MiniMax ----------------
  {
    id: 'minimax-m3',
    displayName: 'MiniMax-M3',
    vendor: 'MiniMax',
    input: { image: true, video: true, audio: false },
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json',
    reasoning: true,
    sampling: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
    note: '原生 thinking 块只在 Anthropic Messages 协议下可见，本项目走 Chat Completions 时拿到的是扁平的 reasoning_content。',
    docs: 'docs/llm-adaptation/供应商/MiniMax.md',
  },
]
