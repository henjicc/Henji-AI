export async function dataUrlToFile(dataUrl: string, filename: string = 'image.jpg'): Promise<File> {
  // 直接转换 data URL 为 Blob（不使用 fetch，兼容 Tauri 生产环境）
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

  // Handle file paths (convert to blob first)
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

