import { requireVideoEditInstance, setVideoEditView, switchVideoEditSequence, type VideoEditInstance } from './videoEditService'

// View selection follows the same instance-scoped pattern as transition selection, never saved in the edit file.
const selections = new WeakMap<VideoEditInstance, { sequenceId: string; captionId: string }>()
const listeners = new Set<() => void>()
let revision = 0
export function subscribeVideoEditSubtitleSelection(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoEditSubtitleSelectionRevision(): number { return revision }
export function selectedVideoEditSubtitleId(instance: VideoEditInstance, sequenceId = instance.activeSequenceId): string | undefined {
  const selected = selections.get(instance)
  return selected?.sequenceId === sequenceId && instance.document.sequences.find(sequence => sequence.id === sequenceId)?.captions?.some(caption => caption.id === selected.captionId) ? selected.captionId : undefined
}
export function selectVideoEditSubtitle(projectId: string, sequenceId: string, captionId: string): void {
  const owner = requireVideoEditInstance(projectId)
  const caption = owner.document.sequences.find(sequence => sequence.id === sequenceId)?.captions?.find(caption => caption.id === captionId)
  if (!caption) throw new Error('原字幕已移除，请重新选择。')
  if (owner.activeSequenceId !== sequenceId) switchVideoEditSequence(projectId, sequenceId)
  setVideoEditView(projectId, { frame: caption.start, playing: false, selection: caption.clipId ?? null })
  selections.set(owner, { sequenceId, captionId }); revision++; listeners.forEach(listener => listener())
}
