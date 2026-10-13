import { createLogger } from '@/core/logging'
import type { ClipboardFileEntry, ClipboardImage } from '@/platform/contracts/clipboard'
import { getPlatform } from '@/platform/runtime'

const logger = createLogger('commands.clipboard')

export async function writeClipboardText(text: string): Promise<void> { await getPlatform().clipboard.writeText(text) }

/** 只读文件路径及元数据。需要导入时走统一媒体导入入口，由 largeUploadPolicy 决定复制/引用。 */
export async function readClipboardFiles(): Promise<ClipboardFileEntry[]> {
  logger.debug('clipboard.read_files.start')
  try {
    const files = await getPlatform().clipboard.readClipboardFiles()
    logger.debug('clipboard.read_files.completed', { count: files.length })
    return files
  } catch (error) {
    logger.warn('clipboard.read_files.failed', { error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

/**
 * 主动从剪贴板取一张图片（截图位图或复制的图片文件都覆盖）。
 *
 * 与浏览器 `paste` 事件的区别：`paste` 是被动的，只有用户按 Ctrl+V 才触发；
 * 这个命令可以由按钮主动调用，用来把"粘贴剪贴板图片"做成可发现的显式入口。
 * 剪贴板里没有图片时返回 null，不抛错。
 */
export async function readClipboardImage(): Promise<ClipboardImage | null> {
  try {
    const image = await getPlatform().clipboard.readImage()
    logger.debug('clipboard.read_image.completed', {
      found: Boolean(image),
      origin: image?.origin,
    })
    return image
  } catch (error) {
    logger.warn('clipboard.read_image.failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
