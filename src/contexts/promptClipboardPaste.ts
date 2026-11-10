import { readClipboardFiles, readClipboardImage } from '@/commands/clipboard'
import { isDesktopRuntime } from '@/platform/runtime'

/** 通知生成页提示词导入剪贴板图片的事件（useGlobalPasteImage 监听） */
const PASTE_IMAGE_EVENT = 'globalPasteImage'

/**
 * 剪贴板里有图片时交给生成页提示词的图片导入（与 Ctrl+V 同一入口），返回是否已处理。
 * 桌面端文件只传路径；没有文件路径的截图才读位图。浏览器宿主用浏览器剪贴板。
 */
export async function pasteClipboardImageToPrompt(): Promise<boolean> {
  if (isDesktopRuntime()) {
    const files = await readClipboardFiles()
    const images = files.filter(file => file.mimeType.startsWith('image/'))
    if (images.length) {
      window.dispatchEvent(new CustomEvent(PASTE_IMAGE_EVENT, { detail: { clipboardPaths: images } }))
      return true
    }
    const image = files.length === 0 ? await readClipboardImage() : null
    if (image) {
      window.dispatchEvent(new CustomEvent(PASTE_IMAGE_EVENT, { detail: { clipboardFiles: [{ data: image.dataUrl, name: image.name }] } }))
      return true
    }
    return false
  }
  for (const item of await navigator.clipboard.read()) {
    const imageType = item.types.find(type => type.startsWith('image/'))
    if (!imageType) continue
    const blob = await item.getType(imageType)
    if (blob && blob.size > 0) {
      window.dispatchEvent(new CustomEvent(PASTE_IMAGE_EVENT, { detail: { imageBlob: blob, imageType } }))
      return true
    }
  }
  return false
}
