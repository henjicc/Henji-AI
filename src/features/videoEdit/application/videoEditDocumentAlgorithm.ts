import { ApplicationWriteExecution, applicationWritePreflight } from '@/core/application-control/execution/writeExecution'
import type { CapabilityHandler } from '@/features/application-control/capabilities/handlerTypes'
import { listVideoEditInstances, openVideoEditDocument, requireVideoEditInstance, verifyVideoEditSaved, type VideoEditInstance } from './videoEditService'
import type { VideoEditDocument } from '@/core/videoEdit/document'

/** 异步操作只因原实例关闭或内容变化而失效；元数据写入不改变这份证明。 */
export function isVideoEditContentCurrent(owner: VideoEditInstance, contentVersion: number): boolean {
  return listVideoEditInstances().includes(owner) && !owner.session.isEnded && owner.contentVersion === contentVersion
}

/** 保存确认也复核回读期间的内容变化，避免迟到结果误报成功。 */
export async function verifyVideoEditContentSaved(owner: VideoEditInstance, expected: VideoEditDocument, contentVersion: number): Promise<boolean> {
  if (!isVideoEditContentCurrent(owner, contentVersion)) return false
  const saved = await verifyVideoEditSaved(owner.document.id, expected, { contentOnly: true })
  return saved && isVideoEditContentCurrent(owner, contentVersion)
}

// 仅这些操作的业务产物是同一不可变文档的原子提交；分析缓存不构成剪辑写入。
// 付费生成、文件导入、代理、导出、跨工作区写入不能依赖此守卫判断执行事实。
const ATOMIC_DOCUMENT_ALGORITHMS = new Set([
  'detect_video_edit_sensitive_text',
  'stagger_video_edit_motion',
  'analyze_video_edit_beats',
  'generate_video_edit_screen_attention', 'auto_reframe_video_edit', 'bind_video_edit_style', 'generate_video_edit_audio_ducking',
  'normalize_video_edit_loudness', 'trim_video_edit_clip', 'ripple_video_edit_clip_speed',
  'nest_video_edit_clips', 'create_video_edit_multicam', 'auto_switch_video_edit_multicam',
  'apply_video_edit_scenes', 'segment_video_edit_subtitles',
  'apply_video_edit_subtitle_correction',
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
      return owner.contentVersion
    }, () => handler(raw, context))
  }
}
