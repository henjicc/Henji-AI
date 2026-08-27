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

function firstNonEmptySource(candidates: JsonValue[]): JsonValue[] | null {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate
  }
  return null
}

export function countUploadedImages(params: JsonObject): number {
  return firstNonEmptySource([params.uploadedFilePaths, params.images, params.uploadedImages])?.length ?? 0
}

export function countUploadedVideos(params: JsonObject): number {
  return firstNonEmptySource([params.uploadedVideoFilePaths, params.videos, params.uploadedVideos])?.length ?? 0
}

export function hasUploadedImage(params: JsonObject): boolean {
  return countUploadedImages(params) > 0
}

export function hasUploadedVideo(params: JsonObject): boolean {
  return countUploadedVideos(params) > 0
}
