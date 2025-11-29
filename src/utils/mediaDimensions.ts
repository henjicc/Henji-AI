/**
 * 媒体尺寸和时长获取工具
 * 从实际文件中获取图片、视频、音频的真实尺寸和时长
 */

/**
 * 从图片 URL 获取尺寸
 */
export const getImageDimensions = (url: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

/**
 * 从视频 URL 获取尺寸和时长
 */
export const getVideoDimensions = (url: string): Promise<{ width: number; height: number; duration: number }> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration
      })
    }
    video.onerror = () => {
      reject(new Error('Failed to load video'))
    }
    video.src = url
  })
}

/**
 * 从音频 URL 获取时长
 */
export const getAudioDuration = (url: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio')
    audio.onloadedmetadata = () => {
      resolve(audio.duration)
    }
    audio.onerror = () => {
      reject(new Error('Failed to load audio'))
    }
    audio.src = url
  })
}

/**
 * 格式化时长（秒转为可读格式）
 * @param seconds 时长（秒）
 * @returns 格式化的时长字符串，如 "6秒"、"1分23秒"、"1小时23分45秒"
 */
export const formatDuration = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) {
    return '0秒'
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    // 有小时：X小时X分X秒
    return `${hours}小时${minutes}分${secs}秒`
  } else if (minutes > 0) {
    // 有分钟但没小时：X分X秒
    return `${minutes}分${secs}秒`
  } else {
    // 只有秒：X秒
    return `${secs}秒`
  }
}

/**
 * 从媒体 URL 获取尺寸（自动判断类型）
 * @param url 媒体文件的 URL 或本地路径
 * @param type 媒体类型：'image' | 'video' | 'audio'
 * @returns 格式化的尺寸字符串，如 "1920x1080"
 */
export const getMediaDimensions = async (
  url: string,
  type: 'image' | 'video' | 'audio'
): Promise<string | null> => {
  try {
    // 音频没有尺寸
    if (type === 'audio') {
      return null
    }

    // 如果是本地文件路径（convertFileSrc 格式），需要转换
    let mediaUrl = url
    if (url.startsWith('http://asset.localhost/')) {
      // 已经是 convertFileSrc 格式，直接使用
      mediaUrl = url
    } else if (url.startsWith('file://') || url.startsWith('/') || url.match(/^[A-Z]:\\/)) {
      // 本地文件路径，需要转换
      const { convertFileSrc } = await import('@tauri-apps/api/core')
      mediaUrl = convertFileSrc(url)
    }

    // 根据类型获取尺寸
    const dimensions = type === 'image'
      ? await getImageDimensions(mediaUrl)
      : await getVideoDimensions(mediaUrl)

    return `${dimensions.width}x${dimensions.height}`
  } catch (error) {
    console.error('[mediaDimensions] Failed to get dimensions:', error)
    return null
  }
}

/**
 * 从媒体 URL 获取时长
 * @param url 媒体文件的 URL 或本地路径
 * @param type 媒体类型：'image' | 'video' | 'audio'
 * @returns 格式化的时长字符串，如 "1:23"
 */
export const getMediaDurationFormatted = async (
  url: string,
  type: 'image' | 'video' | 'audio'
): Promise<string | null> => {
  try {
    // 图片没有时长
    if (type === 'image') {
      return null
    }

    // 如果是本地文件路径（convertFileSrc 格式），需要转换
    let mediaUrl = url
    if (url.startsWith('http://asset.localhost/')) {
      // 已经是 convertFileSrc 格式，直接使用
      mediaUrl = url
    } else if (url.startsWith('file://') || url.startsWith('/') || url.match(/^[A-Z]:\\/)) {
      // 本地文件路径，需要转换
      const { convertFileSrc } = await import('@tauri-apps/api/core')
      mediaUrl = convertFileSrc(url)
    }

    // 根据类型获取时长
    const duration = type === 'video'
      ? (await getVideoDimensions(mediaUrl)).duration
      : await getAudioDuration(mediaUrl)

    return formatDuration(duration)
  } catch (error) {
    console.error('[mediaDimensions] Failed to get duration:', error)
    return null
  }
}

/**
 * 格式化尺寸字符串（添加分辨率标签）
 * @param dimensions 尺寸字符串，如 "1920x1080"
 * @returns 带标签的尺寸，如 "1920x1080 (1080P)"
 */
export const formatDimensions = (dimensions: string): string => {
  const [width, height] = dimensions.split('x').map(Number)

  if (isNaN(width) || isNaN(height)) {
    return dimensions
  }

  // 添加常见分辨率标签
  const maxDimension = Math.max(width, height)
  let label = ''

  if (maxDimension >= 3840) {
    label = ' (4K)'
  } else if (maxDimension >= 2560) {
    label = ' (2K)'
  } else if (maxDimension >= 1920) {
    label = ' (1080P)'
  } else if (maxDimension >= 1280) {
    label = ' (720P)'
  } else if (maxDimension >= 854) {
    label = ' (480P)'
  }

  return `${dimensions}${label}`
}
