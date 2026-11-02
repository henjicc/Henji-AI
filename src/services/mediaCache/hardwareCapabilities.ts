import { createLogger } from '@/core/logging'
import type { VideoRenderCacheFormat } from '@/core/media/mediaCache'
import { type HardwareCapabilitiesReport, type HardwareEncodeResult } from '@/core/media/hardwareCapabilities'
import { getPlatform } from '@/platform/runtime'
import type { HardwareEncodeProbeResponse } from './hardwareEncodeProbe.worker'

/**
 * 本机硬件编解码能力在渲染层的入口：读取已记录的结果；没有或已过期（换了显卡、驱动或应用内核版本）时，
 * 启动后稍等片刻在后台检测——编码用 WebCodecs（先询问再实际编码几帧），解码交给主进程用原生解码服务实测。
 */
const logger = createLogger('services.hardwareCapabilities')
let report: HardwareCapabilitiesReport | null = null
const listeners = new Set<() => void>()
const DETECT_DELAY_MS = 8000

export function getHardwareCapabilities(): HardwareCapabilitiesReport | null { return report }
export function subscribeHardwareCapabilities(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
function publish(next: HardwareCapabilitiesReport | null): void { report = next; for (const listener of listeners) listener() }

/**
 * 预渲染实际使用的编码：自动一律用 H.264。YOGA 4K60 整片实测 H.264 跳帧 0.028%，HEVC 为 0.044%–0.064%，
 * 播放余量更重要；想省空间的用户可以手动选 HEVC（2026-10-21 用户确认）。
 */
export function resolveRenderCacheCodec(format: VideoRenderCacheFormat): 'avc' | 'hevc' {
  return format === 'auto' ? 'avc' : format
}

/**
 * 导出选择硬件加速却不被支持时，按本机检测结果说明原因；没有检测结果或检测认为支持时返回 null（交给通用说明）。
 */
export function hardwareEncodeLimitation(codec: 'avc' | 'hevc', width: number, height: number): string | null {
  const name = codec === 'avc' ? 'H.264' : 'HEVC'
  const result = report?.encode.find(item => item.codec === (codec === 'avc' ? 'h264' : 'hevc'))
  if (!result) return null
  if (!result.hardware) return `本机显卡不支持 ${name} 硬件编码，请改用软件编码${codec === 'hevc' ? '或 H.264' : ''}。`
  const limit = result.maxHardwareSize
  if (limit && width * height > limit.width * limit.height) return `本机显卡的 ${name} 硬件编码最高约 ${limit.width} × ${limit.height}，请降低分辨率或改用软件编码。`
  return null
}

/** 编码检测正常一两秒内完成；驱动卡在配置或编码里不返回时，到时结束 Worker 按未完成处理，下次启动再测。 */
const ENCODE_PROBE_TIMEOUT_MS = 30_000

/** 编码能力在一次性 Worker 里实测（见 hardwareEncodeProbe.worker），不占界面线程；没有 Worker 的环境（单元测试）不检测。 */
export async function detectEncodeCapabilities(): Promise<HardwareEncodeResult[]> {
  if (typeof Worker === 'undefined') return []
  const worker = new Worker(new URL('./hardwareEncodeProbe.worker.ts', import.meta.url), { type: 'module' })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<HardwareEncodeResult[]>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`硬件编码检测 ${ENCODE_PROBE_TIMEOUT_MS / 1000} 秒内没有完成`)), ENCODE_PROBE_TIMEOUT_MS)
      worker.onmessage = (event: MessageEvent<HardwareEncodeProbeResponse>) => { if ('encode' in event.data) resolve(event.data.encode); else reject(new Error(event.data.error)) }
      worker.onerror = event => reject(new Error(event.message || '硬件编码检测失败'))
      worker.postMessage(null)
    })
  } finally { clearTimeout(timer); worker.terminate() }
}

let started = false
/** 应用启动时调用一次：读入记录；没有或过期时稍后在后台检测，不阻塞界面。 */
export function initializeHardwareCapabilities(): void {
  if (started) return
  started = true
  void (async () => {
    let platform
    try { platform = getPlatform().mediaCache } catch { return }
    try {
      const state = await platform.hardwareCapabilities()
      publish(state.report)
      if (!state.stale) return
      await new Promise(resolve => setTimeout(resolve, DETECT_DELAY_MS))
      const startedAt = performance.now()
      const encode = await detectEncodeCapabilities()
      publish(await platform.detectHardwareCapabilities(encode))
      logger.info('本机硬件编解码能力已更新', { event: 'hardware.capabilities.updated', context: { elapsedMs: Math.round(performance.now() - startedAt), encode } })
    } catch (error) { logger.warn('本机硬件能力检测未完成', { event: 'hardware.capabilities.failed', error }) }
  })()
}
