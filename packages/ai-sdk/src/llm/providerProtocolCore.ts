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

/**
 * 给请求挂上供应商在服务端执行的联网工具：是否搜索、读哪些链接由模型判断，搜索与抓取都在服务端完成，
 * 客户端不执行任何工具。只有调用方明确要联网时才调用，普通文本处理不自动联网。
 *
 * DeepSeek：deepseek-flash 在 Chat 与 Responses 下都支持 deepseek_web_search（关思考为联网搜索，开思考为
 * 深度思考搜索）与 deepseek_read_url（阅读用户消息里的链接）；deepseek-v4-pro 只在 Responses 下支持 web_search。
 * 结构化输出（Responses text.format、Chat response_format 不为 text）与这些工具同用会返回 400，此时不挂。
 * 搜索与抓取各按 5 元/千次成功调用计费，计入模型调用费用。见 docs/llm-adaptation/供应商/DeepSeek.md。
 */
export function appendProviderWebTools(
  providerId: string,
  adapter: string | undefined,
  body: Record<string, unknown>,
  protocol: LlmApiProtocol,
): Record<string, unknown> {
  if (![providerId, adapter ?? ''].some(value => value.trim().toLowerCase() === 'deepseek')) return body
  const model = typeof body.model === 'string' ? body.model.trim().toLowerCase() : ''
  const tools = DEEPSEEK_FLASH_MODEL_IDS.has(model)
    ? [{ type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }]
    : model === 'deepseek-v4-pro' && protocol === 'openai-responses' ? [{ type: 'web_search' }] : []
  if (!tools.length) return body
  const format = protocol === 'openai-responses'
    ? (body.text as { format?: { type?: unknown } } | undefined)?.format?.type
    : (body.response_format as { type?: unknown } | undefined)?.type
  if (format !== undefined && format !== 'text') return body
  const existing = Array.isArray(body.tools) ? body.tools : []
  if (existing.some(tool => tool && typeof tool === 'object' && SERVER_WEB_TOOL_TYPES.has(String((tool as Record<string, unknown>).type)))) return body
  const withTools = { ...body, tools: [...existing, ...tools] }
  return protocol === 'openai-responses' && Array.isArray(body.input)
    ? { ...withTools, input: moveToolOutputImagesToUserMessages(body.input) }
    : withTools
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
