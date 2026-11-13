import { app, type WebContents } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { VIDEO_PROXY_CHANNELS } from '../../../src/platform/contracts/videoProxy'
import { videoProxyRequestSchema } from '../../../src/core/videoEdit/proxy'
import { registerIpcHandler } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { normalizeLocalSource } from '../services/image/source'
import { createMainLogger } from '../services/logging'
import type { VideoProxyTranscodeReport } from '../services/video/proxy'
import { videoProxyService } from '../services/video/proxy-runtime'

const logger = createMainLogger('main.video.proxy')
const tasks = new Map<number, Map<string, AbortController>>()
const watched = new WeakSet<WebContents>()
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
      const service = videoProxyService()
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
  registerIpcHandler(VIDEO_PROXY_CHANNELS.lookup, value => videoProxyRequestSchema.omit({ requestId: true }).parse(value), async request => { const result = await videoProxyService().lookup(await resolveSource(request.source), request.preset); return result }, assertTrustedApplicationSender)
  app.once('before-quit', () => { for (const senderId of tasks.keys()) release(senderId) })
}
