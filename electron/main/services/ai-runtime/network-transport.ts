import { AsyncLocalStorage } from 'node:async_hooks'
import { lookup } from 'node:dns/promises'
import { session } from 'electron'
import type { Transport } from '@henjicc/ai-sdk'
import { createMainLogger } from '../logging'

export const networkRequestContext = new AsyncLocalStorage<{ requestId: string; modelId: string }>()
const logger = createMainLogger('ai-runtime.network')

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
    const startedAt = Date.now()
    logger.debug('网络请求开始', { ...scope, event: 'generation.network.start', context })
    try {
      const response = await fetchRequest(url, init)
      logger.debug('网络请求收到响应', { ...scope, event: 'generation.network.completed',
        context: { ...context, status: response.status, durationMs: Date.now() - startedAt } })
      return response
    } catch (error) {
      if (!init?.signal?.aborted) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const diagnostic = await Promise.race([
          Promise.resolve().then(() => inspect(context.host)).catch(() => ({ diagnostic: 'unavailable' })),
          new Promise<{ diagnostic: string }>(resolve => { timer = setTimeout(() => resolve({ diagnostic: 'timeout' }), 500) }),
        ]).finally(() => { if (timer) clearTimeout(timer) })
        logger.warn('网络连接失败', { ...scope, event: 'generation.network.failed',
          context: { ...context, ...failureCode(error), durationMs: Date.now() - startedAt, ...diagnostic } })
      }
      // 保留原始 cause，不改变 SDK 对“是否已发送”的判断；诊断失败不得掩盖网络错误。
      throw error
    }
  } }
}
