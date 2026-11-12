import { app, type WebContents } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { VIDEO_PROXY_CHANNELS } from '../../../src/platform/contracts/videoProxy'
import { videoProxyRequestSchema } from '../../../src/core/videoEdit/proxy'
import { registerIpcHandler } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { normalizeLocalSource } from '../services/image/source'
import { getMediaCacheManager } from '../services/media/media-cache-runtime'
import { createMainLogger } from '../services/logging'
import { probeHardwareDecode, transcodeVideoProxy, VideoProxyService, type VideoProxyTranscodeReport } from '../services/video/proxy'
import { getPreferredEncoder, invalidateEncoderCache } from '../services/video/hwaccel'

const logger = createMainLogger('main.video.proxy')
const tasks = new Map<number, Map<string, AbortController>>()
const watched = new WeakSet<WebContents>()
const cacheOptions = { onError: (event: string, error: unknown) => logger.warn('代理缓存失败', { event: `video.proxy.cache.${event}`, error }) }
// 代理文件只受缓存管理的总上限与保留天数约束（不另设单类上限）；编码器与硬解按 FFmpeg 探测结果。
const service = new VideoProxyService(getMediaCacheManager().createCache('proxy', undefined, { ...cacheOptions, extension: '.mp4', budgetBytes: Number.POSITIVE_INFINITY }), getMediaCacheManager().createCache('proxy', undefined, { ...cacheOptions, extension: '.json', budgetBytes: 16 * 1024 ** 2 }), async (request, output, signal, progress) => {
  const encoder = (await getPreferredEncoder()).id
  const hardwareDecode = await probeHardwareDecode()
  logger.info('代理编码方式', { event: 'video.proxy.encoder', requestId: request.requestId, context: { encoder, hardwareDecode } })
  const report = await transcodeVideoProxy(request, output, signal, progress, undefined, {
    encoder, hardwareDecode,
    onFallback: (error, stage) => logger.warn(stage === 'decode' ? '显卡解码代理失败，改用处理器解码' : '显卡转码代理失败，改用处理器', { event: 'video.proxy.hardware_fallback', requestId: request.requestId, error, context: { encoder, hardwareDecode, stage } }),
    onQueued: () => logger.info('代理等待处理器预算', { event: 'video.proxy.queued', requestId: request.requestId, context: { stage: 'cpu' } }),
  })
  // 处理器编码成功说明原片可读、失败在显卡编码器本身：这时才让编码器探测结果失效。
  if (encoder !== 'cpu' && report.encoder === 'cpu') void invalidateEncoderCache().catch(() => undefined)
  return report
})
function release(senderId: number): void { for (const controller of tasks.get(senderId)?.values() ?? []) controller.abort(new Error('代理创建已取消。')); tasks.delete(senderId) }
async function resolveSource(source: string): Promise<string> {
  const local = normalizeLocalSource(source)
  if (!path.isAbsolute(local)) throw new Error('请使用本地文件的绝对路径。')
  const canonical = await fs.realpath(local)
  return canonical
}
export function registerVideoProxyHandlers(): void {
  registerIpcHandler(VIDEO_PROXY_CHANNELS.create, value => videoProxyRequestSchema.parse(value), async (request, event) => {
    const sender = event.sender; const senderId = sender.id
    if (!watched.has(sender)) {
      watched.add(sender); sender.once('destroyed', () => release(senderId))
      sender.on('did-start-navigation', (_event, _url, _inPlace, main) => { if (main) release(senderId) })
    }
    let owned = tasks.get(senderId)
    if (!owned) { owned = new Map(); tasks.set(senderId, owned) }
    if (owned.has(request.requestId)) throw new Error('代理创建正在进行，请等待或取消。')
    const controller = new AbortController(); owned.set(request.requestId, controller)
    const started = Date.now()
    logger.info('开始代理创建', { event: 'video.proxy.start', requestId: request.requestId })
    try {
      const canonical = await resolveSource(request.source)
      let report: Partial<VideoProxyTranscodeReport> | undefined
      const result = await service.create({ ...request, source: canonical }, controller.signal, progress => {
        if (!sender.isDestroyed()) sender.send(VIDEO_PROXY_CHANNELS.progress, { requestId: request.requestId, progress })
      }, {
        queued: () => logger.info('代理排队等待', { event: 'video.proxy.queued', requestId: request.requestId, context: { stage: 'lane', ...service.queueState() } }),
        transcoded: value => { report = value },
      })
      // report 为空表示命中已有代理，没有转码。
      logger.info('代理创建完成', { event: 'video.proxy.completed', requestId: request.requestId, context: { preset: result.preset, cached: !report, totalMs: Date.now() - started, ...report } }); return result
    } catch (error) { logger.error('代理创建未完成', { event: controller.signal.aborted ? 'video.proxy.cancelled' : 'video.proxy.failed', requestId: request.requestId, error }); throw error }
    finally { owned.delete(request.requestId) }
  }, assertTrustedApplicationSender)
  registerIpcHandler(VIDEO_PROXY_CHANNELS.cancel, value => z.string().min(1).max(100).parse(value), (id, event) => { tasks.get(event.sender.id)?.get(id)?.abort(new Error('代理创建已取消。')) }, assertTrustedApplicationSender)
  registerIpcHandler(VIDEO_PROXY_CHANNELS.lookup, value => videoProxyRequestSchema.omit({ requestId: true }).parse(value), async request => { const result = await service.lookup(await resolveSource(request.source), request.preset); return result }, assertTrustedApplicationSender)
  app.once('before-quit', () => { for (const senderId of tasks.keys()) release(senderId) })
}
