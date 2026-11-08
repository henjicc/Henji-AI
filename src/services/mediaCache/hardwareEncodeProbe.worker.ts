import type { HardwareEncodeCodec, HardwareEncodeResult } from '@/core/media/hardwareCapabilities'

/**
 * 硬件编码能力实测，跑在一次性 Worker 里：4K 画布填色、取帧与编码器配置在主线程上一口气占约 60ms，
 * 刚好碰上播放就丢几帧（启动后 8 秒检测，首次启动、换显卡或升级后才有）。
 */
export type HardwareEncodeProbeResponse = { encode: HardwareEncodeResult[] } | { error: string }

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

async function probeEncodeCapabilities(): Promise<HardwareEncodeResult[]> {
  if (typeof VideoEncoder === 'undefined') return []
  const results: HardwareEncodeResult[] = []
  for (const codec of ['h264', 'hevc', 'av1'] as const) {
    const strings = CODEC_STRINGS[codec]
    // 硬件配置不传帧率：Chromium 硬件编码器按 30fps 折算码率，传入 60fps 会被判为不支持。
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

self.onmessage = () => {
  probeEncodeCapabilities().then(
    encode => self.postMessage({ encode } satisfies HardwareEncodeProbeResponse),
    error => self.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies HardwareEncodeProbeResponse),
  )
}
