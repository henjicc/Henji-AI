import { renderVideoEditPreviewCapability } from '@/core/application-control/domains/videoEdit/videoEditRenderCacheCapability'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { createLogger } from '@/core/logging'
import { readVideoEditRenderCache, renderVideoEditRenderCache } from './videoEditRenderCache'
import { requireVideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.renderCache')

/** Starts the background render (a whole film can take longer than a tool call) and reads the render bar back. */
export async function handleVideoEditRenderCacheCapability(id: string, raw: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown> | undefined> {
  if (id !== renderVideoEditPreviewCapability.id) return undefined
  const input = renderVideoEditPreviewCapability.inputSchema.parse(raw)
  const owner = requireVideoEditInstance(input.documentRef.id)
  if (!owner.activeSequenceId) throw new ApplicationPreflightFailure('剪辑还没有序列，请先创建序列。')
  context.signal?.throwIfAborted()
  const plan = await new Promise<{ pendingWindows: number; requestedFrames: number; readyFrames: number }>((resolve, reject) => {
    void renderVideoEditRenderCache(input.documentRef.id, { ...(input.range ? { range: input.range } : {}), scope: input.scope }, undefined, resolve)
      .catch(error => { reject(error); logger.warn('后台预渲染未完成', { event: 'video_edit.render_cache.background_failed', error, context: { projectId: input.documentRef.id } }) })
  })
  const view = readVideoEditRenderCache(input.documentRef.id)
  const verified = plan.pendingWindows === 0 ? plan.readyFrames === plan.requestedFrames : view.rendering !== null
  return { documentRef: input.documentRef, ...plan, verified,
    message: plan.requestedFrames === 0 ? '所选范围没有需要渲染的段落，已能实时播放。' : plan.pendingWindows === 0 ? '所选范围已全部渲染，可完整分辨率流畅播放。' : `已在后台开始渲染 ${plan.pendingWindows} 段（每段三十秒），播放时自动暂停；进度见 video_edit.document.render_cache。` }
}
