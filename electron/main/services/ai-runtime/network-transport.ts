import { AsyncLocalStorage } from 'node:async_hooks'
import { lookup } from 'node:dns/promises'
import { session } from 'electron'
import type { JsonValue, Transport } from '@henjicc/ai-sdk'
import { createMainLogger, sanitizeJsonValue } from '../logging'

export interface NetworkRequestScope {
  requestId: string
  modelId: string
  taskId?: string
  phase?: 'poll'
  providerId?: string
  lastRequest?: { route: string; method: string }
  lastResponse?: JsonValue
}
export const networkRequestContext = new AsyncLocalStorage<NetworkRequestScope>()
const logger = createMainLogger('ai-runtime.network')

/** KIE param/input 可能是多层 JSON 字符串，先展开再交给唯一脱敏器；不记录无法解析的回显。 */
function decodeResponseForLog(value: JsonValue, depth = 0): JsonValue {
  if (depth >= 12) return '[depth-limited]'
  if (Array.isArray(value)) return value.map(item => decodeResponseForLog(item, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /cookie/i.test(key) ? '***' : decodeResponseForLog(item, depth + 1)]))
  if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
    try { return decodeResponseForLog(JSON.parse(value) as JsonValue, depth + 1) }
    catch { return '[unparseable-json-echo]' }
  }
  return value
}

async function inspectNetwork(host: string) {
  // 失败后的 DNS 查询仅是诊断快照，不能冒充失败连接实际采用的 IP。
  const [dns, proxy] = await Promise.allSettled([
    lookup(host, { all: true }), session.defaultSession.resolveProxy(`https://${host}`),
  ])
  return {
    dnsSnapshot: dns.status === 'fulfilled' ? dns.value.map(value => ({ address: value.address, family: value.family })) : [],
    systemProxyMode: proxy.status === 'fulfilled' ? (proxy.value === 'DIRECT' ? 'direct' : 'configured') : 'unknown',
    transport: 'node-fetch',
    nodeEnvProxyEnabled: process.env.NODE_USE_ENV_PROXY === '1' || process.execArgv.includes('--use-env-proxy'),
    proxyEnvironmentPresent: Boolean(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy),
  }
}

function failureCode(error: unknown): { code: string; phase: string } {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const cause = record.cause && typeof record.cause === 'object' ? record.cause as Record<string, unknown> : record
  const code = typeof cause.code === 'string' ? cause.code : 'UNKNOWN'
  return { code, phase: cause.message === 'Client network socket disconnected before secure TLS connection was established'
    ? 'before_tls' : ['ENOTFOUND', 'EAI_AGAIN'].includes(code) ? 'dns' : 'unknown' }
}

export function createDiagnosticTransport(fetchRequest: Transport['fetch'], inspect = inspectNetwork): Transport {
  return { fetch: async (url, init) => {
    const context = { host: new URL(url).hostname, method: (init?.method ?? 'GET').toUpperCase() }
    const scope = networkRequestContext.getStore()
    // 不从模型的创建端点推测轮询路径，记录 transport 真正发送的地址（剔除查询与凭据）。
    const endpoint = new URL(url)
    const route = `${endpoint.origin}${endpoint.pathname}`
    if (scope?.phase === 'poll') {
      scope.lastRequest = { route, method: context.method }
      scope.lastResponse = undefined
      logger.debug('后端发起轮询请求', { requestId: scope.requestId, modelId: scope.modelId, taskId: scope.taskId, providerId: scope.providerId,
        event: 'generation.runtime.request_json', context: { phase: 'poll', route, method: context.method } })
    }
    const startedAt = Date.now()
    const identity = scope ? { requestId: scope.requestId, modelId: scope.modelId, taskId: scope.taskId } : {}
    logger.debug('网络请求开始', { ...identity, event: 'generation.network.start', context })
    try {
      const response = await fetchRequest(url, init)
      if (scope?.phase === 'poll' && /json/i.test(response.headers.get('content-type') ?? '')) {
        try { scope.lastResponse = sanitizeJsonValue(decodeResponseForLog(await response.clone().json() as JsonValue)) }
        catch { /* 诊断不能改变供应商响应；原 JSON 错误由 SDK 处理。 */ }
      }
      logger.debug('网络请求收到响应', { ...identity, event: 'generation.network.completed',
        context: { ...context, status: response.status, durationMs: Date.now() - startedAt } })
      return response
    } catch (error) {
      if (!init?.signal?.aborted) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const diagnostic = await Promise.race([
          Promise.resolve().then(() => inspect(context.host)).catch(() => ({ diagnostic: 'unavailable' })),
          new Promise<{ diagnostic: string }>(resolve => { timer = setTimeout(() => resolve({ diagnostic: 'timeout' }), 500) }),
        ]).finally(() => { if (timer) clearTimeout(timer) })
        logger.warn('网络连接失败', { ...identity, event: 'generation.network.failed',
          context: { ...context, ...failureCode(error), durationMs: Date.now() - startedAt, ...diagnostic } })
      }
      // 保留原始 cause，不改变 SDK 对“是否已发送”的判断；诊断失败不得掩盖网络错误。
      throw error
    }
  } }
}
