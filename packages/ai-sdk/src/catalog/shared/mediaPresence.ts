/**
 * "是否已上传图片/视频" 在三种执行场景里活在三个不同键名下：
 * - 生成提交时（GenerationService 注入运行时参数后）：uploadedFilePaths / uploadedVideoFilePaths
 * - 画布节点媒体行的实时值（NodeInputRows/NodeParamRows 的 values）：images / videos
 * - 对话/工具面板的实时上传状态（ParameterPanel 的 runtimeValues）：uploadedImages / uploadedVideos
 *
 * visible.condition、linkage.condition、pricing.calculator 这类"运行时直接读取活参数"的函数
 * 会在以上三种场景都被调用到，只查其中一个键会导致另外两个场景判断错误（典型表现：某个参数该
 * 隐藏却没隐藏、模式自动切换在画布里完全不触发、计价该按"有视频"算却按"无视频"算）。
 *
 * 这几个函数统一查三个键，跨 kie/ppio/fal/modelscope 各 provider 通用。
 */

import type { JsonValue, JsonObject } from '../../types/runtime'

function cleanMediaSources(candidate: JsonValue): string[] {
  if (!Array.isArray(candidate)) return []

  return candidate.flatMap((item) => {
    if (typeof item !== 'string') return []
    const source = item.trim()
    return source.length > 0 ? [source] : []
  })
}

function richestMediaSources(candidates: JsonValue[]): string[] {
  let resolved: string[] = []
  for (const candidate of candidates) {
    const sources = cleanMediaSources(candidate)
    if (sources.length > resolved.length) resolved = sources
  }
  return resolved
}

function maxMediaSourceCount(candidates: JsonValue[]): number {
  let count = 0
  for (const candidate of candidates) {
    count = Math.max(count, cleanMediaSources(candidate).length)
  }
  return count
}

export function resolveUploadedImageSources(params: JsonObject): string[] {
  return richestMediaSources([params.uploadedFilePaths, params.images, params.uploadedImages])
}

export function resolveUploadedVideoSources(params: JsonObject): string[] {
  return richestMediaSources([params.uploadedVideoFilePaths, params.videos, params.uploadedVideos])
}

export function countUploadedImages(params: JsonObject): number {
  return maxMediaSourceCount([params.uploadedFilePaths, params.images, params.uploadedImages])
}

export function countUploadedVideos(params: JsonObject): number {
  return maxMediaSourceCount([params.uploadedVideoFilePaths, params.videos, params.uploadedVideos])
}

function cleanPositiveDurations(candidate: JsonValue): number[] {
  if (!Array.isArray(candidate)) return []
  return candidate.flatMap((item) => (
    typeof item === 'number' && Number.isFinite(item) && item > 0 ? [item] : []
  ))
}

/**
 * 返回所有视频输入的计费总时长。完整逐段时长优先，其次使用宿主给出的总时长；
 * 旧宿主只有首段时长时保留“首段 × 数量”的兼容估算，最后才使用调用方声明的单段兜底。
 */
export function resolveUploadedVideoDurationSeconds(
  params: JsonObject,
  fallbackPerVideoSeconds = 0
): number {
  const videoCount = countUploadedVideos(params)
  if (videoCount === 0) return 0

  const durations = cleanPositiveDurations(params.__videoDurationSeconds)
  if (durations.length === videoCount) {
    return durations.reduce((total, duration) => total + duration, 0)
  }

  const totalDuration = params.__totalVideoDurationSeconds
  if (typeof totalDuration === 'number' && Number.isFinite(totalDuration) && totalDuration > 0) {
    return totalDuration
  }

  const firstDuration = params.__firstVideoDurationSeconds
  if (typeof firstDuration === 'number' && Number.isFinite(firstDuration) && firstDuration > 0) {
    return firstDuration * videoCount
  }

  const fallback = Number.isFinite(fallbackPerVideoSeconds) && fallbackPerVideoSeconds > 0
    ? fallbackPerVideoSeconds
    : 0
  return fallback * videoCount
}

export function hasUploadedImage(params: JsonObject): boolean {
  return countUploadedImages(params) > 0
}

export function hasUploadedVideo(params: JsonObject): boolean {
  return countUploadedVideos(params) > 0
}
