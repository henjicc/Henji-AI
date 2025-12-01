import { fal } from '@fal-ai/client'

/**
 * 将 data URI 转换为 Blob
 * @param dataUri - data URI 字符串
 * @returns Blob 对象
 */
function dataURItoBlob(dataUri: string): Blob {
  const arr = dataUri.split(',')
  const mimeMatch = arr[0].match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)

  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }

  return new Blob([u8arr], { type: mime })
}

/**
 * 上传单个文件到 fal CDN
 * @param image - 图片（可能是 base64 data URI 或 URL）
 * @param apiKey - fal API key
 * @returns fal CDN URL
 */
export async function uploadToFalCDN(image: string, apiKey: string): Promise<string> {
  // 1. 如果已经是 HTTP/HTTPS URL，直接返回
  if (image.startsWith('http://') || image.startsWith('https://')) {
    console.log('[falUpload] 图片已是 URL，跳过上传')
    return image
  }

  // 配置 fal 客户端
  fal.config({
    credentials: apiKey
  })

  // 2. 如果是 base64 data URI，转换为 Blob 后上传
  if (image.startsWith('data:')) {
    try {
      console.log('[falUpload] 检测到 base64 图片，开始上传到 fal CDN...')
      const blob = dataURItoBlob(image)
      const url = await fal.storage.upload(blob)
      console.log('[falUpload] 上传成功，获得 URL:', url)
      return url
    } catch (error) {
      console.error('[falUpload] 上传失败:', error)
      throw error
    }
  }

  // 3. 如果是纯 base64 字符串（没有 data: 前缀），添加前缀后上传
  try {
    console.log('[falUpload] 检测到纯 base64 字符串，添加前缀后上传...')
    const dataUri = `data:image/jpeg;base64,${image}`
    const blob = dataURItoBlob(dataUri)
    const url = await fal.storage.upload(blob)
    console.log('[falUpload] 上传成功，获得 URL:', url)
    return url
  } catch (error) {
    console.error('[falUpload] 上传失败:', error)
    throw error
  }
}

/**
 * 批量上传文件到 fal CDN
 * @param images - 图片数组
 * @param apiKey - fal API key
 * @returns fal CDN URL 数组
 */
export async function uploadMultipleToFalCDN(
  images: string[],
  apiKey: string
): Promise<string[]> {
  if (!images || images.length === 0) {
    return []
  }

  console.log(`[falUpload] 准备上传 ${images.length} 张图片到 fal CDN...`)

  // 并行上传所有图片
  const uploadedUrls = await Promise.all(
    images.map((img, index) => {
      console.log(`[falUpload] 上传第 ${index + 1}/${images.length} 张图片...`)
      return uploadToFalCDN(img, apiKey)
    })
  )

  console.log(`[falUpload] 所有图片上传完成，共 ${uploadedUrls.length} 张`)
  return uploadedUrls
}
