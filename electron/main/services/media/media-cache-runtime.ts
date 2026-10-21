import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getProgramDataDir, getProgramStoreDir, getUserDataLayout } from '../appPaths'
import { createMainLogger } from '../logging'
import { getSettingsStore } from '../settings/store'
import { MediaCacheManager } from './media-cache'

const logger = createMainLogger('main.media_cache')

/** 旧版缓存目录（程序目录与 userData 下）；迁到作品目录缓存后启动时删一次，不搬迁。 */
function legacyDirectories(): string[] {
  const program = getProgramDataDir()
  const directories = [
    path.join(program, 'video-edit-render-cache'), path.join(program, 'cache', 'video-proxies'),
    path.join(program, 'scene-detection'), path.join(program, 'speech-energy'), getProgramStoreDir('smartRegions'),
  ]
  try { directories.push(path.join(app.getPath('userData'), 'HenjiCache')) } catch { /* userData unavailable in tests */ }
  // 口播的解码与处理缓存原在 AudioEdit/<文档>/cache；同目录的任务回执留在程序目录。
  const audioEdit = getProgramStoreDir('audioEdit')
  try { for (const name of fs.readdirSync(audioEdit)) if (/^[\w-]+$/.test(name)) directories.push(path.join(audioEdit, name, 'cache')) } catch { /* none */ }
  return directories
}

let manager: MediaCacheManager | undefined
export function getMediaCacheManager(): MediaCacheManager {
  manager ??= new MediaCacheManager({
    userRoot: () => { const layout = getUserDataLayout(); return { root: layout.root, locale: layout.locale } },
    settings: getSettingsStore(),
    legacyDirectories,
    liveDocumentIds: async kind => {
      try {
        const { getDocumentService } = await import('../documents/runtime')
        return new Set((await getDocumentService().listDocuments({ kind })).map(document => document.id))
      } catch (error) {
        logger.warn('读取文档列表失败，跳过孤儿缓存检查', { event: 'media_cache.orphans.skipped', error })
        return undefined
      }
    },
    logger,
  })
  return manager
}
