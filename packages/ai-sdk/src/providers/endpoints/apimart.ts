import type { Transport } from '../../runtime/Transport'

export const APIMART_API_BASE_URLS = [
  'https://api.apimart.ai',
  'https://api.apib.ai',
  'https://api.aiuxu.com',
  'https://api.aishuch.com',
] as const

type ApiMartBaseUrl = (typeof APIMART_API_BASE_URLS)[number]

const WARMUP_TIMEOUT_MS = 4_000

// 进程内存缓存：记录"当前网络环境下已证明可达"的域名，优先排到请求顺序最前面。
// 不做地理位置判断，只认连通性；不持久化，应用重启后清空重新判断，网络环境变化能自愈。
let preferredBaseUrl: ApiMartBaseUrl | undefined

function orderedBaseUrls(): readonly ApiMartBaseUrl[] {
  if (!preferredBaseUrl || preferredBaseUrl === APIMART_API_BASE_URLS[0]) return APIMART_API_BASE_URLS
  return [preferredBaseUrl, ...APIMART_API_BASE_URLS.filter((baseUrl) => baseUrl !== preferredBaseUrl)]
}

export function buildApiMartEndpoints(route: string): string[] {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`
  return orderedBaseUrls().map((baseUrl) => `${baseUrl}${normalizedRoute}`)
}

/** 把某个成功响应过的完整 endpoint URL 记为本进程后续请求的优先域名。 */
export function markApiMartEndpointReachable(endpoint: string): void {
  const matched = APIMART_API_BASE_URLS.find((baseUrl) => endpoint.startsWith(baseUrl))
  if (matched) preferredBaseUrl = matched
}

export function resetApiMartEndpointPreference(): void {
  preferredBaseUrl = undefined
}

/**
 * 应用启动后台探测：按默认顺序找出第一个当前网络下可达的域名并预热为优先域名，
 * 让用户首次真实生成请求不必先撞一次必然失败的默认线路。不阻塞启动、探测失败静默忽略。
 */
export async function warmApiMartEndpointPreference(transport: Transport): Promise<void> {
  for (const baseUrl of APIMART_API_BASE_URLS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS)
    try {
      await transport.fetch(`${baseUrl}/v1/balance`, { method: 'GET', signal: controller.signal })
      preferredBaseUrl = baseUrl
      return
    } catch {
      continue
    } finally {
      clearTimeout(timer)
    }
  }
}
