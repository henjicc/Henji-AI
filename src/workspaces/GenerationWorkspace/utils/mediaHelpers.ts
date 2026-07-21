/**
 * 媒体辅助函数
 * 职责：提供媒体处理的辅助功能
 */

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

/**
 * 格式化时长
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * 检查是否为图片文件
 */
export function isImageFile(filename: string): boolean {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'))
  return imageExtensions.includes(ext)
}

/**
 * 检查是否为视频文件
 */
export function isVideoFile(filename: string): boolean {
  const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv']
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'))
  return videoExtensions.includes(ext)
}

/**
 * 检查是否为音频文件
 */
export function isAudioFile(filename: string): boolean {
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'))
  return audioExtensions.includes(ext)
}

/**
 * 获取文件扩展名
 */
export function getFileExtension(filename: string): string {
  return filename.substring(filename.lastIndexOf('.') + 1).toLowerCase()
}

/**
 * 生成缩略图 URL
 */
export function generateThumbnailUrl(url: string, _width: number = 200): string {
  // 这里可以根据实际需求实现缩略图生成逻辑
  // 目前直接返回原 URL
  return url
}
