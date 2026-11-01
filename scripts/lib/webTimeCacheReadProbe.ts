import { ipcMain } from 'electron'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import type { WebSourceInfo } from '../../src/platform/contracts/videoFrameTypes'
import type { WebSourcePages } from '../../electron/main/services/web-source/pages'
import type { WebCacheSegments } from '../../electron/main/services/web-source/segments'
import type { VideoDecoderService } from '../../electron/main/services/video-decoder/client'
import type { VideoFrameBridge, VideoFrameTarget } from '../../electron/main/services/video-decoder/texture-bridge'
import type { WebCacheActivity } from '../../electron/main/services/web-source/activity'
import type { WebCacheScheduler } from '../../electron/main/services/web-source/scheduler'
import { appendLogEvents } from '../../electron/main/services/logging/push'
import { queryLogEvents } from '../../electron/main/services/logging/query'

export async function cacheReadProbe(options: { source: WebSourceInfo; target: VideoFrameTarget; pages: WebSourcePages; segments: WebCacheSegments;
  service: VideoDecoderService; bridge: VideoFrameBridge; activity: WebCacheActivity; scheduler: WebCacheScheduler;
  second: { source: WebSourceInfo; target: VideoFrameTarget }; closeHost(): void }): Promise<Record<string, unknown>> {
  const { source, target, pages, segments, service, bridge, activity, scheduler } = options
  interface Delivered { ticket: string; streamId: string; route: string; width: number; height: number; png: Uint8Array; error?: string }
  const pending = new Map<string, (frame: Delivered) => void>()
  const listener = (event: Electron.IpcMainEvent, frame: Delivered): void => { pending.get(`${event.sender.id}:${frame.ticket}`)?.(frame) }
  ipcMain.on('web-cache-probe:decoded', listener)
  const reads: Array<{ time: number; ms: number; hash: string; nativeStreams: number }> = []
  const grid = { rate: { numerator: 1, denominator: 1 }, phase: { numerator: '0', denominator: '1' } }
  const { target: second, source: other } = options.second
  let crossWindow: Record<string, unknown> | undefined
  let warmingRequests = 0
  try {
    await activity.foreground(async () => {
      const warmingStarted = new Date().toISOString(), warmingDeadline = performance.now() + 60_000
      for (;;) {
        warmingRequests++
        await pages.capture(second.id, { streamId: other.streamId, time: 0, ticket: 'warm-environment', precision: 'web-cache', cacheGrid: grid, boxes: ['div'] })
        await appendLogEvents([{ timestamp: new Date().toISOString(), level: 'debug', domain: 'main.web_source', event: 'web_source.probe.warming', message: '核对第二窗口缓存环境', source: 'backend' }])
        const logs = await queryLogEvents({ date: new Date().toISOString().slice(0, 10), afterTimestamp: warmingStarted, domainPrefix: 'main.web_source', limit: 1000 })
        if (logs.events.some(event => event.event === 'web_source.cache.hit' && (event.context as Record<string, unknown> | undefined)?.ticket === 'warm-environment')) break
        if (performance.now() >= warmingDeadline) throw new Error('第二窗口缓存环境持续未就绪')
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      for (const [index, time] of [0, 1, 2, 0].entries()) {
        const ticket = `segment-read-${index}`, started = performance.now()
        let timer: ReturnType<typeof setTimeout> | undefined
        const frame = new Promise<Delivered>((resolve, reject) => { pending.set(`${target.id}:${ticket}`, resolve); timer = setTimeout(() => reject(new Error('缓存读取纹理未送达')), 15000) })
        try {
          const [result, delivered] = await Promise.all([pages.capture(target.id, { streamId: source.streamId, time, ticket, precision: 'web-cache', cacheGrid: grid, boxes: ['div'] }), frame])
          if (result.provenance !== 'web-cache' || delivered.error || delivered.width !== 257 || delivered.height !== 259 || delivered.streamId !== source.streamId || delivered.route !== 'scheduler' || !delivered.png || result.boxes?.div?.[2] !== 257) throw new Error(`正式缓存读取交付身份、裁剪或几何错误：${JSON.stringify({ result, delivered: { ...delivered, png: delivered.png?.byteLength } })}`)
          const stats = await service.stats()
          if (stats.streams.length !== 1) throw new Error('正式读缓存没有复用一个原生会话')
          reads.push({ time, ms: performance.now() - started, hash: crypto.createHash('sha256').update(delivered.png).digest('hex'), nativeStreams: stats.streams.length })
        } finally { clearTimeout(timer); pending.delete(`${target.id}:${ticket}`) }
      }
      if (reads[0].hash !== reads[2].hash || reads[0].hash !== reads[3].hash || reads[0].hash === reads[1].hash) throw new Error('缓存跨段画面错误')
      const exact = await pages.capture(target.id, { streamId: source.streamId, time: 0, ticket: 'exact', boxes: ['div'] })
      if (exact.provenance !== 'live' || exact.pixelWidth !== 257) throw new Error('默认精确读取失败')
      const nativeBefore = (await service.stats()).streams[0].streamId
      const read = async (destination: VideoFrameTarget, page: WebSourceInfo, time: number): Promise<string> => {
        const ticket = 'segment-same-ticket', key = `${destination.id}:${ticket}`
        let timer: ReturnType<typeof setTimeout> | undefined
        const received = new Promise<Delivered>((resolve, reject) => { pending.set(key, resolve); timer = setTimeout(() => reject(new Error('跨窗口帧未交付')), 15000) })
        try {
          const [, frame] = await Promise.all([pages.capture(destination.id, { streamId: page.streamId, ticket, time, precision: 'web-cache', cacheGrid: grid, boxes: ['div'] }), received])
          if (frame.error || !frame.png || frame.streamId !== page.streamId || frame.route !== page.route || frame.width !== 257 || frame.height !== 259) throw new Error('跨窗口交付身份错误')
          const stats = await service.stats()
          if (stats.streams.length !== 1 || stats.streams[0].streamId !== nativeBefore) throw new Error('跨窗口重新创建或重复持有解码会话')
          return crypto.createHash('sha256').update(frame.png).digest('hex')
        } finally { clearTimeout(timer); pending.delete(key) }
      }
      const [red, blue] = await Promise.all([read(target, source, 0), read(second, other, 1)])
      if (red !== reads[0].hash || blue !== reads[1].hash) throw new Error('跨窗口相同ticket发生串帧')
      options.closeHost()
      const afterClose = await read(second, other, 2)
      if (afterClose !== reads[2].hash) throw new Error('首窗口关闭影响共享会话')
      crossWindow = { concurrentSameTicket: true, firstWindowClosed: true, nativeStreamUnchanged: true, red, blue, afterClose }
      const occupied = (await segments.list()).find(entry => entry.file.endsWith('-1'))!
      if (await occupied.remove()) throw new Error('仍由解码器打开的段被回收')
      if (await read(second, other, 0) !== red) throw new Error('切走占用段后画面错误')
      const family = (await segments.list()).find(entry => entry.file.endsWith('-1'))!
      if (!await family.remove() || await fs.stat(family.file).catch(() => undefined)) throw new Error('原生整段回收未完成')
      const fallback = await pages.capture(second.id, { streamId: other.streamId, time: 2, ticket: 'fallback', precision: 'web-cache', cacheGrid: grid, boxes: ['div'] })
      if (fallback.provenance !== 'live' || fallback.pixelWidth !== 257 || fallback.boxes?.div?.[2] !== 257) throw new Error('段回收后实时回退失败')
      pages.close(second.id, other.streamId)
      pages.dispose()
    })
    await scheduler.drained()
    await bridge.dispose()
    await appendLogEvents([{ timestamp: new Date().toISOString(), level: 'debug', domain: 'main.web_source', event: 'web_source.probe.completed', message: '缓存读取与整段回退完成', source: 'backend' }])
    const logs = await queryLogEvents({ date: new Date().toISOString().slice(0, 10), domainPrefix: 'main.web_source', limit: 1000 })
    const hits = logs.events.filter(event => event.event === 'web_source.cache.hit')
    const measuredHits = hits.filter(event => (event.context as Record<string, unknown> | undefined)?.ticket !== 'warm-environment')
    if (measuredHits.length !== 8 || logs.corruptedLines || !logs.events.some(event => event.event === 'web_source.cache.miss' && (event.context as Record<string, unknown> | undefined)?.reason === 'missing-segment-or-geometry')) throw new Error('正式缓存命中或回退日志不符')
    return { reads, crossWindow, warmingRequests, hitCount: measuredHits.length, requestedCacheFrames: 9, exactBypassedCache: true, openSegmentProtected: true, familyEviction: true, realTimeFallback: true, logs, afterClose: await service.stats() }
  } finally { ipcMain.off('web-cache-probe:decoded', listener) }
}
