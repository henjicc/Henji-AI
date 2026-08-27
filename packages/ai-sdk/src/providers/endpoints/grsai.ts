import type { Transport } from '../../runtime/Transport'

export const GRSAI_API_BASE_URLS = [
  'https://grsaiapi.com',
  'https://grsai.dakka.com.cn',
] as const

type GrsaiBaseUrl = (typeof GRSAI_API_BASE_URLS)[number]

const WARMUP_TIMEOUT_MS = 4_000

// 进程内存缓存：记录"当前网络环境下已证明可达"的域名，优先排到请求顺序最前面。
// 不做地理位置判断，只认连通性；不持久化，应用重启后清空重新判断，网络环境变化能自愈。
// 两条线路（全球节点 / 国内直连节点）的账号与任务数据关系官方文档未说明，按 APIMart 同款策略处理：
// 只在能证明尚未建立连接时切换，不对已建立连接的失败重放计费请求。
let preferredBaseUrl: GrsaiBaseUrl | undefined

function orderedBaseUrls(): readonly GrsaiBaseUrl[] {
  if (!preferredBaseUrl || preferredBaseUrl === GRSAI_API_BASE_URLS[0]) return GRSAI_API_BASE_URLS
  return [preferredBaseUrl, ...GRSAI_API_BASE_URLS.filter((baseUrl) => baseUrl !== preferredBaseUrl)]
}

export function buildGrsaiEndpoints(route: string): string[] {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`
  return orderedBaseUrls().map((baseUrl) => `${baseUrl}${normalizedRoute}`)
}

/** 把某个成功响应过的完整 endpoint URL 记为本进程后续请求的优先域名。 */
export function markGrsaiEndpointReachable(endpoint: string): void {
  const matched = GRSAI_API_BASE_URLS.find((baseUrl) => endpoint.startsWith(baseUrl))
  if (matched) preferredBaseUrl = matched
}

export function resetGrsaiEndpointPreference(): void {
  preferredBaseUrl = undefined
}

/**
 * 应用启动后台探测：按默认顺序找出第一个当前网络下可达的域名并预热为优先域名，
 * 让用户首次真实生成请求不必先撞一次必然失败的默认线路。不阻塞启动、探测失败静默忽略。
 */
export async function warmGrsaiEndpointPreference(transport: Transport): Promise<void> {
  for (const baseUrl of GRSAI_API_BASE_URLS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS)
    try {
      // 只探测连通性，不关心响应内容：未带 id 查询大概率返回 400，但只要网络层能连上就够了。
      await transport.fetch(`${baseUrl}/v1/api/result`, { method: 'GET', signal: controller.signal })
      preferredBaseUrl = baseUrl
      return
    } catch {
      continue
    } finally {
      clearTimeout(timer)
    }
  }
}
