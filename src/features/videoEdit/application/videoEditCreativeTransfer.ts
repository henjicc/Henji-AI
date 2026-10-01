import { videoEditCreativeSourceRequestSchema, type VideoEditCreativeSourceRequest } from '@/core/videoEdit/creativeResult'
import { assertVideoEditResultTarget, commitVideoEditCreativeResult, type VideoEditCreativeResult, type VideoEditResultReceipt, type VideoEditResultTarget } from './videoEditResultTarget'
import { prepareVideoEditCreativeResult } from './videoEditCreativeSources'

export interface VideoEditCreativeTransfer { readonly target: VideoEditResultTarget; readonly source: VideoEditCreativeSourceRequest }
const transfers = new WeakMap<VideoEditCreativeTransfer, { busy: boolean; prepared?: VideoEditCreativeResult }>()

export function createVideoEditCreativeTransfer(target: VideoEditResultTarget, source: VideoEditCreativeSourceRequest): VideoEditCreativeTransfer {
  assertVideoEditResultTarget(target)
  const transfer = Object.freeze({ target, source: Object.freeze(videoEditCreativeSourceRequestSchema.parse(source)) })
  transfers.set(transfer, { busy: false })
  return transfer
}
/** Keep completed output on failure; retry never repeats a WAV export or image render. */
export async function runVideoEditCreativeTransfer(transfer: VideoEditCreativeTransfer, signal?: AbortSignal): Promise<VideoEditResultReceipt> {
  const state = transfers.get(transfer)
  if (!state) throw new Error('请重新选择原创作结果。')
  if (state.busy) throw new Error('此结果正在准备，请等待完成。')
  state.busy = true
  try {
    const assertTarget = (): void => assertVideoEditResultTarget(transfer.target, signal)
    assertTarget()
    state.prepared ??= await prepareVideoEditCreativeResult(transfer.source, { signal, assertTarget })
    assertTarget()
    return await commitVideoEditCreativeResult(transfer.target, state.prepared, signal)
  } finally { state.busy = false }
}
