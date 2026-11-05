import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { codeWebPixelSize, type CodeWebView } from '../../../../src/core/videoEdit/codeMaterial/webSource'
import { webTimeAtFrame, webTimeSegment, type WebTimeGrid, type WebTimeSegment } from '../../../../src/core/videoEdit/webTimeCache'
import type { MainLogger } from '../logging/main-logger'
import { FrameEncoder } from '../web-replay/player/encoder'
import { WebSourceBatch } from './batch'
import { WebCacheCapabilityGate } from './capability'
import { hashWebSourceFiles } from './hashes'
import type { ReliableWebSourceFrame } from './page'
import { validateWebTimeSegment } from './segmentValidation'
import type { WebCacheSegmentLease } from './locks'
import type { WebCacheSubmissions } from './submissions'

const positive = z.number().int().positive().safe()
const nonnegative = z.number().int().nonnegative().safe()
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const fileSchema = z.object({ size: positive, sha256 })
const manifestSchema = z.object({
  version: z.literal(1), variantKey: sha256, contentHash: sha256,
  grid: z.object({ rate: z.object({ numerator: positive, denominator: positive }), phase: z.object({ numerator: z.string().regex(/^\d+$/), denominator: z.string().regex(/^[1-9]\d*$/) }) }),
  segment: z.object({ index: nonnegative, firstFrame: nonnegative, frameCount: positive }),
  width: positive, height: positive, codedWidth: positive, codedHeight: positive,
  video: fileSchema, geometry: fileSchema,
})
export type WebTimeSegmentManifest = z.infer<typeof manifestSchema>
const geometrySchema = z.object({ firstFrame: nonnegative, boxes: z.array(z.record(z.string(), z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable()).nullable()) })

export interface WebCacheVariant {
  view: CodeWebView
  deviceScaleFactor: number
  grid: WebTimeGrid
  /** 字体、存储和运行环境由登记方提供；发布前必须重新验证同一代次。 */
  environmentSignature: string
  chromium: string
}

export function webCacheVariantKey(contentHash: string, variant: WebCacheVariant): string {
  const { width, height, region, scale } = variant.view
  return crypto.createHash('sha256').update(JSON.stringify({ contentHash, width, height, region, scale,
    dpr: variant.deviceScaleFactor, grid: variant.grid, environment: variant.environmentSignature, chromium: variant.chromium,
    capture: 'html-in-canvas-identity-restore-2', encoding: 'hevc444-8-constqp0-bt709-limited-srgb' })).digest('hex')
}

/**
 * 一段是一个发布批次。只有完整可靠帧、当前来源/环境/设备与码流契约全部通过，才原子提交整个段族。
 * frames 为惰性生产者：能力门禁拒绝时不会求值，外来信任与存储/字体/联网状态必须由登记方持续复核。
 */
export interface WebTimePublishOptions {
  cacheRoot: string
  batch: WebSourceBatch
  variant: WebCacheVariant
  segment: WebTimeSegment
  width: number
  height: number
  capability: WebCacheCapabilityGate
  submissions: WebCacheSubmissions
  environmentCurrent: (final?: boolean) => Promise<boolean>
  selectors?: readonly string[]
  frames: (signal: AbortSignal, selectors: readonly string[]) => AsyncIterable<ReliableWebSourceFrame>
  logger: Pick<MainLogger, 'info' | 'warn' | 'debug'>
  signal?: AbortSignal
  binaries?: { ffmpeg: string; ffprobe: string }
  /** 相邻槽在所有可靠帧完成后、任何段提交前汇合；存在此门禁时必须重录，不能跳过生产者。 */
  beforePublish?: () => Promise<void>
  /** 调度器持有跨实例段写互斥；发布器不以路径存在或进程内锁冒充独占。 */
  withSegmentLock<T>(key: string, work: (lease: WebCacheSegmentLease) => Promise<T>, signal?: AbortSignal): Promise<T>
}

export async function publishWebTimeSegment(options: WebTimePublishOptions): Promise<{ directory: string; manifest: WebTimeSegmentManifest }> {
  const key = webCacheVariantKey(options.batch.source.contentHash, options.variant)
  await fs.mkdir(options.cacheRoot, { recursive: true })
  const root = await fs.realpath(options.cacheRoot)
  return options.withSegmentLock(`${root}:${key}:${options.segment.index}`, lease => publishLocked({ ...options, cacheRoot: root, signal: lease.signal }, key, lease), options.signal)
}

async function publishLocked(options: WebTimePublishOptions, variantKey: string, lease: WebCacheSegmentLease): Promise<{ directory: string; manifest: WebTimeSegmentManifest }> {
  const { batch, variant, segment, logger, signal } = options
  const context = { variantKey, segment: segment.index, frameCount: segment.frameCount }
  const started = Date.now()
  let temporary: string | undefined, encoder: FrameEncoder | undefined
  let publicationAttempted = false
  let iterator: AsyncIterator<ReliableWebSourceFrame> | undefined
  let aborting: Promise<unknown> | undefined
  const abort = (): void => {
    if (!encoder || aborting) return
    aborting = encoder.abort()
    void aborting.catch(error => logger.warn('网页缓存编码取消失败', { event: 'web_source.record.abort_failed', error, context }))
  }
  logger.info('开始录制网页缓存段', { event: 'web_source.record.start', context })
  try {
    signal?.throwIfAborted()
    positive.parse(segment.frameCount); nonnegative.parse(segment.index); nonnegative.parse(segment.firstFrame)
    const full = webTimeSegment(variant.grid, segment.index, null)!, size = codeWebPixelSize(variant.view)
    if (segment.firstFrame !== full.firstFrame || segment.frameCount > full.frameCount || size.width !== options.width || size.height !== options.height) throw new Error('网页缓存段范围或变体尺寸不匹配')
    if (!await options.environmentCurrent()) throw new Error('网页录制尚未获准或运行环境已变化')
    const capability = await options.capability.check({ submissions: options.submissions, signal: lease.signal })
    if (!capability.available) throw new Error(`网页缓存硬件链路不可用：${capability.reason}`)
    const current = (): void => {
      signal?.throwIfAborted()
      if (!batch.current || !options.capability.isCurrent(capability.generation)) throw new Error('网页录制来源或设备代次已失效')
    }
    current()
    const directory = path.join(options.cacheRoot, `${variantKey}-${segment.index}`)
    // 只有拿到本段内核锁后才回收失主临时族；暂停的录制始终持锁，不能按年龄清掉它。
    await lease.prepare(directory)
    current()
    const existing = await readWebTimeSegment(options.cacheRoot, variantKey, segment.index)
    const geometryBefore = existing ? await readWebTimeGeometry(existing) : undefined
    const requestedSelectors = options.selectors ?? []
    if (!options.beforePublish && existing && geometryBefore && geometryBefore.boxes.every(boxes => requestedSelectors.every(selector => boxes && Object.hasOwn(boxes, selector)))) {
      if (existing.manifest.segment.frameCount !== segment.frameCount || existing.manifest.width !== options.width || existing.manifest.height !== options.height) throw new Error('已有网页缓存段的范围或尺寸不匹配')
      current()
      logger.info('复用已发布的网页缓存段', { event: 'web_source.record.completed', context: { ...context, reused: true, elapsedMs: Date.now() - started } })
      return existing
    }
    await fs.mkdir(options.cacheRoot, { recursive: true })
    temporary = await fs.mkdtemp(path.join(options.cacheRoot, `${variantKey}-${segment.index}.tmp-`))
    const video = path.join(temporary, 'video.mp4'), geometry = path.join(temporary, 'geometry.json')
    encoder = new FrameEncoder(options.width, options.height, variant.grid.rate, video, 'yuv444p', options.binaries?.ffmpeg)
    signal?.addEventListener('abort', abort, { once: true })
    current()
    const encoding = encoder
    await options.submissions.run(() => encoding.start(options.width, options.height), signal)
    const epochs = new Map<AbortSignal, () => Promise<boolean>>()
    const checks: Array<() => boolean> = [], boxes: Array<ReliableWebSourceFrame['boxes']> = []
    let count = 0
    const selectors = [...new Set([...requestedSelectors, ...geometryBefore?.boxes.flatMap(boxes => Object.keys(boxes ?? {})) ?? []])]
    iterator = options.frames(lease.signal, selectors)[Symbol.asyncIterator]()
    while (count < segment.frameCount) {
      current()
      if (!await options.environmentCurrent()) throw new Error('网页录制环境已变化')
      current()
      const next = await iterator.next()
      if (next.done) throw new Error('网页缓存缺帧，须从本段起点向前重演')
      const frame = next.value
      current()
      if (frame.time !== webTimeAtFrame(variant.grid, segment.firstFrame + count) ||
        frame.contentHash !== batch.source.contentHash || frame.frame.width !== options.width || frame.frame.height !== options.height ||
        !frame.isCurrent()) throw new Error('网页缓存帧身份、顺序或尺寸不匹配')
      if (selectors.some(selector => !frame.boxes || !Object.hasOwn(frame.boxes, selector))) throw new Error('网页缓存帧缺少请求的几何信息')
      epochs.set(frame.epoch, frame.validate)
      checks.push(frame.isCurrent)
      boxes.push(frame.boxes)
      await options.submissions.run(async () => { current(); await encoding.write(frame.frame.bitmap(), count++) }, signal)
      current()
      logger.debug('网页缓存段录制推进', { event: 'web_source.record.progress', context: { ...context, frames: count } })
    }
    await options.submissions.run(() => encoding.finish(count - 1), signal)
    current()
    await validateWebTimeSegment(video, { grid: variant.grid, frameCount: count, width: encoder.width, height: encoder.height }, signal, options.binaries)
    await fs.writeFile(geometry, JSON.stringify({ firstFrame: segment.firstFrame, boxes }))
    const hashes = await hashWebSourceFiles([{ relative: 'video.mp4', file: video }, { relative: 'geometry.json', file: geometry }], signal)
    const manifest = manifestSchema.parse({ version: 1, variantKey, contentHash: batch.source.contentHash, grid: variant.grid, segment,
      width: options.width, height: options.height, codedWidth: encoder.width, codedHeight: encoder.height,
      video: hashes.files[0], geometry: hashes.files[1] })
    await fs.writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(manifest))
    await options.beforePublish?.()
    await batch.validate(signal)
    if (!await options.environmentCurrent(true)) throw new Error('网页录制发布前环境已变化')
    for (const validate of epochs.values()) if (!await validate()) throw new Error('网页快照设备或页面已失效')
    current()
    if (checks.some(check => !check())) throw new Error('网页快照发布资格已失效')
    publicationAttempted = true
    await lease.commit(temporary, directory)
    current()
    if (!await options.environmentCurrent()) throw new Error('网页录制在提交期间环境已变化')
    if (checks.some(check => !check())) throw new Error('网页快照在提交期间失效')
    const producer = iterator
    iterator = undefined
    await producer.return?.()
    current()
    temporary = undefined
    logger.info('网页缓存段已发布', { event: 'web_source.record.completed', context: { ...context, bytes: manifest.video.size + manifest.geometry.size, elapsedMs: Date.now() - started } })
    return { directory, manifest }
  } catch (error) {
    // 主动中止（来源结束、显存紧张释放、调度结束）不是录制失败。
    if (signal?.aborted) logger.info('网页缓存段录制已中止', { event: 'web_source.record.cancelled', context: { ...context, reason: signal.reason instanceof Error ? signal.reason.message : String(signal.reason), elapsedMs: Date.now() - started } })
    else logger.warn('网页缓存段录制失败，使用实时网页', { event: 'web_source.record.failed', error, context: { ...context, elapsedMs: Date.now() - started } })
    abort()
    await aborting
    if (publicationAttempted) await lease.rollback().catch(rollbackError => logger.warn('网页缓存段族未能回滚', { event: 'web_source.record.rollback_failed', error: rollbackError, context }))
    if (temporary) await fs.rm(temporary, { recursive: true, force: true })
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    await iterator?.return?.()
  }
}

export async function readWebTimeGeometry(segment: { directory: string; manifest: WebTimeSegmentManifest }): Promise<z.infer<typeof geometrySchema> | undefined> {
  try {
    const geometry = geometrySchema.parse(JSON.parse(await fs.readFile(path.join(segment.directory, 'geometry.json'), 'utf8')))
    return geometry.firstFrame === segment.manifest.segment.firstFrame && geometry.boxes.length === segment.manifest.segment.frameCount ? geometry : undefined
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** 读取仅核对清单和尺寸，不重复 SHA 全盘扫描；解码错误由消费方作废本段。 */
export async function readWebTimeSegment(cacheRoot: string, variantKey: string, index: number): Promise<{ directory: string; manifest: WebTimeSegmentManifest } | undefined> {
  sha256.parse(variantKey); nonnegative.parse(index)
  const directory = path.join(cacheRoot, `${variantKey}-${index}`)
  try {
    const manifest = manifestSchema.parse(JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')))
    if (manifest.variantKey !== variantKey || manifest.segment.index !== index) return undefined
    const [video, geometry] = await Promise.all([fs.stat(path.join(directory, 'video.mp4')), fs.stat(path.join(directory, 'geometry.json'))])
    return video.isFile() && geometry.isFile() && video.size === manifest.video.size && geometry.size === manifest.geometry.size ? { directory, manifest } : undefined
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
