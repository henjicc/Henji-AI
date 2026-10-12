import { ApplicationWriteExecution, applicationWritePreflight } from '@/core/application-control/execution/writeExecution'
import type { CapabilityHandler } from '@/features/application-control/capabilities/handlerTypes'
import { openVideoEditDocument, requireVideoEditInstance } from './videoEditService'

// 仅这些操作的业务产物是同一不可变文档的原子提交；分析缓存不构成剪辑写入。
// 付费生成、文件导入、代理、导出、跨工作区写入不能依赖此守卫判断执行事实。
const ATOMIC_DOCUMENT_ALGORITHMS = new Set([
  'stagger_video_edit_motion',
  'analyze_video_edit_beats',
  'auto_reframe_video_edit', 'apply_video_edit_title_template', 'generate_video_edit_audio_ducking',
  'normalize_video_edit_loudness', 'trim_video_edit_clip', 'ripple_video_edit_clip_speed',
  'nest_video_edit_clips', 'create_video_edit_multicam', 'auto_switch_video_edit_multicam',
  'apply_video_edit_scenes', 'segment_video_edit_subtitles',
  'ripple_delete_video_edit_text', 'extract_video_edit_text', 'insert_video_edit_text',
])

export function guardVideoEditDocumentAlgorithm(id: string, handler: CapabilityHandler): CapabilityHandler {
  return async (raw, context) => {
    const input = raw as { documentRef?: { kind: string; id: string } }
    if (input.documentRef?.kind !== 'video_edit.document') return handler(raw, context)
    const documentId = input.documentRef.id
    const owner = await applicationWritePreflight(context, () => openVideoEditDocument({ id: documentId }, { focus: false }))
    if (!ATOMIC_DOCUMENT_ALGORITHMS.has(id)) return handler(raw, context)
    return (context.execution ?? new ApplicationWriteExecution()).atomic(() => {
      if (requireVideoEditInstance(documentId) !== owner) throw new Error('原剪辑实例已变化')
      return owner.document
    }, () => handler(raw, context))
  }
}
