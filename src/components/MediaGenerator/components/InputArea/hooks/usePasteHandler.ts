import { useCallback } from 'react'

/**
 * 粘贴处理
 * 职责：处理剪贴板粘贴图片逻辑
 */
export const usePasteHandler = (
  onImageUpload: (files: File[]) => void
) => {
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    const files: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile()
        if (file) {
          files.push(file)
        }
      }
    }

    if (files.length > 0) {
      onImageUpload(files)
    }
  }, [onImageUpload])

  return { handlePaste }
}
