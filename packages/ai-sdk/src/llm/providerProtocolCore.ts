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
