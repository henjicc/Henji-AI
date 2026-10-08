import { ApplicationOperationNotExecutedFailure, ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import type { CapabilityHandler } from '@/features/application-control/capabilities/handlerTypes'
import { requireVideoEditInstance } from './videoEditService'

// 仅这些操作的业务产物是同一不可变文档的原子提交；分析缓存不构成剪辑写入。
// 付费生成、文件导入、代理、导出、跨工作区写入不能依赖此守卫判断执行事实。
const ATOMIC_DOCUMENT_ALGORITHMS = new Set([
  'auto_reframe_video_edit', 'apply_video_edit_title_template', 'generate_video_edit_audio_ducking',
  'normalize_video_edit_loudness', 'trim_video_edit_clip', 'ripple_video_edit_clip_speed',
  'nest_video_edit_clips', 'create_video_edit_multicam', 'auto_switch_video_edit_multicam',
  'apply_video_edit_scenes', 'segment_video_edit_subtitles',
  'ripple_delete_video_edit_text', 'extract_video_edit_text', 'insert_video_edit_text',
])

export function guardVideoEditDocumentAlgorithm(id: string, handler: CapabilityHandler): CapabilityHandler {
  if (!ATOMIC_DOCUMENT_ALGORITHMS.has(id)) return handler
  return async (raw, context) => {
    const input = raw as { documentRef: { kind: 'video_edit.document'; id: string } }
    let owner
    try { owner = requireVideoEditInstance(input.documentRef.id) } catch (error) { throw new ApplicationPreflightFailure(error) }
    const baseline = owner.document
    try { return await handler(raw, context) } catch (error) {
      if (error instanceof ApplicationPersistenceFailure) throw error
      // 精确实例与不可变文档身份是该算法的提交边界；换会话时不能猜执行状态。
      let current
      try { current = requireVideoEditInstance(input.documentRef.id) } catch { throw error }
      if (current === owner && owner.document === baseline) throw new ApplicationOperationNotExecutedFailure(error)
      throw error
    }
  }
}
