import { app, type WebContents } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { SCENE_DETECTION_CHANNELS } from '../../../src/platform/contracts/sceneDetection'
import { sceneDetectionRequestSchema } from '../../../src/core/videoEdit/sceneDetection'
import { registerIpcHandler } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { isPathWithinAllowedMediaRoots } from '../protocol'
import { normalizeLocalSource } from '../services/image/source'
import { createContentDiskCache } from '../services/media/content-disk-cache'
import { getProgramDataDir } from '../services/appPaths'
import { createMainLogger } from '../services/logging'
import { SceneDetectionService } from '../services/video/scene-detection'
import { identifyMediaContent } from '../services/media/content-identity'

const logger = createMainLogger('main.video.scene_detection')
const tasks = new Map<number, Map<string, AbortController>>()
const watched = new WeakSet<WebContents>()
const service = new SceneDetectionService(createContentDiskCache({ directory: () => path.join(getProgramDataDir(), 'scene-detection'), extension: '.json', budgetBytes: 16 * 1024 * 1024, onError: (event, error) => logger.warn('场景检测缓存失败', { event: `video.scene_detection.cache.${event}`, error }) }))
function release(senderId: number): void { for (const controller of tasks.get(senderId)?.values() ?? []) controller.abort(new Error('场景检测已取消。')); tasks.delete(senderId) }
async function authorizedSource(source: string): Promise<string> {
  const local = normalizeLocalSource(source)
  if (!path.isAbsolute(local) || !isPathWithinAllowedMediaRoots(local)) throw new Error('视频尚未获得读取权限，请从素材面板导入。')
  const canonical = await fs.realpath(local)
  if (!isPathWithinAllowedMediaRoots(canonical)) throw new Error('视频实际位置不在已授权目录内，请重新导入。')
  return canonical
}
export function registerSceneDetectionHandlers(): void {
  registerIpcHandler(SCENE_DETECTION_CHANNELS.detect, value => sceneDetectionRequestSchema.parse(value), async (request, event) => {
    const sender = event.sender; const senderId = sender.id
    if (!watched.has(sender)) {
      watched.add(sender); sender.once('destroyed', () => release(senderId))
      sender.on('did-start-navigation', (_event, _url, _inPlace, main) => { if (main) release(senderId) })
    }
    let owned = tasks.get(senderId)
    if (!owned) { owned = new Map(); tasks.set(senderId, owned) }
    if (owned.has(request.requestId) || owned.size >= 2) throw new Error('场景检测正在进行，请等待或取消。')
    const controller = new AbortController(); owned.set(request.requestId, controller)
    logger.info('开始场景检测', { event: 'video.scene_detection.start', requestId: request.requestId })
    try {
      const canonical = await authorizedSource(request.source)
      const result = await service.detect({ ...request, source: canonical }, controller.signal, progress => {
        if (!sender.isDestroyed()) sender.send(SCENE_DETECTION_CHANNELS.progress, { requestId: request.requestId, progress })
      })
      logger.info('场景检测完成', { event: 'video.scene_detection.completed', requestId: request.requestId, context: { cuts: result.cutsSeconds.length } }); return result
    } catch (error) { logger.error('场景检测未完成', { event: controller.signal.aborted ? 'video.scene_detection.cancelled' : 'video.scene_detection.failed', requestId: request.requestId, error }); throw error }
    finally { owned.delete(request.requestId) }
  }, assertTrustedApplicationSender)
  registerIpcHandler(SCENE_DETECTION_CHANNELS.cancel, value => z.string().min(1).max(100).parse(value), (id, event) => { tasks.get(event.sender.id)?.get(id)?.abort(new Error('场景检测已取消。')) }, assertTrustedApplicationSender)
  registerIpcHandler(SCENE_DETECTION_CHANNELS.validate, value => z.object({ source: z.string().min(1).max(32768), contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(value), async request => (await identifyMediaContent(await authorizedSource(request.source))).identity === request.contentIdentity, assertTrustedApplicationSender)
  app.once('before-quit', () => { for (const senderId of tasks.keys()) release(senderId) })
}
