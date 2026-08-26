import { getAiProviderApiKey } from '../keystore'
import { createMainLogger } from '../logging'
import { buildApiMartEndpoints, markApiMartEndpointReachable } from './apimart-endpoints'
import { fetchProvider } from './providers/provider-fetch'
import type {
  ProviderConnectionStatus,
  ProviderConnectionTestResultDto,
} from './types'

const logger = createMainLogger('ai-runtime.provider_connection')
const CONNECTION_TIMEOUT_MS = 12_000

interface ProviderProbe {
  // 惰性求值：APIMart 的顺序会随连通性缓存变化，不能在模块加载时就固定下来。
  endpoints: () => readonly string[]
  authorizationPrefix: 'Bearer'
  kind: 'kie_balance' | 'apimart_balance' | 'model_catalog'
}

// Grsai 暂未加入探测表：其余额接口 `POST /client/openapi/getAPIKeyCredits` 用 POST（这里统一是 GET），
// 且鉴权走 Authorization Bearer 还是账户 token 字段官方文档没写清楚，接入前需登录控制台核实，
// 详见 docs/model-adaptation/供应商/Grsai.md §5.2。宁可保持"已保存未校验"，也不要拿一个不确定的契约去误判用户 Key 状态。
const PROVIDER_PROBES: Readonly<Record<string, ProviderProbe>> = {
  kie: {
    endpoints: () => ['https://api.kie.ai/api/v1/chat/credit'],
    authorizationPrefix: 'Bearer',
    kind: 'kie_balance',
  },
  apimart: {
    endpoints: () => buildApiMartEndpoints('/v1/balance'),
    authorizationPrefix: 'Bearer',
    kind: 'apimart_balance',
  },
  ppio: {
    endpoints: () => ['https://api.ppio.com/openai/v1/models'],
    authorizationPrefix: 'Bearer',
    kind: 'model_catalog',
  },
}

function result(
  providerId: string,
  startedAt: number,
  status: ProviderConnectionStatus,
  extra: Partial<ProviderConnectionTestResultDto> = {}
): ProviderConnectionTestResultDto {
  return {
    providerId,
    status,
    verified: status === 'connected' || status === 'insufficient_balance' || status === 'rate_limited',
    checkedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - startedAt),
    ...extra,
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function numberField(value: Record<string, unknown> | null, key: string): number | undefined {
  const field = value?.[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined
}

function stringField(value: Record<string, unknown> | null, key: string): string {
  const field = value?.[key]
  return typeof field === 'string' ? field.trim().toLowerCase() : ''
}

async function readResponsePayload(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return record(await response.json())
  } catch {
    return null
  }
}

function classifyHttpStatus(status: number): ProviderConnectionStatus | null {
  if (status === 401 || status === 403) return 'invalid_key'
  if (status === 402) return 'insufficient_balance'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'service_error'
  return null
}

function classifyKie(
  providerId: string,
  startedAt: number,
  response: Response,
  payload: Record<string, unknown> | null
): ProviderConnectionTestResultDto {
  const payloadCode = numberField(payload, 'code')
  const status = payloadCode ? classifyHttpStatus(payloadCode) : classifyHttpStatus(response.status)
  if (status) return result(providerId, startedAt, status, { httpStatus: response.status })
  if (response.ok && payloadCode === 200) {
    return result(providerId, startedAt, 'connected', {
      httpStatus: response.status,
      remainingBalance: numberField(payload, 'data'),
      balanceUnit: 'credits',
    })
  }
  return result(providerId, startedAt, 'service_error', { httpStatus: response.status })
}

function classifyApiMart(
  providerId: string,
  startedAt: number,
  response: Response,
  payload: Record<string, unknown> | null
): ProviderConnectionTestResultDto {
  const httpStatus = classifyHttpStatus(response.status)
  if (httpStatus) return result(providerId, startedAt, httpStatus, { httpStatus: response.status })
  if (response.ok && payload?.success === true) {
    return result(providerId, startedAt, 'connected', {
      httpStatus: response.status,
      remainingBalance: numberField(payload, 'remain_balance'),
      balanceUnit: 'provider_units',
      unlimitedBalance: payload.unlimited_quota === true,
    })
  }
  const message = stringField(payload, 'message')
  if (response.ok && (message.includes('token') || message.includes('auth'))) {
    return result(providerId, startedAt, 'invalid_key', { httpStatus: response.status })
  }
  return result(providerId, startedAt, 'service_error', { httpStatus: response.status })
}

function classifyCatalog(
  providerId: string,
  startedAt: number,
  response: Response
): ProviderConnectionTestResultDto {
  const status = classifyHttpStatus(response.status)
  if (status) return result(providerId, startedAt, status, { httpStatus: response.status })
  return result(providerId, startedAt, response.ok ? 'connected' : 'service_error', {
    httpStatus: response.status,
  })
}

export async function testProviderConnection(
  providerId: string
): Promise<ProviderConnectionTestResultDto> {
  const startedAt = Date.now()
  const apiKey = getAiProviderApiKey(providerId)
  if (!apiKey) return result(providerId, startedAt, 'not_configured')

  const probe = PROVIDER_PROBES[providerId]
  if (!probe) return result(providerId, startedAt, 'saved_unverified')

  logger.info('供应商连接检测开始', {
    event: 'provider_connection.test.start',
    providerId,
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS)
  try {
    const [endpoint, ...fallbackEndpoints] = probe.endpoints()
    const response = await fetchProvider(providerId, endpoint, {
      method: 'GET',
      headers: {
        Authorization: `${probe.authorizationPrefix} ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    }, {
      retryPreconnectOnce: true,
      fallbackEndpoints,
      onEndpointReached: probe.kind === 'apimart_balance' ? markApiMartEndpointReachable : undefined,
    })
    const payload = probe.kind === 'model_catalog' ? null : await readResponsePayload(response)
    const tested = probe.kind === 'kie_balance'
      ? classifyKie(providerId, startedAt, response, payload)
      : probe.kind === 'apimart_balance'
        ? classifyApiMart(providerId, startedAt, response, payload)
        : classifyCatalog(providerId, startedAt, response)
    logger.info('供应商连接检测完成', {
      event: 'provider_connection.test.completed',
      providerId,
      context: {
        status: tested.status,
        verified: tested.verified,
        httpStatus: tested.httpStatus,
        durationMs: tested.durationMs,
      },
    })
    return tested
  } catch (error) {
    const status = controller.signal.aborted ? 'timeout' : 'network_error'
    const tested = result(providerId, startedAt, status)
    logger.warn('供应商连接检测失败', {
      event: 'provider_connection.test.failed',
      providerId,
      context: { status, durationMs: tested.durationMs },
      error,
    })
    return tested
  } finally {
    clearTimeout(timer)
  }
}
