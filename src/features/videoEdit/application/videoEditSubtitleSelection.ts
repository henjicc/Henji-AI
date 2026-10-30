import { focusVideoEditPanel, requireVideoEditInstance, setVideoEditSelectedCaption, setVideoEditView, subscribeVideoEditCaptionSelection, switchVideoEditSequence, videoEditCaptionSelectionRevision, type VideoEditInstance } from './videoEditService'

// 字幕选择和片段选择存在同一份视图状态里（`VideoEditInstance.selectedCaptionId`），由剪辑服务保证两者互斥。
export const subscribeVideoEditSubtitleSelection = subscribeVideoEditCaptionSelection
export const videoEditSubtitleSelectionRevision = videoEditCaptionSelectionRevision
/** 当前序列里选中的字幕；读取时再核对一次字幕仍在、没有片段选择，作兜底。 */
export function selectedVideoEditSubtitleId(instance: VideoEditInstance, sequenceId = instance.activeSequenceId): string | undefined {
  const captionId = instance.selectedCaptionId
  if (!captionId || sequenceId !== instance.activeSequenceId || instance.selectedClipIds.length) return undefined
  return instance.document.sequences.find(sequence => sequence.id === sequenceId)?.captions?.some(caption => caption.id === captionId) ? captionId : undefined
}
/**
 * 选中一条字幕（同时清空片段选择）；传 null 取消。时间线、节目画面上选中时效果控件到前面显示字幕样式，播放头留在原处；
 * 「字幕与标记」列表与助手定位是去找这条字幕，传 `seek: true` 把播放头带到它开头；列表里选中传 `reveal: false`，留在列表上。
 */
export function selectVideoEditSubtitle(projectId: string, sequenceId: string, captionId: string | null, options: { seek?: boolean; reveal?: boolean } = {}): void {
  const owner = requireVideoEditInstance(projectId)
  if (captionId === null) { setVideoEditSelectedCaption(projectId, null); return }
  const caption = owner.document.sequences.find(sequence => sequence.id === sequenceId)?.captions?.find(caption => caption.id === captionId)
  if (!caption) throw new Error('原字幕已移除，请重新选择。')
  if (owner.activeSequenceId !== sequenceId) switchVideoEditSequence(projectId, sequenceId)
  setVideoEditView(projectId, { ...(options.seek ? { frame: caption.start } : {}), playing: false, selection: null })
  setVideoEditSelectedCaption(projectId, captionId)
  // 默认布局里字幕面板与效果控件同组：选中字幕把效果控件带到前面，已在前面时不重复激活。
  if (options.reveal !== false && owner.activePanel !== 'effects') focusVideoEditPanel(projectId, 'effects')
}
