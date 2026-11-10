import { app, BrowserWindow } from 'electron'
import { z } from 'zod'
import { MEDIA_CACHE_CHANNELS } from '../../../src/platform/contracts/mediaCache'
import { mediaCacheCategorySchema, mediaCacheSettingsSchema } from '../../../src/core/media/mediaCache'
import { videoRenderCacheBeginSchema, videoRenderCacheCommitSchema, videoRenderCacheRemoveSchema } from '../../../src/core/videoEdit/renderCacheStore'
import { registerIpcHandler, parseVoid } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { getMediaCacheManager } from '../services/media/media-cache-runtime'
import { createContentDiskCache } from '../services/media/content-disk-cache'
import { getProgramStoreDir } from '../services/appBasePaths'
import { getVideoRenderCacheService } from '../services/video/render-cache-runtime'
import { createMainLogger } from '../services/logging'
import { getHardwareCapabilitiesService } from '../services/hardware/runtime'
import { hardwareEncodeResultSchema } from '../../../src/core/media/hardwareCapabilities'

const logger = createMainLogger('main.media_cache')
const projectRequest = z.object({ projectId: z.string().regex(/^[\w-]+$/).max(100) }).strict()
const recordKey = z.string().regex(/^[0-9a-f]{64}$/)

export function registerMediaCacheIpc(): void {
  const manager = getMediaCacheManager()
  const render = getVideoRenderCacheService()
  // 放在程序目录而不是作品目录：条目小而多，是本机观测与可重算结果，不随作品目录走。
  const videoEditRecords = createContentDiskCache({
    directory: () => getProgramStoreDir('videoEditCache'), extension: '.json', budgetBytes: 32 * 1024 ** 2, pruneIntervalMs: 60_000,
    onError: (event, error) => logger.warn('剪辑派生记录缓存操作失败', { event: `media_cache.video_edit.${event}`, error }),
  })
  manager.onChange(() => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(MEDIA_CACHE_CHANNELS.changed) })
  registerIpcHandler(MEDIA_CACHE_CHANNELS.settings, parseVoid, () => manager.readSettings(), assertTrustedApplicationSender)
  registerIpcHandler(MEDIA_CACHE_CHANNELS.setSettings, value => mediaCacheSettingsSchema.partial().strict().parse(value), patch => manager.writeSettings(patch), assertTrustedApplicationSender)
  registerIpcHandler(MEDIA_CACHE_CHANNELS.usage, parseVoid, () => manager.usage(), assertTrustedApplicationSender)
  registerIpcHandler(MEDIA_CACHE_CHANNELS.clear, value => z.object({ category: z.union([mediaCacheCategorySchema, z.literal('all')]) }).strict().parse(value), ({ category }) => manager.clear(category), assertTrustedApplicationSender)
  registerIpcHandler(MEDIA_CACHE_CHANNELS.renderList, value => projectRequest.parse(value), async ({ projectId }) => { return render.list(projectId) }, assertTrustedApplicationSender)
  registerIpcHandler(MEDIA_CACHE_CHANNELS.renderBegin, value => videoRenderCacheBeginSchema.parse(value), request => render.begin(request.projectId, request.windowKey, request.profile), assertTrustedApplicationSender)
  registerIpcHandler(MEDIA_CACHE_CHANNELS.renderCommit, value => videoRenderCacheCommitSchema.parse(value), async request => { const entry = await render.commit(request.temporaryPath, request.entry); return entry }, assertTrustedApplicationSender)
  registerIpcHandler(MEDIA_CACHE_CHANNELS.renderDiscard, value => z.object({ temporaryPath: z.string().min(1).max(32768) }).strict().parse(value), ({ temporaryPath }) => render.discard(temporaryPath), assertTrustedApplicationSender)
  registerIpcHandler(MEDIA_CACHE_CHANNELS.renderRemove, value => videoRenderCacheRemoveSchema.parse(value), async request => {
    const removed = await render.remove(request)
    if (removed) logger.info('预渲染文件已回收', { event: 'media_cache.render.removed', context: { projectId: request.projectId, removed } })
    return removed
  }, assertTrustedApplicationSender)
  registerIpcHandler(MEDIA_CACHE_CHANNELS.hardware, parseVoid, () => getHardwareCapabilitiesService().read(), assertTrustedApplicationSender)
  registerIpcHandler(MEDIA_CACHE_CHANNELS.detectHardware, value => z.object({ encode: z.array(hardwareEncodeResultSchema).max(8) }).strict().parse(value), ({ encode }) => getHardwareCapabilitiesService().detect(encode), assertTrustedApplicationSender)
  registerIpcHandler(MEDIA_CACHE_CHANNELS.videoEditRead, value => z.object({ key: recordKey }).strict().parse(value), async ({ key }) => {
    const bytes = await videoEditRecords.read(key)
    return bytes ? Buffer.from(bytes).toString('utf8') : null
  }, assertTrustedApplicationSender)
  registerIpcHandler(MEDIA_CACHE_CHANNELS.videoEditWrite, value => z.object({ key: recordKey, text: z.string() }).strict().parse(value), ({ key, text }) => videoEditRecords.write(key, Buffer.from(text, 'utf8')), assertTrustedApplicationSender)
  // 启动维护放到界面起来之后，不与首屏争磁盘。
  const timer = setTimeout(() => { void manager.startupMaintenance().catch(error => logger.warn('缓存启动维护失败', { event: 'media_cache.startup.failed', error })) }, 15_000)
  app.once('before-quit', () => { clearTimeout(timer); manager.stop() })
}
