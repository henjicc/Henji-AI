import { AiRuntimeError } from '../../runtime/AiRuntimeError'

export const DEEPSEEK_TOOLS_API_BASE = 'https://api.deepseek.com'

/** DeepSeek 独立工具接口（/v1/tools/*）与文件接口共用的根地址解析。 */
export function deepSeekApiRoot(value: string | undefined): string {
  const normalized = (value?.trim() || DEEPSEEK_TOOLS_API_BASE).replace(/\/+$/, '').replace(/\/v1$/, '')
  let parsed: URL
  try { parsed = new URL(normalized) } catch {
    throw new AiRuntimeError('invalid_endpoint', `DeepSeek endpoint is invalid: ${normalized}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AiRuntimeError('invalid_endpoint', 'DeepSeek endpoint must use HTTP(S)')
  }
  return normalized
}

export function deepSeekToolsEndpoint(baseUrl: string | undefined, tool: 'asr' | 'tts' | 'ocr' | 'search' | 'fetch'): string {
  return `${deepSeekApiRoot(baseUrl)}/v1/tools/${tool}`
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** 这些状态码官方说明重试也不会好转或需要用户先处理，提示里直接给出下一步。 */
const STATUS_HINTS: Readonly<Record<number, string>> = {
  401: 'API 密钥缺失或无效，请检查 DeepSeek 密钥',
  402: '账号余额不足，请先充值',
  413: '文件超过大小上限',
  429: '超过账号并发或频率上限，请稍后重试',
}

/**
 * 解析工具接口响应。错误体是 OpenAI 兼容格式；OCR 识别开始后状态码已是 200，失败时响应体仍是 error 对象，
 * 所以 200 也要检查 error。识别等待期间服务端发送换行保活，属于 JSON 前导空白，直接解析即可。
 */
export async function readDeepSeekToolJson(response: Response, action: string): Promise<Record<string, unknown>> {
  const body = await response.text()
  let payload: unknown
  try { payload = JSON.parse(body) } catch {
    const detail = body.trim().slice(0, 300)
    throw new AiRuntimeError(response.ok ? 'invalid_response' : 'provider_http_error',
      `DeepSeek ${action}${response.ok ? '返回的不是 JSON' : `失败（HTTP ${response.status}）`}${detail ? `：${detail}` : ''}`)
  }
  const root = record(payload)
  const error = record(root?.error)
  if (!response.ok || error) {
    const message = typeof error?.message === 'string' ? error.message.trim().slice(0, 300) : ''
    const hint = STATUS_HINTS[response.status]
    throw new AiRuntimeError('provider_http_error', `DeepSeek ${action}失败（HTTP ${response.status}）${hint ? `：${hint}` : ''}${message ? `。服务端说明：${message}` : ''}`)
  }
  if (!root) throw new AiRuntimeError('invalid_response', `DeepSeek ${action}返回的不是对象`)
  return root
}
