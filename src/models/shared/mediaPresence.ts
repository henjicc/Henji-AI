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
 * 这几个函数统一查三个键，跨 kie/ppio/fal/modelscope 各 provider 通用。注意：这里只服务于
 * visible.condition/linkage/pricing 这类"非序列化、直接走模块引用"的函数；request.builder 会被
 * scripts/generate-model-manifest.cjs 单独序列化进独立 VM 执行，不能依赖这个模块的 import，
 * builder 内部该用哪个键（通常只需要 uploadedFilePaths/uploadedVideoFilePaths 这两个生成时键）
 * 应该继续在 builder 函数体内部就地判断。
 */

function firstNonEmptySource(candidates: DynamicValue[]): DynamicValue[] | null {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate
  }
  return null
}

export function countUploadedImages(params: DynamicValueMap): number {
  return firstNonEmptySource([params.uploadedFilePaths, params.images, params.uploadedImages])?.length ?? 0
}

export function countUploadedVideos(params: DynamicValueMap): number {
  return firstNonEmptySource([params.uploadedVideoFilePaths, params.videos, params.uploadedVideos])?.length ?? 0
}

export function hasUploadedImage(params: DynamicValueMap): boolean {
  return countUploadedImages(params) > 0
}

export function hasUploadedVideo(params: DynamicValueMap): boolean {
  return countUploadedVideos(params) > 0
}
