import fs from 'node:fs/promises'
import path from 'node:path'
import { sharedTexture } from 'electron'
import type { MainLogger } from '../logging/main-logger'
import type { VideoDecoderService } from '../video-decoder/client'
import { VideoFrameBridge, type VideoFrameTarget } from '../video-decoder/texture-bridge'
import { FrameEncoder } from '../web-replay/player/encoder'
import { GpuFrameCapture } from '../web-replay/player/gpuCapture'
import { validateWebTimeSegment } from './segmentValidation'
import { waitWebCacheTask, type WebCacheSubmissions } from './submissions'

export interface WebCacheProbeControl { submissions: WebCacheSubmissions; signal: AbortSignal }

export type WebCacheCapability =
  | { available: true; generation: number; decoder: string }
  | { available: false; generation: number; reason: 'platform' | 'probe-failed' | 'environment-changed'; retryAt?: number }

const WEB_CACHE_PROBE_STEP_MS = 30_000

/** 能力只在本进程当前 GPU 代次有效；驱动/设备变化和失败均不能沿用旧的通过结果。 */
export class WebCacheCapabilityGate {
  private generation = 0
  private result?: WebCacheCapability
  private flight?: { promise: Promise<WebCacheCapability>; signal?: AbortSignal }
  private gpuSignature?: string

  constructor(private readonly probe: (control?: WebCacheProbeControl) => Promise<string>, private readonly logger: Pick<MainLogger, 'info' | 'warn'>,
    private readonly platform: string = process.platform, private readonly now: () => number = Date.now) {}

  invalidate(): void {
    this.generation++
    this.result = undefined
    this.logger.info('网页缓存硬件代次已失效', { event: 'web_source.capability.invalidated', context: { generation: this.generation } })
    // 保留在途屏障，避免设备变动时启动第二套重任务。
  }

  isCurrent(generation: number): boolean { return this.result?.available === true && this.generation === generation }
  get availableGeneration(): number | undefined { return this.result?.available ? this.generation : undefined }

  updateGpuInfo(info: unknown): void {
    if (!info || typeof info !== 'object' || !('gpuDevice' in info) || !Array.isArray(info.gpuDevice)) return
    const devices = info.gpuDevice.flatMap((value: unknown) => {
      if (!value || typeof value !== 'object' || !('vendorId' in value) || !('deviceId' in value)) return []
      const device = value as Record<string, unknown>
      return [JSON.stringify([device.vendorId, device.deviceId, device.active ?? null, device.driverVersion ?? null])]
    }).sort()
    if (!devices.length) return
    const signature = JSON.stringify(devices)
    if (this.gpuSignature !== undefined && this.gpuSignature !== signature) this.invalidate()
    this.gpuSignature = signature
  }

  async check(control?: WebCacheProbeControl): Promise<WebCacheCapability> {
    control?.signal.throwIfAborted()
    if (this.platform !== 'win32') return { available: false, generation: this.generation, reason: 'platform' }
    while (this.flight) {
      const flight = this.flight
      try { return await waitWebCacheTask(flight.promise, control?.signal) }
      catch (error) {
        control?.signal.throwIfAborted()
        // 发起段取消时，其他段等它清理完，再用自己的任务继续实探。
        if (!flight.signal?.aborted) throw error
      }
    }
    if (this.result && (this.result.available || (this.result.retryAt ?? 0) > this.now())) return this.result
    const generation = this.generation, startedAt = this.now()
    this.logger.info('实探网页缓存硬件链路', { event: 'web_source.capability.start', context: { generation } })
    const promise = (async (): Promise<WebCacheCapability> => {
      try {
        const decoder = await this.probe(control)
        control?.signal.throwIfAborted()
        if (generation !== this.generation) {
          this.logger.info('网页缓存硬件实探结果所属代次已失效', { event: 'web_source.capability.superseded', context: { generation, currentGeneration: this.generation, elapsedMs: this.now() - startedAt } })
          return { available: false, generation: this.generation, reason: 'environment-changed' }
        }
        this.result = { available: true, generation, decoder }
        this.logger.info('网页缓存硬件链路实探通过', { event: 'web_source.capability.completed', context: { generation, decoder, elapsedMs: this.now() - startedAt } })
      } catch (error) {
        if (control?.signal.aborted) this.logger.info('网页缓存硬件实探随任务取消', { event: 'web_source.capability.cancelled', context: { generation, elapsedMs: this.now() - startedAt } })
        control?.signal.throwIfAborted()
        if (generation !== this.generation) {
          this.logger.info('网页缓存硬件实探结果所属代次已失效', { event: 'web_source.capability.superseded', error, context: { generation, currentGeneration: this.generation, elapsedMs: this.now() - startedAt } })
          return { available: false, generation: this.generation, reason: 'environment-changed' }
        }
        // NVENC、解码器和共享纹理的临时资源不足不能永久改变设备能力。
        this.result = { available: false, generation, reason: 'probe-failed', retryAt: this.now() + 30_000 }
        this.logger.warn('网页缓存硬件链路暂不可用，使用实时网页', { event: 'web_source.capability.failed', error, context: { generation, retryAt: this.result.retryAt, elapsedMs: this.now() - startedAt } })
      }
      return this.result
    })().finally(() => { if (this.flight?.promise === promise) this.flight = undefined })
    this.flight = { promise, signal: control?.signal }
    return waitWebCacheTask(promise, control?.signal)
  }
}

/**
 * 小幅彩色平面验证完整硬件路径：正式编码器 → 码流校验 → 原生硬解 → 正式纹理桥 → Chromium/WebGPU reader。
 * 能力表和解码器成功打开不能证明共享纹理可消费；必须检查实际读回的三幅不同画面与倒跳结果。
 */
export async function probeWebCacheHardware(options: {
  directory: string
  service: VideoDecoderService
  logger: Pick<MainLogger, 'debug' | 'info' | 'warn' | 'error'>
  binaries?: { ffmpeg: string; ffprobe: string }
  control?: WebCacheProbeControl
}): Promise<string> {
  // 每一步硬件操作单独限时（排队暂停不计入）：卡在解码、纹理桥或读回时按失败稍后重试，不让在途实探永远挡住缓存录制与导出写入。
  const bounded = <T>(work: () => Promise<T>): Promise<T> => waitWebCacheTask(work(), AbortSignal.timeout(WEB_CACHE_PROBE_STEP_MS))
  const run = async <T>(step: string, work: () => Promise<T>): Promise<T> => {
    const context = { step, probe: path.basename(directory) }
    options.logger.debug('网页缓存硬件实探步骤排队', { event: 'web_source.capability.step.queued', context })
    const execute = async (): Promise<T> => {
      options.logger.debug('网页缓存硬件实探步骤开始', { event: 'web_source.capability.step.start', context })
      try {
        const value = await bounded(work)
        options.logger.debug('网页缓存硬件实探步骤完成', { event: 'web_source.capability.step.completed', context })
        return value
      } catch (error) {
        options.logger.debug('网页缓存硬件实探步骤未完成', { event: 'web_source.capability.step.failed', error, context })
        throw error
      }
    }
    return options.control ? options.control.submissions.run(execute, options.control.signal) : execute()
  }
  await fs.mkdir(options.directory, { recursive: true })
  const directory = await fs.mkdtemp(path.join(options.directory, 'probe-'))
  const file = path.join(directory, 'sample.mp4')
  const width = 256, height = 256, area = width * height
  const colors = [[90, 110, 160], [155, 150, 105], [200, 105, 135]]
  const encoder = new FrameEncoder(width, height, 30, file, 'yuv444p', options.binaries?.ffmpeg)
  const reader = new GpuFrameCapture(0, 'yuv444p')
  let bridge: VideoFrameBridge | undefined
  const abort = (): void => { void encoder.abort().catch(() => undefined) }
  options.control?.signal.addEventListener('abort', abort, { once: true })
  const encode = (step: string, work: () => Promise<void>): Promise<void> => run(step, async () => {
    let timedOut = false
    // 暂停等待不计入硬件超时；每次已提交的编码操作仍有独立上限。
    const timer = setTimeout(() => { timedOut = true; abort() }, 30_000)
    try { await work(); if (timedOut) throw new Error('网页缓存实探编码超时') } finally { clearTimeout(timer) }
  })
  try {
    await encode('encoder.open', () => encoder.start(width, height))
    for (const [index, color] of colors.entries()) {
      const frame = Buffer.alloc(area * 3)
      for (let plane = 0; plane < 3; plane++) frame.fill(color[plane], plane * area, (plane + 1) * area)
      await encode('encoder.write', () => encoder.write(frame, index))
    }
    await encode('encoder.finish', () => encoder.finish(colors.length - 1))
    await run('segment.validate', () => validateWebTimeSegment(file, { width, height, frameCount: colors.length,
      grid: { rate: { numerator: 30, denominator: 1 }, phase: { numerator: '0', denominator: '1' } } }, options.control ? AbortSignal.any([options.control.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000), options.binaries))
    await run('reader.open', () => reader.open())
    const contents = reader.targetContents
    const target: VideoFrameTarget = {
      id: contents.id, isDestroyed: () => contents.isDestroyed(), get mainFrame() { return contents.mainFrame },
      send: (channel, value) => contents.send(channel, value),
      onGone: listener => {
        const gone = (): void => listener('destroyed')
        contents.once('destroyed', gone)
        return () => { contents.off('destroyed', gone) }
      },
    }
    let expected = 0, consumed = 0
    let deliveryStarted = false
    let delivered: { resolve: () => void; reject: (error: unknown) => void } | undefined
    bridge = new VideoFrameBridge({ service: options.service, logger: options.logger,
      sharedTexture: {
        importSharedTexture: input => sharedTexture.importSharedTexture(input),
        sendSharedTexture: async input => {
          deliveryStarted = true
          try {
            const frame = await run('reader.read', () => reader.readImported(input.importedSharedTexture))
            if (frame.width !== width || frame.height !== height) throw new Error('网页缓存实探解码尺寸不匹配')
            const bytes = frame.bitmap(), color = colors[expected]
            // RGB 往返量化允许两个码值，任何通道交换、旧帧或未初始化区域均拒绝。
            for (let plane = 0; plane < 3; plane++) for (let pixel = 0; pixel < area; pixel++) {
              if (Math.abs(bytes[plane * area + pixel] - color[plane]) > 2) throw new Error('网页缓存实探共享纹理像素不匹配')
            }
            consumed++
            delivered?.resolve()
          } catch (error) { delivered?.reject(error); throw error }
        },
      },
    })
    const decoderBridge = bridge
    const opened = await run('decoder.open', () => decoderBridge.openDecoder(target, { route: 'web-cache-capability', path: file, purpose: 'seek', hardware: 'auto', format: 'rgbaf16', poolSize: 2 }))
    if (!opened.decoder.hardware) throw new Error('网页缓存实探未使用硬件解码')
    for (const index of [0, 1, 2, 0]) {
      expected = index
      const before = consumed
      deliveryStarted = false
      const received = new Promise<void>((resolve, reject) => {
        delivered = { resolve, reject }
      })
      void received.catch(() => undefined)
      try {
        const result = await run('decoder.read', () => decoderBridge.frameAt(target.id, { streamId: opened.streamId, time: index / 30, ticket: `probe-${before}` }))
        // 正式桥同步分派 frame 事件后才处理请求回执；缺少交付不能无限等待。
        if (!result.found || !deliveryStarted) throw new Error('网页缓存实探没有交付请求帧')
        await waitWebCacheTask(received, AbortSignal.timeout(WEB_CACHE_PROBE_STEP_MS))
        if (consumed !== before + 1) throw new Error('网页缓存实探没有消费到请求帧')
      } finally { delivered = undefined }
    }
    return opened.decoder.path
  } finally {
    options.logger.debug('网页缓存硬件实探开始清理', { event: 'web_source.capability.cleanup.start', context: { probe: path.basename(directory) } })
    options.control?.signal.removeEventListener('abort', abort)
    // 显式等待关流，避免销毁 reader 的回调抢先移除流后 dispose 错过在途关闭。
    try { await encoder.abort() } finally {
      try { await bridge?.dispose() } finally {
        try { await reader.dispose() } finally { await fs.rm(directory, { recursive: true, force: true }) }
      }
    }
    options.logger.debug('网页缓存硬件实探清理完成', { event: 'web_source.capability.cleanup.completed', context: { probe: path.basename(directory) } })
  }
}
