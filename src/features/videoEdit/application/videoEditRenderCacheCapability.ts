import { cancelVideoEditPreviewCapability, clearVideoEditPreviewCapability, renderVideoEditPreviewCapability } from '@/core/application-control/domains/videoEdit/videoEditRenderCacheCapability'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { createLogger } from '@/core/logging'
import { cancelVideoEditRenderCache, clearVideoEditRenderCache, readVideoEditRenderCache, renderVideoEditRenderCache } from './videoEditRenderCache'
import { requireVideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.renderCache')

/** Starts the background render (a whole film can take longer than a tool call) and reads the render bar back. */
export async function handleVideoEditRenderCacheCapability(id: string, raw: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown> | undefined> {
  if (id === cancelVideoEditPreviewCapability.id) {
    const input = cancelVideoEditPreviewCapability.inputSchema.parse(raw)
    context.signal?.throwIfAborted()
    await cancelVideoEditRenderCache(input.documentRef.id)
    const verified = readVideoEditRenderCache(input.documentRef.id).rendering === null
    return { documentRef: input.documentRef, verified, message: verified ? '预渲染已停止，已完成的预览文件已保留。' : '预渲染尚未停止，请检查渲染状态。' }
  }
  if (id === clearVideoEditPreviewCapability.id) {
    const input = clearVideoEditPreviewCapability.inputSchema.parse(raw)
    const owner = requireVideoEditInstance(input.documentRef.id)
    if (!owner.activeSequenceId) throw new ApplicationPreflightFailure('剪辑还没有序列，请先创建序列。')
    const sequenceId = owner.activeSequenceId
    context.signal?.throwIfAborted()
    await clearVideoEditRenderCache(input.documentRef.id, input.range)
    const view = readVideoEditRenderCache(input.documentRef.id, sequenceId)
    const verified = !view.rendering && !view.windows.some(window => window.state === 'ready' && (!input.range || window.endFrame > input.range.startFrame && window.startFrame < input.range.endFrame))
    return { documentRef: input.documentRef, verified, message: verified ? '指定范围的渲染文件已删除。' : '渲染文件删除后回读未通过，请检查当前渲染状态。' }
  }
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
    message: plan.requestedFrames === 0 ? '所选范围没有需要渲染的段落，已能实时播放。' : plan.pendingWindows === 0 ? '所选范围已全部渲染，可完整分辨率流畅播放。' : `已在后台开始渲染 ${plan.pendingWindows} 段（按剪辑点分段，最多五秒），播放时自动暂停；进度见 video_edit.document.render_cache。` }
}
