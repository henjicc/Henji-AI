import type { JsonValue, JsonObject } from '../../types/runtime'

export type PpioModelParams = JsonObject

function filterMediaSources(values: JsonValue): string[] {
  return Array.isArray(values)
    ? values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function resolvePreferredSources(primary: JsonValue, fallback: JsonValue): string[] {
  const preferred = filterMediaSources(primary)
  return preferred.length > 0 ? preferred : filterMediaSources(fallback)
}

export function resolvePpioImageSources(params: PpioModelParams): string[] {
  return resolvePreferredSources(params.uploadedFilePaths, params.images)
}

export function resolvePpioVideoSources(params: PpioModelParams): string[] {
  return resolvePreferredSources(params.uploadedVideoFilePaths, params.videos)
}

export function resolvePpioPrimaryVideoSource(params: PpioModelParams): string | undefined {
  const preferred = resolvePpioVideoSources(params)
  if (preferred.length > 0) {
    return preferred[0]
  }

  const legacyVideo = params.video
  return typeof legacyVideo === 'string' && legacyVideo.trim().length > 0
    ? legacyVideo
    : undefined
}

// "是否已上传图片/视频"的三键统一判断逻辑是跨 provider 通用的，实现集中在
// ../shared/mediaPresence；这里只是按既有的"模型文件从 ./mediaSources 取工具函数"
// 的约定做一层重导出，避免 ppio 目录下的调用方各自再写一遍 import 路径。
export {
  countUploadedImages,
  countUploadedVideos,
  hasUploadedImage,
  hasUploadedVideo,
  resolveUploadedVideoDurationSeconds,
} from '../shared/mediaPresence'
