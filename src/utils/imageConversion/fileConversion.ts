export async function dataUrlToFile(dataUrl: string, filename: string = 'image.jpg'): Promise<File> {
  // 直接转换 data URL 为 Blob（不使用 fetch，兼容桌面生产环境）
  const parts = dataUrl.split(',')
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg'
  const bstr = atob(parts[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  const blob = new Blob([u8arr], { type: mime })
  return new File([blob], filename, { type: mime })
}

export async function urlToFile(url: string, filename: string = 'image.jpg'): Promise<File> {
  // Handle both blob: and data: URLs
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    return dataUrlToFile(url, filename)
  }

  // fetch 不认 file:// 与 D:\... 裸路径，只会抛无定位价值的 "Failed to fetch"。
  // 本文件属于 utils（保持纯函数、不依赖 services），因此这里只负责把修复方式写进
  // 错误信息，转换由调用方用 toFetchableMediaUrl() 完成。
  if (/^file:\/\//i.test(url) || /^(?:[A-Za-z]:[\\/]|\\\\)/.test(url)) {
    throw new Error(
      `urlToFile 不能直接读取本地路径（${url.slice(0, 60)}）：`
        + '调用方需先用 toFetchableMediaUrl() 转成 henji-media:// 再传入。'
    )
  }

  const response = await fetch(url)
  const blob = await response.blob()
  return new File([blob], filename, { type: blob.type || 'image/jpeg' })
}

export async function convertBlobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') {
    return blob
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('Failed to get canvas context'))
        return
      }
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((pngBlob) => {
        URL.revokeObjectURL(url)
        if (pngBlob) {
          resolve(pngBlob)
        } else {
          reject(new Error('Failed to convert to PNG'))
        }
      }, 'image/png')
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image for conversion'))
    }

    img.src = url
  })
}
