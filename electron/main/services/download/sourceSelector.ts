/*
 * 下载源自动选择（任务 4.11，通用模块）：同一份文件在国内镜像（ModelScope）与国外官方源
 * （Hugging Face / GitHub）都有时，决定先试哪一边。
 *
 * - 自动：同时向两边各发一个很小的探测请求（HEAD，几秒超时），先返回的胜出并在本次运行内记住；
 *   胜出方后来下载失败就忘掉结果，下次重新探测。两边都探测失败时按“国内优先”。
 * - 指定国内或国外：指定的一边排在前面，另一边仍作为失败后的备用，不让下载因为选错源而直接失败。
 *
 * 只认连通性，不做地理位置判断；不持久化探测结果，网络环境变化后重启即可自愈。
 * SDK 里 APIMart 的端点预热是按顺序逐个尝试、服务于单个供应商，这里是两区竞速，两者不共用实现。
 */

export type DownloadRegion = 'domestic' | 'global'
export type DownloadSourcePreference = 'auto' | DownloadRegion

export const DOWNLOAD_REGIONS: readonly DownloadRegion[] = ['domestic', 'global']

export type ProbeFetch = (url: string, init: { method: 'HEAD'; signal: AbortSignal; redirect: 'manual' }) => Promise<unknown>

export interface DownloadSourceSelectorOptions {
  /** 每个区域一个小探测地址（任何 HTTP 响应都算可达）。 */
  probes: Readonly<Record<DownloadRegion, string>>
  fetch: ProbeFetch
  timeoutMs?: number
  /** 自动探测结果的有效期；过期后重新探测。 */
  rememberMs?: number
  now?: () => number
  onProbe?: (result: { winner: DownloadRegion | null; durationMs: number }) => void
}

export interface DownloadSourceSelector {
  /** 按偏好给出尝试顺序（总是包含全部区域）。 */
  order(preference: DownloadSourcePreference): Promise<DownloadRegion[]>
  /** 某个区域下载失败：如果它是记住的胜出方，忘掉，下次重新探测。 */
  reportFailure(region: DownloadRegion): void
  /** 当前记住的自动探测结果（测试与日志用）。 */
  remembered(): DownloadRegion | null
}

const DEFAULT_TIMEOUT_MS = 4_000
const DEFAULT_REMEMBER_MS = 30 * 60_000

function otherRegion(region: DownloadRegion): DownloadRegion {
  return region === 'domestic' ? 'global' : 'domestic'
}

export function createDownloadSourceSelector(options: DownloadSourceSelectorOptions): DownloadSourceSelector {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const rememberMs = options.rememberMs ?? DEFAULT_REMEMBER_MS
  const now = options.now ?? Date.now
  let winner: { region: DownloadRegion; at: number } | null = null
  let probing: Promise<DownloadRegion | null> | null = null

  async function probeOne(region: DownloadRegion, signal: AbortSignal): Promise<DownloadRegion> {
    await options.fetch(options.probes[region], { method: 'HEAD', signal, redirect: 'manual' })
    return region
  }

  async function race(): Promise<DownloadRegion | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = now()
    try {
      const region = await Promise.any(DOWNLOAD_REGIONS.map((item) => probeOne(item, controller.signal)))
      winner = { region, at: now() }
      options.onProbe?.({ winner: region, durationMs: now() - startedAt })
      return region
    } catch {
      options.onProbe?.({ winner: null, durationMs: now() - startedAt })
      return null
    } finally {
      clearTimeout(timer)
      // 胜出后取消另一边仍在进行的探测。
      controller.abort()
    }
  }

  async function autoWinner(): Promise<DownloadRegion | null> {
    if (winner && now() - winner.at < rememberMs) return winner.region
    probing ??= race().finally(() => { probing = null })
    return probing
  }

  return {
    async order(preference) {
      if (preference !== 'auto') return [preference, otherRegion(preference)]
      const first = (await autoWinner()) ?? 'domestic'
      return [first, otherRegion(first)]
    },
    reportFailure(region) {
      if (winner?.region === region) winner = null
    },
    remembered() {
      return winner?.region ?? null
    },
  }
}
