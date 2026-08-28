import { z } from 'zod'
export {
  applyProviderRequestBodyQuirks,
  resolveProviderExtraAuthHeaders,
} from './providerProtocolCore'
export type { LlmApiProtocol } from './providerProtocolCore'

export const llmApiProtocolSchema = z.enum(['openai-compatible', 'openai-responses'])

/**
 * 供应商在 OpenAI 协议之上的认证差异，按 providerId 声明。
 *
 * 这里放的是**协议层差异**，不是模型行为差异：请求怎么发才能被对方接受。助手的判断逻辑
 * 一律不许按模型分支，但"这家网关认哪个认证头"没有通用答案，只能如实记下来。
 *
 * mimo（小米）：官方文档的认证头是 `api-key`，而通用实现只发 `Authorization: Bearer`。
 * 两个头同时发是安全的——网关只读它认识的那个——所以这里补发而不是替换，既不依赖对方是否
 * 兼容 Bearer，也不影响其他供应商。
 * 见 https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call
 *
 * 三条发请求的路径（SDK 模型步、原生流式、模型发现）必须共用这一份，否则改了一处漏两处。
 */

/**
 * 供应商对请求体字段的自有要求，按 providerId 声明。
 *
 * mimo：官方文档用 `max_completion_tokens`，而通用 OpenAI 兼容实现发的是 `max_tokens`。
 * 实测发 `max_tokens` 时六项能力探测全部 400 `Invalid request parameters`——**包括最基础的
 * text**，所以不是能力不支持，是请求根本不被接受。
 *
 * 这里改名而不是两个都发：`max_tokens` 既然被判为非法参数，留着它就还是 400。
 */
