/** UXP 可安全打包的 OpenAI 协议族；schema 留在兼容入口。 */
export type LlmApiProtocol = 'openai-compatible' | 'openai-responses'

const PROVIDER_EXTRA_AUTH_HEADERS: Readonly<Record<string, string>> = {
  mimo: 'api-key',
}

export function resolveProviderExtraAuthHeaders(
  providerId: string,
  apiKey: string
): Record<string, string> {
  const headerName = PROVIDER_EXTRA_AUTH_HEADERS[providerId.trim().toLowerCase()]
  return headerName && apiKey ? { [headerName]: apiKey } : {}
}

/**
 * 系统设定的消息角色约定。DeepSeek 把 developer 在 deepseek-v4-pro 上当作用户消息（flash 上等同 system），
 * 必须发 system；两种协议都支持对话中途插入 system 消息，系统设定变化时可追加而不改写首条，保住前缀缓存。
 * 未登记的供应商返回 undefined，沿用调用方默认。
 */
export function resolveProviderSystemMessageSupport(
  providerId: string,
  adapter?: string
): { developerRole: boolean; midConversationSystem: boolean } | undefined {
  const keys = [providerId, adapter ?? ''].map(value => value.trim().toLowerCase())
  return keys.includes('deepseek') ? { developerRole: false, midConversationSystem: true } : undefined
}

const DEEPSEEK_FLASH_MODEL_IDS = new Set(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'])
const SERVER_WEB_TOOL_TYPES = new Set(['deepseek_web_search', 'deepseek_read_url', 'web_search'])

/** 一个供应商在某协议下开联网的方式：追加服务端工具，或写一个请求体开关（百炼 Chat 的 enable_search）。 */
interface ProviderWebSearch {
  tools?: Array<Record<string, unknown>>
  body?: Record<string, unknown>
  /** Chat 下与函数工具同发时联网不生效或协议不允许混用，此时不挂。 */
  exclusiveWithTools?: boolean
}

type WebSearchRule = (model: string, protocol: LlmApiProtocol) => ProviderWebSearch | null

const RESPONSES_WEB_SEARCH: WebSearchRule = (_model, protocol) => protocol === 'openai-responses' ? { tools: [{ type: 'web_search' }] } : null

/**
 * 各供应商服务端联网搜索的官方挂法（2026-11-14 核对，见 docs/llm-adaptation/供应商/）。没有登记的供应商与协议组合不挂。
 *
 * - DeepSeek：flash 两种协议都挂 deepseek_web_search + deepseek_read_url；v4-pro 只在 Responses 挂 web_search。
 * - 百炼：Responses 挂 web_search；Chat 用 enable_search，只对 Qwen 与 DeepSeek 系（glm、kimi 在 Chat 下不支持）。
 * - 火山方舟（豆包搜索 Custom 版，需先在控制台开通）：Responses 挂 web_search + sources:["doubao"]；
 *   Chat 用 web_search_options，与自定义函数工具同发时只保留函数工具，所以有函数工具时不挂。
 * - 智谱：Responses 挂 web_search；Chat 的 web_search 工具必须指定搜索引擎且不与函数工具混用，用最便宜的 search_std。
 * - MiniMax、Kimi、OpenAI：只在 Responses 挂 web_search。
 * - MiMo（需先在控制台激活插件）：只在 Chat 挂 web_search。
 */
const WEB_SEARCH_RULES: Readonly<Record<string, WebSearchRule>> = {
  deepseek: (model, protocol) => DEEPSEEK_FLASH_MODEL_IDS.has(model)
    ? { tools: [{ type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }] }
    : model === 'deepseek-v4-pro' ? RESPONSES_WEB_SEARCH(model, protocol) : null,
  bailian: (model, protocol) => protocol === 'openai-responses'
    ? { tools: [{ type: 'web_search' }] }
    : /^(?:qwen|deepseek)/.test(model) ? { body: { enable_search: true } } : null,
  volcengine: (_model, protocol) => protocol === 'openai-responses'
    ? { tools: [{ type: 'web_search', sources: ['doubao'] }] }
    : { body: { web_search_options: {} }, exclusiveWithTools: true },
  bigmodel: (_model, protocol) => protocol === 'openai-responses'
    ? { tools: [{ type: 'web_search' }] }
    : { tools: [{ type: 'web_search', web_search: { enable: true, search_engine: 'search_std' } }], exclusiveWithTools: true },
  minimax: RESPONSES_WEB_SEARCH,
  kimi: RESPONSES_WEB_SEARCH,
  openai: RESPONSES_WEB_SEARCH,
  mimo: (_model, protocol) => protocol === 'openai-compatible' ? { tools: [{ type: 'web_search' }] } : null,
}

/** 不用额外开通、也是项目主助手模型的供应商：内置助手在这些供应商下自动联网，其余只在调用方明确要求时挂。 */
const AUTO_WEB_SEARCH_PROVIDERS = new Set(['deepseek'])

/**
 * 按供应商身份找规则；adapter 只认 deepseek（自建网关转发 DeepSeek 原厂协议）。
 * 很多预设与自定义网关的 adapter 都是 openai，不能据此推断网关支持 OpenAI 的内置搜索。
 */
function resolveWebSearchRuleKey(providerId: string, adapter: string | undefined): string | undefined {
  if (adapter?.trim().toLowerCase() === 'deepseek') return 'deepseek'
  const id = providerId.trim().toLowerCase()
  return id in WEB_SEARCH_RULES ? id : undefined
}

/**
 * 给请求挂上供应商在服务端执行的联网搜索：是否搜索、读哪些链接由模型判断，搜索与抓取都在服务端完成，
 * 客户端不执行任何工具。联网按次另计费用，计入模型调用。
 *
 * `mode: 'auto'`（内置助手）只对 AUTO_WEB_SEARCH_PROVIDERS 生效；`'requested'`（调用方明确要联网）对表里所有供应商生效。
 * 结构化输出（Responses text.format、Chat response_format 不为 text）一律不挂：DeepSeek 等会返回 400，
 * 其余供应商的同用行为官方未写明。
 */
export function appendProviderWebTools(
  providerId: string,
  adapter: string | undefined,
  body: Record<string, unknown>,
  protocol: LlmApiProtocol,
  mode: 'auto' | 'requested' = 'auto',
): Record<string, unknown> {
  const key = resolveWebSearchRuleKey(providerId, adapter)
  if (!key || (mode === 'auto' && !AUTO_WEB_SEARCH_PROVIDERS.has(key))) return body
  const model = typeof body.model === 'string' ? body.model.trim().toLowerCase() : ''
  const rule = WEB_SEARCH_RULES[key](model, protocol)
  if (!rule) return body
  const format = protocol === 'openai-responses'
    ? (body.text as { format?: { type?: unknown } } | undefined)?.format?.type
    : (body.response_format as { type?: unknown } | undefined)?.type
  if (format !== undefined && format !== 'text') return body
  const existing = Array.isArray(body.tools) ? body.tools : []
  if (rule.exclusiveWithTools && existing.length > 0) return body
  if (existing.some(tool => tool && typeof tool === 'object' && SERVER_WEB_TOOL_TYPES.has(String((tool as Record<string, unknown>).type)))) return body
  const withSearch = { ...body, ...rule.body, ...(rule.tools ? { tools: [...existing, ...rule.tools] } : {}) }
  return key === 'deepseek' && rule.tools && protocol === 'openai-responses' && Array.isArray(body.input)
    ? { ...withSearch, input: moveToolOutputImagesToUserMessages(body.input) }
    : withSearch
}

const TOOL_OUTPUT_ITEM_TYPES = new Set(['function_call_output', 'custom_tool_call_output'])

/**
 * DeepSeek Responses 在声明了服务端联网工具时，工具结果只收文字（带图返回 400：only text is supported in
 * `function_call_output` with `deepseek_web_search`…）。图片挪到紧随这一组工具结果之后的一条 user 消息里，
 * 与工具消息只能是文字的 Chat 协议下的通行写法一致：模型仍然看得到图，联网工具也不用摘掉。
 * 只能用 user：同样条件下 system 与 developer 消息带图也返回 400。代价是 deepseek_read_url 只读最后一条
 * 用户消息里的链接，这条消息之后的轮次读不到用户原话里的链接。
 */
function moveToolOutputImagesToUserMessages(input: readonly unknown[]): unknown[] {
  const result: unknown[] = []
  let pendingImages: unknown[] = []
  const flush = (): void => {
    if (!pendingImages.length) return
    result.push({ role: 'user', content: [{ type: 'input_text', text: '以上工具结果附带的图片：' }, ...pendingImages] })
    pendingImages = []
  }
  for (const item of input) {
    const output = item && typeof item === 'object' ? item as Record<string, unknown> : null
    if (!output || !TOOL_OUTPUT_ITEM_TYPES.has(String(output.type))) {
      flush()
      result.push(item)
      continue
    }
    if (!Array.isArray(output.output)) { result.push(item); continue }
    const parts = output.output as Record<string, unknown>[]
    const images = parts.filter(part => part?.type === 'input_image')
    if (!images.length) { result.push(item); continue }
    const text = parts.filter(part => part?.type === 'input_text' && typeof part.text === 'string').map(part => part.text as string).join('\n')
    result.push({ ...output, output: text ? `${text}\n（图片见随后的用户消息）` : '（图片见随后的用户消息）' })
    pendingImages.push(...images)
  }
  flush()
  return result
}

/**
 * 开思考后 temperature / top_p 不生效的供应商：此时不发采样参数，与模型步规则一致。
 * MiMo 开思考时传采样会 400，由思考规则统一删除（它省略思考字段时也默认开思考）。
 */
const SAMPLING_IGNORED_WHEN_THINKING = new Set(['deepseek'])

export interface LlmSamplingInput {
  providerFamilyId: string
  adapter?: string
  temperature?: number
  topP?: number
  samplingCapable: boolean
  thinkingEnabled: boolean
}

/**
 * 解析要发送的采样参数（键名两种协议相同）。模型声明为固定采样值、或该供应商开思考时采样无效，
 * 一律省略；越界值直接拒绝，不替调用方截断。
 */
export function resolveSamplingFields(input: LlmSamplingInput): { temperature?: number; top_p?: number } {
  if (input.temperature !== undefined && !(Number.isFinite(input.temperature) && input.temperature >= 0 && input.temperature <= 2)) {
    throw Object.assign(new Error('temperature must be between 0 and 2'), { code: 'INVALID_SAMPLING', statusCode: 400 })
  }
  if (input.topP !== undefined && !(Number.isFinite(input.topP) && input.topP >= 0 && input.topP <= 1)) {
    throw Object.assign(new Error('topP must be between 0 and 1'), { code: 'INVALID_SAMPLING', statusCode: 400 })
  }
  if (!input.samplingCapable) return {}
  const keys = [input.providerFamilyId, input.adapter ?? ''].map(value => value.trim().toLowerCase())
  if (input.thinkingEnabled && keys.some(key => SAMPLING_IGNORED_WHEN_THINKING.has(key))) return {}
  return {
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.topP !== undefined ? { top_p: input.topP } : {}),
  }
}

export function applyProviderRequestBodyQuirks(
  providerId: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  const normalizedProviderId = providerId.trim().toLowerCase()
  if (normalizedProviderId === 'mimo' || normalizedProviderId === 'openai') {
    return renameMaxCompletionTokens(body)
  }
  if (normalizedProviderId !== 'groq') return body

  const withTokenLimit = renameMaxCompletionTokens(body)
  if (!Array.isArray(withTokenLimit.messages)) return withTokenLimit
  return {
    ...withTokenLimit,
    // Groq 的 OpenAI 兼容接口明确不支持 messages[].name；在唯一协议边界剔除，
    // 避免流式路径与 Vercel AI SDK 模型步各复制一份供应商判断。
    messages: withTokenLimit.messages.map(stripMessageName),
  }
}

function renameMaxCompletionTokens(body: Record<string, unknown>): Record<string, unknown> {
  if (!('max_tokens' in body)) return body
  const { max_tokens: maxTokens, ...rest } = body
  return { ...rest, max_completion_tokens: maxTokens }
}

function stripMessageName(message: unknown): unknown {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return message
  const { name: _unsupportedName, ...rest } = message as Record<string, unknown>
  return rest
}
