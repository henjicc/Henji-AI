import { createVideoEditMulticamCapability, autoSwitchVideoEditMulticamCapability } from '@/core/application-control/domains/videoEdit/videoEditMulticamCapabilities'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'
import { createVideoEditMulticamSource, autoSwitchVideoEditMulticam } from './videoEditMulticam'
import type { ApplicationRef } from '@/core/application-control'

export async function handleVideoEditMulticamCapability(id: string, raw: unknown, signal?: AbortSignal): Promise<Record<string, unknown> | undefined> {
  if (id !== createVideoEditMulticamCapability.id && id !== autoSwitchVideoEditMulticamCapability.id) return undefined
  const input = (id === createVideoEditMulticamCapability.id ? createVideoEditMulticamCapability.inputSchema : autoSwitchVideoEditMulticamCapability.inputSchema).parse(raw)
  const projectId = input.documentRef.id; const owner = requireVideoEditInstance(projectId)
  const child = (ref: ApplicationRef): string => { const value = splitVideoEditRef(ref); if (value.projectId !== projectId || !value.childId) throw new Error('素材、序列与片段引用必须属于目标剪辑。'); return value.childId }
  let sequenceId: string; let itemId: string | undefined; let clipIds: string[]
  if ('cameras' in input) {
    const result = await createVideoEditMulticamSource(projectId, child(input.templateSequenceRef), { name: input.name, sync: input.sync, audioCameraIndex: input.audioCameraIndex, cameras: input.cameras.map(camera => ({ itemId: child(camera.itemRef), name: camera.name, speaker: camera.speaker, inPointSeconds: camera.inPointSeconds, timecodeSeconds: camera.timecodeSeconds })) }, signal)
    sequenceId = result.sequence.id; itemId = result.itemId; clipIds = result.sequence.clips.map(clip => clip.id)
  } else {
    const clipId = child(input.clipRef); const sequence = owner.document.sequences.find(sequence => sequence.clips.some(clip => clip.id === clipId))
    if (!sequence) throw new Error('多机位片段已移除。')
    sequenceId = sequence.id; clipIds = await autoSwitchVideoEditMulticam({ projectId, sequenceId, clipId }, input, signal)
  }
  const document = owner.document
  await saveVideoEdit(projectId)
  const verified = requireVideoEditInstance(projectId) === owner && await verifyVideoEditSaved(projectId, document)
  return { resultRef: input.documentRef, sequenceRef: { kind: 'video_edit.sequence', id: `${projectId}:${sequenceId}` }, ...(itemId ? { itemRef: { kind: 'video_edit.item', id: `${projectId}:${itemId}` } } : {}), clipRefs: clipIds.map(id => ({ kind: 'video_edit.clip', id: `${projectId}:${id}` })), message: itemId ? '多机位源序列已创建，可放入时间线继续切换；可一步撤销。' : '多机位切换建议已应用，可微调切点或换机位；可一步撤销。', verification: { verified, target: input.documentRef, condition: '已从剪辑文件回读核对多机位源引用和全部机位段。' } }
}
