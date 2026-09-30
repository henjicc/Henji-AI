import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.video_preview')
/** Remove only the retired encoder's derived files, never project/source media. */
export async function clearLegacyVideoPreviewCache(userData = app.getPath('userData')): Promise<void> {
  try {
    const root = await fs.realpath(userData)
    const expected = path.join(root, 'cache', 'video-edit-preview')
    const directory = await fs.realpath(expected)
    if (path.relative(expected, directory) !== '') throw new Error('旧预览缓存目录边界无效。')
    let bytes = 0; let files = 0
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[\da-f]{64}(?:-[\da-f-]{36}\.partial)?\.mp4$/i.test(entry.name)) continue
      const file = path.join(directory, entry.name)
      const stat = await fs.lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink()) continue
      await fs.unlink(file); bytes += stat.size; files++
    }
    if (files) logger.info('已释放旧视频预览占用', { event: 'video_preview.cleanup.completed', context: { files, bytes } })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    logger.warn('旧视频预览清理失败', { event: 'video_preview.cleanup.failed', error })
  }
}
