import { createLogger } from '@/core/logging'
import type { VideoRenderCacheFormat } from '@/core/media/mediaCache'
import { hardwareDecodes, hardwareEncodes, type HardwareCapabilitiesReport, type HardwareEncodeCodec, type HardwareEncodeResult } from '@/core/media/hardwareCapabilities'
import { getPlatform } from '@/platform/runtime'

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

/** 预渲染实际使用的编码：自动时在本机硬件能编码并解码 HEVC 时用 HEVC，否则 H.264。 */
export function resolveRenderCacheCodec(format: VideoRenderCacheFormat): 'avc' | 'hevc' {
  if (format !== 'auto') return format
  return hardwareEncodes(report, 'hevc') && hardwareDecodes(report, 'hevc') ? 'hevc' : 'avc'
}

const CODEC_STRINGS: Record<HardwareEncodeCodec, { large: string; small: string }> = {
  h264: { large: 'avc1.640034', small: 'avc1.640028' },
  hevc: { large: 'hvc1.1.6.L156.B0', small: 'hvc1.1.6.L123.B0' },
  av1: { large: 'av01.0.13M.08', small: 'av01.0.08M.08' },
}

/** 实际编码三帧：询问支持不代表驱动真能出帧（会话数满、驱动异常时 configure 后才报错）。 */
async function encodeFrames(config: VideoEncoderConfig): Promise<boolean> {
  if (!(await VideoEncoder.isConfigSupported(config)).supported) return false
  let chunks = 0
  let failed = false
  const encoder = new VideoEncoder({ output: () => { chunks++ }, error: () => { failed = true } })
  try {
    encoder.configure(config)
    const canvas = new OffscreenCanvas(config.width, config.height)
    const context = canvas.getContext('2d')
    for (let index = 0; index < 3; index++) {
      if (context) { context.fillStyle = `hsl(${index * 90} 70% 50%)`; context.fillRect(0, 0, config.width, config.height) }
      const frame = new VideoFrame(canvas, { timestamp: index * 33_333 })
      encoder.encode(frame, { keyFrame: index === 0 }); frame.close()
    }
    await encoder.flush()
    return !failed && chunks > 0
  } catch { return false } finally { if (encoder.state !== 'closed') encoder.close() }
}

export async function detectEncodeCapabilities(): Promise<HardwareEncodeResult[]> {
  if (typeof VideoEncoder === 'undefined') return []
  const results: HardwareEncodeResult[] = []
  for (const codec of ['h264', 'hevc', 'av1'] as const) {
    const strings = CODEC_STRINGS[codec]
    // 硬件配置不传帧率：Chromium 硬件编码器按 30fps 折算码率，传入 60fps 会被判为不支持（剪辑重要记录 032）。
    const hardware = (width: number, height: number, string: string): VideoEncoderConfig => ({ codec: string, width, height, bitrate: 20_000_000, hardwareAcceleration: 'prefer-hardware', latencyMode: 'quality' })
    let maxHardwareSize: HardwareEncodeResult['maxHardwareSize'] = null
    try {
      if (await encodeFrames(hardware(3840, 2160, strings.large))) maxHardwareSize = { width: 3840, height: 2160 }
      else if (await encodeFrames(hardware(1920, 1080, strings.small))) maxHardwareSize = { width: 1920, height: 1080 }
    } catch { /* treated as unsupported */ }
    let software = false
    try { software = (await VideoEncoder.isConfigSupported({ codec: strings.small, width: 1920, height: 1080, bitrate: 10_000_000, framerate: 30, hardwareAcceleration: 'prefer-software' })).supported === true } catch { /* unsupported */ }
    results.push({ codec, hardware: maxHardwareSize !== null, software, maxHardwareSize })
  }
  return results
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
