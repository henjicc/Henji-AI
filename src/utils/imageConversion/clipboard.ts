/**
 * 从剪贴板事件中提取所有图片文件
 * 支持两种粘贴方式:
 * 1. 网页右击"复制图片" - clipboardData.items 包含 image blob
 * 2. 文件管理器复制图片文件 - clipboardData.items 包含 file 对象
 */
export async function extractImagesFromClipboard(e: ClipboardEvent): Promise<File[]> {
  const files: File[] = []
  const items = e.clipboardData?.items

  if (!items) {
    return files
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile()
      if (blob) {
        if (blob instanceof File) {
          files.push(blob)
        } else {
          const file = new File([blob], `pasted-image-${Date.now()}.${item.type.split('/')[1] || 'png'}`, {
            type: item.type
          })
          files.push(file)
        }
      }
    } else if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file && file.type.startsWith('image/')) {
        files.push(file)
      }
    }
  }

  return files
}

