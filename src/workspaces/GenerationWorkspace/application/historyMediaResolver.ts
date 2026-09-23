import { exists, join, toDisplaySrc } from '@/platform/desktopApi'
import { grantMediaAccessForReference } from '@/services/largeUploadPolicy'
import { getHistoryThumbnailCachePath } from '@/utils/historyThumbnail'

type MediaKind = 'image' | 'video' | 'audio'

/** 一次历史加载共享结果；下次加载重新检查文件、权限和数据目录。 */
export function createHistoryMediaResolver(dataRoot: string) {
  const resolutions = new Map<string, Promise<string | null>>()
  let thumbnailsDir: Promise<string> | undefined
  let active = 0
  const waiters = new Set<() => void>()

  async function resolveOne(filePath: string, kind: MediaKind): Promise<string | null> {
    if (active >= 8) await new Promise<void>((resolve) => waiters.add(resolve))
    else active++
    try {
      if (!await exists(filePath)) return null
      try {
        await grantMediaAccessForReference(filePath)
        if (kind === 'image') {
          try {
            thumbnailsDir ??= join(dataRoot, 'Thumbnails')
            const cachePath = await getHistoryThumbnailCachePath(filePath, await thumbnailsDir)
            if (await exists(cachePath)) return toDisplaySrc(cachePath.replace(/\\/g, '/'))
          } catch {
            // 缓存不可用仍使用原图，与原加载契约一致。
          }
        }
        return toDisplaySrc(filePath.replace(/\\/g, '/'))
      } catch {
        return null
      }
    } finally {
      const next = waiters.values().next().value
      if (next) { waiters.delete(next); next() }
      else active--
    }
  }

  return async (paths: string[], kind: MediaKind) => {
    const resolved = await Promise.all(paths.map((filePath) => {
      const key = `${kind}:${filePath}`
      let resolution = resolutions.get(key)
      if (!resolution) {
        resolution = resolveOne(filePath, kind)
        resolutions.set(key, resolution)
      }
      return resolution
    }))
    const urls = resolved.filter((url): url is string => url !== null)
    return { urls, skippedCount: resolved.length - urls.length }
  }
}
