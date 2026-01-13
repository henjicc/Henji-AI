/**
 * 视频处理工具
 * 用于生成视频缩略图、提取元数据和验证视频约束
 */

export interface VideoMetadata {
  duration: number  // 秒
  width: number
  height: number
  aspectRatio: number
  fileSize: number
}

export interface VideoValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * 生成视频缩略图
 * @param videoFile 视频文件
 * @param timeOffset 截图时间点（秒），默认1秒
 * @returns 缩略图的 data URL
 */
export async function generateVideoThumbnail(
  videoFile: File,
  timeOffset: number = 1.0
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true

    const objectUrl = URL.createObjectURL(videoFile)
    video.src = objectUrl

    video.addEventListener('loadedmetadata', () => {
      // 确保时间点不超过视频时长
      const seekTime = Math.min(timeOffset, video.duration - 0.1)
      video.currentTime = seekTime
    })

    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          throw new Error('无法创建 canvas context')
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const thumbnail = canvas.toDataURL('image/jpeg', 0.8)

        // 清理资源
        URL.revokeObjectURL(objectUrl)
        video.remove()

        resolve(thumbnail)
      } catch (error) {
        URL.revokeObjectURL(objectUrl)
        video.remove()
        reject(error)
      }
    })

    video.addEventListener('error', (e) => {
      URL.revokeObjectURL(objectUrl)
      video.remove()
      reject(new Error(`视频加载失败: ${e}`))
    })
  })
}

/**
 * 提取视频元数据
 * @param videoFile 视频文件
 * @returns 视频元数据
 */
export async function getVideoMetadata(videoFile: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true

    const objectUrl = URL.createObjectURL(videoFile)
    video.src = objectUrl

    video.addEventListener('loadedmetadata', () => {
      const metadata: VideoMetadata = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        aspectRatio: video.videoWidth / video.videoHeight,
        fileSize: videoFile.size
      }

      // 清理资源
      URL.revokeObjectURL(objectUrl)
      video.remove()

      resolve(metadata)
    })

    video.addEventListener('error', (e) => {
      URL.revokeObjectURL(objectUrl)
      video.remove()
      reject(new Error(`无法读取视频元数据: ${e}`))
    })
  })
}

/**
 * 验证视频是否符合 Kling O1 的约束
 * @param metadata 视频元数据
 * @returns 验证结果
 */
export interface VideoValidationOptions {
  minDuration?: number
  maxDuration?: number
  minWidth?: number
  maxWidth?: number
  maxSizeMB?: number
}

/**
 * 验证视频是否符合约束
 * @param metadata 视频元数据
 * @param options 验证选项
 * @returns 验证结果
 */
export function validateVideo(
  metadata: VideoMetadata,
  options: VideoValidationOptions = {}
): VideoValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const {
    minDuration = 3,
    maxDuration = 10,
    minWidth = 720,
    maxWidth = 2160,
    maxSizeMB = 200
  } = options

  // 时长验证
  if (metadata.duration < minDuration) {
    errors.push(`视频时长过短（${metadata.duration.toFixed(1)}秒），最少需要${minDuration}秒`)
  } else if (metadata.duration > maxDuration) {
    errors.push(`视频时长过长（${metadata.duration.toFixed(1)}秒），最多支持${maxDuration}秒`)
  }

  // 分辨率验证
  const minDimension = Math.min(metadata.width, metadata.height)
  const maxDimension = Math.max(metadata.width, metadata.height)

  if (minDimension < minWidth) {
    errors.push(`视频分辨率过低（${metadata.width}x${metadata.height}），最小边至少需要${minWidth}px`)
  }

  if (maxDimension > maxWidth) {
    errors.push(`视频分辨率过高（${metadata.width}x${metadata.height}），最大边不能超过${maxWidth}px`)
  }

  // 文件大小验证
  const fileSizeMB = metadata.fileSize / (1024 * 1024)
  if (fileSizeMB > maxSizeMB) {
    errors.push(`文件大小过大（${fileSizeMB.toFixed(1)}MB），最大支持${maxSizeMB}MB`)
  } else if (fileSizeMB > maxSizeMB * 0.75) {
    warnings.push(`文件较大（${fileSizeMB.toFixed(1)}MB），上传可能需要较长时间`)
  }

  // 宽高比警告
  if (metadata.aspectRatio < 0.4 || metadata.aspectRatio > 2.5) {
    warnings.push(`视频宽高比（${metadata.aspectRatio.toFixed(2)}）可能不适合生成，建议使用 0.4-2.5 之间的比例`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * 格式化视频时长为 MM:SS 格式
 * @param seconds 秒数
 * @returns 格式化的时长字符串
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * 检查文件是否为支持的视频格式
 * @param file 文件对象
 * @returns 是否为支持的格式
 */
export function isSupportedVideoFormat(file: File): boolean {
  const supportedTypes = ['video/mp4', 'video/quicktime']  // mp4 和 mov
  const supportedExtensions = ['.mp4', '.mov']

  // 检查 MIME 类型
  if (supportedTypes.includes(file.type)) {
    return true
  }

  // 检查文件扩展名（作为后备）
  const fileName = file.name.toLowerCase()
  return supportedExtensions.some(ext => fileName.endsWith(ext))
}
