import { codeElementOverrideStatus, type CodeElementOverrides } from '@/core/videoEdit/codeElementOverrides'
import { codeElementLabel, type CodeElementIndex } from '@/core/videoEdit/codeElementSelection'
import type { CodeAuthorProgram as CodeMaterialProgram } from '@/core/videoEdit/codeAuthorProgram'
import { peekVideoEditCodeProgram } from './videoEditCodeState'
import { videoEditCodeElementFrames } from './videoEditCodeElements'
import { requireVideoEditInstance } from './videoEditService'

/**
 * 能断定仍在源码里的元素：静态表（字面量 id）加当前帧看到的。只有源码图层 id 全是字面量时，不在其中才算已删除；
 * 数据生成或隐藏的元素不能凭一帧断定删除，此时已有覆盖一律当作仍可能存在。
 */
export function videoEditCodeElementSourceIds(program: CodeMaterialProgram | undefined, index: CodeElementIndex | undefined, overrides: CodeElementOverrides): Set<string> {
  const ids = new Set(Object.keys(program?.bundle.locations.layers ?? {}))
  for (const id of index?.byId.keys() ?? []) ids.add(id)
  if (!program?.bundle.locations.staticLayerIds) for (const id of Object.keys(overrides)) ids.add(id)
  return ids
}
export function videoEditCodeElementOverrideSummary(projectId: string, sequenceId: string, clipId: string) {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(value => value.id === sequenceId); const clip = sequence?.clips.find(value => value.id === clipId)
  if (!clip?.code) return []
  const overrides = clip.elementOverrides ?? {}
  if (!Object.keys(overrides).length) return []
  const program = peekVideoEditCodeProgram(owner, clip.code.versionId)
  const index = videoEditCodeElementFrames(owner, sequenceId, Math.max(clip.start, Math.min(clip.start + clip.duration - 1, owner.frame))).get(clip.id)?.index
  const ids = videoEditCodeElementSourceIds(program, index, overrides)
  const effects = new Map(index?.bounds.filter(bound => bound.author.effectStates).map(bound => [bound.elementId, new Set(bound.author.effectStates!.filter(effect => !effect.added && !effect.missing).map(effect => effect.key))]))
  return codeElementOverrideStatus(overrides, ids, effects).map(value => ({ ...value, label: index?.byId.has(value.elementId) ? codeElementLabel(index.byId.get(value.elementId)!) : !program ? '正在读取元素…' : value.missing ? '元素已不存在' : '元素当前未显示', visible: Boolean(index?.byId.has(value.elementId)), fields: Object.keys(overrides[value.elementId]) }))
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
