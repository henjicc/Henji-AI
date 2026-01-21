/**
 * 文件格式转换工具
 *
 * 提供 File、Base64、Blob、URL 之间的转换
 */

/**
 * 将 File 转换为 Base64
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to read file as base64'))
      }
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * 将 Base64 转换为 Blob
 */
export function base64ToBlob(base64: string, mimeType: string = 'image/png'): Blob {
  // 移除 data URL 前缀（如果有）
  const base64Data = base64.includes(',') ? base64.split(',')[1] : base64

  // 解码 Base64
  const byteCharacters = atob(base64Data)
  const byteNumbers = new Array(byteCharacters.length)

  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }

  const byteArray = new Uint8Array(byteNumbers)
  return new Blob([byteArray], { type: mimeType })
}

/**
 * 将 Blob 转换为 File
 */
export function blobToFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: blob.type })
}
