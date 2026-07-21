export type KieModelParams = DynamicValueMap

function filterMediaSources(values: DynamicValue): string[] {
  return Array.isArray(values)
    ? values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function resolvePreferredSources(primary: DynamicValue, fallback: DynamicValue): string[] {
  const preferred = filterMediaSources(primary)
  return preferred.length > 0 ? preferred : filterMediaSources(fallback)
}

export function resolveKieImageSources(params: KieModelParams): string[] {
  return resolvePreferredSources(params.uploadedFilePaths, params.images)
}

export function resolveKieVideoSources(params: KieModelParams): string[] {
  return resolvePreferredSources(params.uploadedVideoFilePaths, params.videos)
}

export function resolveKiePrimaryVideoSource(params: KieModelParams): string | undefined {
  const preferred = resolveKieVideoSources(params)
  if (preferred.length > 0) {
    return preferred[0]
  }

  const legacyVideo = params.video
  return typeof legacyVideo === 'string' && legacyVideo.trim().length > 0
    ? legacyVideo
    : undefined
}

// "是否已上传图片/视频"的三键统一判断逻辑是跨 provider 通用的，实现集中在
// src/models/shared/mediaPresence.ts；这里只是按既有的"模型文件从 ./mediaSources 取工具函数"
// 的约定做一层重导出，避免 kie 目录下的调用方各自再写一遍 import 路径。
export { countUploadedImages, countUploadedVideos, hasUploadedImage, hasUploadedVideo } from '@/models/shared/mediaPresence'
