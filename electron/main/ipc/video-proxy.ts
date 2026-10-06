import { app, type WebContents } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { VIDEO_PROXY_CHANNELS } from '../../../src/platform/contracts/videoProxy'
import { videoProxyRequestSchema } from '../../../src/core/videoEdit/proxy'
import { registerIpcHandler } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { allowMediaRoot, isPathWithinAllowedMediaRoots } from '../protocol'
import { normalizeLocalSource } from '../services/image/source'
import { createContentDiskCache } from '../services/media/content-disk-cache'
import { getProgramDataDir } from '../services/appPaths'
import { createMainLogger } from '../services/logging'
import { VideoProxyService } from '../services/video/proxy'

const logger = createMainLogger('main.video.proxy')
const tasks = new Map<number, Map<string, AbortController>>()
const watched = new WeakSet<WebContents>()
const cacheOptions = { directory: () => path.join(getProgramDataDir(), 'cache', 'video-proxies'), onError: (event: string, error: unknown) => logger.warn('代理缓存失败', { event: `video.proxy.cache.${event}`, error }) }
const service = new VideoProxyService(createContentDiskCache({ ...cacheOptions, extension: '.mp4', budgetBytes: 20 * 1024 ** 3 }), createContentDiskCache({ ...cacheOptions, extension: '.json', budgetBytes: 16 * 1024 ** 2 }))
function release(senderId: number): void { for (const controller of tasks.get(senderId)?.values() ?? []) controller.abort(new Error('代理创建已取消。')); tasks.delete(senderId) }
async function authorizedSource(source: string): Promise<string> {
  const local = normalizeLocalSource(source)
  if (!path.isAbsolute(local) || !isPathWithinAllowedMediaRoots(local)) throw new Error('视频尚未获得读取权限，请从素材面板导入。')
  const canonical = await fs.realpath(local)
  if (!isPathWithinAllowedMediaRoots(canonical)) throw new Error('视频实际位置不在已授权目录内，请重新导入。')
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
    if (owned.has(request.requestId) || owned.size >= 2) throw new Error('代理创建正在进行，请等待或取消。')
    const controller = new AbortController(); owned.set(request.requestId, controller)
    logger.info('开始代理创建', { event: 'video.proxy.start', requestId: request.requestId })
    try {
      const canonical = await authorizedSource(request.source)
      const result = await service.create({ ...request, source: canonical }, controller.signal, progress => {
        if (!sender.isDestroyed()) sender.send(VIDEO_PROXY_CHANNELS.progress, { requestId: request.requestId, progress })
      })
      allowMediaRoot(path.dirname(result.path))
      logger.info('代理创建完成', { event: 'video.proxy.completed', requestId: request.requestId, context: { preset: result.preset } }); return result
    } catch (error) { logger.error('代理创建未完成', { event: controller.signal.aborted ? 'video.proxy.cancelled' : 'video.proxy.failed', requestId: request.requestId, error }); throw error }
    finally { owned.delete(request.requestId) }
  }, assertTrustedApplicationSender)
  registerIpcHandler(VIDEO_PROXY_CHANNELS.cancel, value => z.string().min(1).max(100).parse(value), (id, event) => { tasks.get(event.sender.id)?.get(id)?.abort(new Error('代理创建已取消。')) }, assertTrustedApplicationSender)
  registerIpcHandler(VIDEO_PROXY_CHANNELS.lookup, value => videoProxyRequestSchema.omit({ requestId: true }).parse(value), async request => { const result = await service.lookup(await authorizedSource(request.source), request.preset); if (result) allowMediaRoot(path.dirname(result.path)); return result }, assertTrustedApplicationSender)
  app.once('before-quit', () => { for (const senderId of tasks.keys()) release(senderId) })
}
