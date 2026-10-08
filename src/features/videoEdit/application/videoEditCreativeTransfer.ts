import { videoEditCreativeSourceRequestSchema, type VideoEditCreativeSourceRequest } from '@/core/videoEdit/creativeResult'
import { assertVideoEditResultTarget, commitVideoEditCreativeResult, placeVideoEditResultInProject, videoEditResultOutputFolder, type VideoEditCreativeResult, type VideoEditResultReceipt, type VideoEditResultTarget } from './videoEditResultTarget'
import { prepareVideoEditCreativeResult } from './videoEditCreativeSources'
import { ApplicationTransactionFailure } from '@/core/application-control/execution/transactionFailure'

export interface VideoEditCreativeTransfer { readonly target: VideoEditResultTarget; readonly source: VideoEditCreativeSourceRequest }
const transfers = new WeakMap<VideoEditCreativeTransfer, { busy: boolean; prepared?: VideoEditCreativeResult }>()

export function createVideoEditCreativeTransfer(target: VideoEditResultTarget, source: VideoEditCreativeSourceRequest): VideoEditCreativeTransfer {
  assertVideoEditResultTarget(target)
  const transfer = Object.freeze({ target, source: Object.freeze(videoEditCreativeSourceRequestSchema.parse(source)) })
  transfers.set(transfer, { busy: false })
  return transfer
}
/** Keep completed output on failure; retry never repeats a WAV export or image render. */
export async function runVideoEditCreativeTransfer(transfer: VideoEditCreativeTransfer, signal?: AbortSignal, operationId?: string): Promise<VideoEditResultReceipt> {
  const state = transfers.get(transfer)
  if (!state) throw new Error('请重新选择原创作结果。')
  if (state.busy) throw new Error('此结果正在准备，请等待完成。')
  state.busy = true
  try {
    const assertTarget = (): void => assertVideoEditResultTarget(transfer.target, signal)
    assertTarget()
    // 准备阶段不派发剪辑文档修改；已有文件/资产属于保留的生产结果，不能重生成。
    try {
      state.prepared ??= await prepareVideoEditCreativeResult(transfer.source, { signal, assertTarget, place: path => placeVideoEditResultInProject(transfer.target, path), outputFolder: () => videoEditResultOutputFolder(transfer.target) })
    } catch (error) {
      throw new ApplicationTransactionFailure({ status: 'failed', code: 'EXECUTION_FAILED', message: error instanceof Error ? error.message : String(error), recoverable: true,
        partial: { completedStepIndexes: [], compensatedStepIndexes: [], uncompensatedStepIndexes: [] } })
    }
    assertTarget()
    return await commitVideoEditCreativeResult(transfer.target, state.prepared, signal, operationId)
  } finally { state.busy = false }
}
