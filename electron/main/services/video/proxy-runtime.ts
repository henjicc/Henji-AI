import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { VideoProxyResult } from '../../../../src/core/videoEdit/proxy'
import { getMediaCacheManager } from '../media/media-cache-runtime'
import { createMainLogger } from '../logging'
import { getPreferredEncoder, invalidateEncoderCache } from './hwaccel'
import { probeHardwareDecode, transcodeVideoProxy, VideoProxyService } from './proxy'

const logger = createMainLogger('main.video.proxy')
const cacheOptions = { onError: (event: string, error: unknown) => logger.warn('代理缓存失败', { event: `video.proxy.cache.${event}`, error }) }
let caches: { video: ReturnType<ReturnType<typeof getMediaCacheManager>['createCache']>; metadata: ReturnType<ReturnType<typeof getMediaCacheManager>['createCache']> } | undefined
// 代理文件只受缓存管理的总上限与保留天数约束（不另设单类上限）。
const proxyCaches = (): NonNullable<typeof caches> => caches ??= {
  video: getMediaCacheManager().createCache('proxy', undefined, { ...cacheOptions, extension: '.mp4', budgetBytes: Number.POSITIVE_INFINITY }),
  metadata: getMediaCacheManager().createCache('proxy', undefined, { ...cacheOptions, extension: '.json', budgetBytes: 16 * 1024 ** 2 }),
}

let service: VideoProxyService | undefined
/** 剪辑的代理服务：编码器与硬解按 FFmpeg 探测结果。 */
export function videoProxyService(): VideoProxyService {
  return service ??= new VideoProxyService(proxyCaches().video, proxyCaches().metadata, async (request, output, signal, progress) => {
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
}

/**
 * 录制时原生画面采集进程同时录好的代理（与原片帧帧对应、尺寸按 auto 档）：搬进代理缓存、按原片登记，
 * 剪辑查代理时直接命中，不再转码。与转码出来的代理同一份缓存、同一套校验。代理文件随后归缓存管理。
 */
export async function adoptRecordedVideoProxy(source: string, proxy: string, size: { width: number; height: number }): Promise<VideoProxyResult> {
  const adopter = new VideoProxyService(proxyCaches().video, proxyCaches().metadata, async (_request, output) => {
    await fs.rm(output, { force: true })
    // 同一块盘上直接改名，免得长录的代理再拷一份；跨盘才复制。
    try { await fs.rename(proxy, output) } catch { await fs.copyFile(proxy, output) }
    return size
  })
  return adopter.create({ requestId: randomUUID(), source: await fs.realpath(source), preset: 'auto' }, new AbortController().signal, () => undefined)
}
