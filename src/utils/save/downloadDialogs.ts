import { createLogger } from '@/core/logging'
import { join, readFile, saveDialog, writeFile } from '@/platform/desktopApi'

const logger = createLogger('utils.save.downloadDialogs')

function getFileExtension(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() || ''
  const match = fileName.match(/\.([^.]+)$/)
  return match ? match[1].toLowerCase() : ''
}

function ensureExtension(fileName: string, extension: string): string {
  const ext = extension.startsWith('.') ? extension : `.${extension}`
  const lowerFileName = fileName.toLowerCase()
  const lowerExt = ext.toLowerCase()

  if (lowerFileName.endsWith(lowerExt)) return fileName
  return fileName + ext
}

export async function downloadAudioFile(sourcePath: string, suggestedName?: string): Promise<string> {
  const name = suggestedName ?? (sourcePath.split(/[\\/]/).pop() || `audio-${Date.now()}.mp3`)
  const ext = getFileExtension(sourcePath) || 'mp3'

  const filters = [{ name: '音频文件', extensions: [ext] }]

  const target = await saveDialog({
    defaultPath: name,
    filters
  }) as string | null

  if (!target) throw new Error('cancelled')

  const finalTarget = ensureExtension(target, ext)

  const bytes = await readFile(sourcePath)
  await writeFile(finalTarget, bytes)

  logger.info('[save] 音频文件已保存:', finalTarget)
  return finalTarget
}

export async function downloadMediaFile(sourcePath: string, suggestedName?: string): Promise<string> {
  const name = suggestedName ?? (sourcePath.split(/[\\/]/).pop() || `media-${Date.now()}`)
  const ext = getFileExtension(sourcePath)

  if (!ext) {
    throw new Error('无法确定文件类型')
  }

  let filterName = '媒体文件'
  const extensions = [ext]

  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
    filterName = '图片文件'
  } else if (['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
    filterName = '视频文件'
  } else if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'pcm'].includes(ext)) {
    filterName = '音频文件'
  }

  const filters = [{ name: filterName, extensions }]

  const target = await saveDialog({
    defaultPath: name,
    filters
  }) as string | null

  if (!target) throw new Error('cancelled')

  const finalTarget = ensureExtension(target, ext)

  const bytes = await readFile(sourcePath)
  await writeFile(finalTarget, bytes)

  logger.info('[save] 媒体文件已保存:', finalTarget)
  return finalTarget
}

export async function quickDownloadMediaFile(sourcePath: string, targetDir: string, suggestedName?: string): Promise<string> {
  try {
    logger.info('[save] 快速下载开始:', { sourcePath, targetDir, suggestedName })

    if (!sourcePath) {
      throw new Error('源文件路径为空')
    }

    if (!targetDir) {
      throw new Error('目标目录路径为空，请先在设置中配置快速下载路径')
    }

    const name = suggestedName ?? (sourcePath.split(/[\\/]/).pop() || `media-${Date.now()}`)
    logger.info('[save] 目标文件名:', name)

    const target = await join(targetDir, name)
    logger.info('[save] 完整目标路径:', target)

    try {
      const bytes = await readFile(sourcePath)
      logger.info('[save] 源文件读取成功，大小:', { data: [bytes.length, 'bytes'] })

      await writeFile(target, bytes)
      logger.info('[save] 快速下载成功保存到:', target)

      return target
    } catch (error) {
      logger.error('[save] 文件操作失败:', error)
      if (error instanceof Error) {
        throw new Error(`文件保存失败: ${error.message}`)
      }
      throw new Error('文件保存失败')
    }
  } catch (error) {
    logger.error('[save] 快速下载失败:', error)
    throw error
  }
}


