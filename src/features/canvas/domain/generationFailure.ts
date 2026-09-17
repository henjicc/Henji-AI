import type { CanvasNodeData } from './canvasNodes'

export const LAYER_STACK_DOWNLOAD_FAILURE_MESSAGE = '图片已生成，但下载未完成。请重试获取结果。'
export const CANVAS_GENERATION_CANCELLED_MESSAGE = '本地任务已停止；供应商是否停止执行尚未确认。'

/** 保留原供应商任务号，只有明确续查才重新获取结果。 */
export function createCanvasGenerationCancelledPatch(): Partial<CanvasNodeData> {
  return { isGenerating: false, generationStartedAt: null, generationCancelled: true, generationError: CANVAS_GENERATION_CANCELLED_MESSAGE }
}

function isLayerDownloadFailureMessage(message: string): boolean {
  return message.includes('[media_download_failed]')
    || message === LAYER_STACK_DOWNLOAD_FAILURE_MESSAGE
    || /^Continue polling failed for [^:]+: terminated$/.test(message)
}

/** 同时识别结构化错误经 IPC 的字符串包装及旧版本已持久化的断流错误。 */
export function isLayerStackDownloadFailure(data: CanvasNodeData): boolean {
  return data.resultKind === 'layer-stack'
    && typeof data.generationError === 'string'
    && isLayerDownloadFailureMessage(data.generationError)
}

/** 下载失败不等于供应商生成失败。保留多图层任务，交给已有续取链路重取结果。 */
export function createCanvasGenerationFailurePatch(
  error: unknown,
  resultKind?: unknown,
): Partial<CanvasNodeData> {
  const message = error instanceof Error ? error.message : String(error)
  const canRetrieveLayers = resultKind === 'layer-stack' && isLayerDownloadFailureMessage(message)
  return {
    isGenerating: false,
    generationStartedAt: null,
    generationError: canRetrieveLayers ? LAYER_STACK_DOWNLOAD_FAILURE_MESSAGE : message,
    ...(canRetrieveLayers ? {} : { serverTaskId: null, serverTaskModelId: null }),
  }
}
