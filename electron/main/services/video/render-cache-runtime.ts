import { registerDocumentProgramStateCleaner } from '../documents/program-state-cleaners'
import { createMainLogger } from '../logging'
import { getMediaCacheManager } from '../media/media-cache-runtime'
import { VideoRenderCacheService } from './render-cache'

const logger = createMainLogger('main.video.render_cache')
let service: VideoRenderCacheService | undefined
export function getVideoRenderCacheService(): VideoRenderCacheService {
  if (service) return service
  const manager = getMediaCacheManager()
  const onError = (event: string, error: unknown): void => logger.warn('预渲染缓存操作失败', { event: `video.render_cache.${event}`, error })
  // 预渲染文件只受缓存管理的总上限与保留天数约束。
  const created = new VideoRenderCacheService(
    manager.createCache('render', undefined, { extension: '.mp4', budgetBytes: Number.POSITIVE_INFINITY, onError }),
    manager.createCache('render', undefined, { extension: '.json', budgetBytes: 64 * 1024 ** 2, onError }),
    () => manager.categoryDirectory('render'),
  )
  manager.registerOrphanCollector(async live => live.video_edit ? created.removeOrphans(live.video_edit) : 0)
  // 剪辑离开作品（回收站、删除）时回收它的预渲染文件。
  registerDocumentProgramStateCleaner('video_edit_render_cache', async docId => {
    if (!/^[\w-]+$/.test(docId)) return
    const removed = await created.remove({ projectId: docId })
    if (removed) logger.info('剪辑已删除，预渲染文件已回收', { event: 'video.render_cache.document_removed', context: { docId, removed } })
  })
  service = created
  return created
}
