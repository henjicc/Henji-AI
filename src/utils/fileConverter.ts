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

