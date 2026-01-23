/**
 * 响应解析工具
 * 职责：解析 Fal API 响应
 */

export function parseResponse(response: any) {
  // 解析响应
  // TODO: 实现具体的响应解析逻辑
  return response
}

export function extractMediaUrl(response: any): string | null {
  // 提取媒体 URL
  if (response.images && response.images.length > 0) {
    return response.images[0].url
  }
  if (response.video && response.video.url) {
    return response.video.url
  }
  if (response.audio && response.audio.url) {
    return response.audio.url
  }
  return null
}
