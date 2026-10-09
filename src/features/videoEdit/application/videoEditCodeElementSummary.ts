import { codeElementOverrideStatus } from '@/core/videoEdit/codeElementOverrides'
import { codeElementSourceIds } from '@/core/videoEdit/codeElementBake'
import { codeElementLabel } from '@/core/videoEdit/codeElementSelection'
import { readVideoEditCodeProgram } from './videoEditCodeState'
import { videoEditCodeElementFrames } from './videoEditCodeElements'
import { requireVideoEditInstance } from './videoEditService'

export function videoEditCodeElementOverrideSummary(projectId: string, sequenceId: string, clipId: string) {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(value => value.id === sequenceId); const clip = sequence?.clips.find(value => value.id === clipId)
  if (!clip?.code) return []
  const overrides = clip.elementOverrides ?? {}
  if (!Object.keys(overrides).length) return []
  const program = readVideoEditCodeProgram(owner, owner.document, clip.code)
  const index = videoEditCodeElementFrames(owner, sequenceId, Math.max(clip.start, Math.min(clip.start + clip.duration - 1, owner.frame))).get(clip.id)?.index
  const ids = codeElementSourceIds(program, Object.keys(overrides)); for (const id of index?.byId.keys() ?? []) ids.add(id)
  return codeElementOverrideStatus(overrides, ids).map(value => ({ ...value, label: index?.byId.has(value.elementId) ? codeElementLabel(index.byId.get(value.elementId)!) : value.missing ? '元素已不存在' : '元素当前未显示', fields: Object.keys(overrides[value.elementId]) }))
}
export function videoEditCodeElementHostSummary(projectId: string) {
  const owner = requireVideoEditInstance(projectId)
  const sequence = owner.document.sequences.find(value => value.id === owner.activeSequenceId)
  const clips = sequence?.clips.filter(clip => owner.selectedClipIds.includes(clip.id) && clip.code && clip.elementOverrides) ?? []
  const count = clips.reduce((sum, clip) => sum + Object.keys(clip.elementOverrides!).length, 0)
  const items: Array<{ clipRef: string; elementId: string; fields: string[]; missing: boolean }> = []
  for (const clip of clips) {
    if (items.length >= 12) break // Context preview budget only; full overrides remain available through the clip entity.
    const status = new Map(videoEditCodeElementOverrideSummary(projectId, sequence!.id, clip.id).map(value => [value.elementId, value.missing]))
    for (const [elementId, value] of Object.entries(clip.elementOverrides!)) { if (items.length >= 12) break; items.push({ clipRef: `video_edit.clip:${projectId}:${clip.id}`, elementId, fields: Object.keys(value), missing: status.get(elementId) === true }) }
  }
  return { count, items }
}
