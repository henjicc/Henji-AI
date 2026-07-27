import { createLogger } from '@/core/logging'
import type { ClipboardImage } from '@/platform/contracts/clipboard'
import { getPlatform } from '@/platform/runtime'

const logger = createLogger('commands.clipboard')

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
