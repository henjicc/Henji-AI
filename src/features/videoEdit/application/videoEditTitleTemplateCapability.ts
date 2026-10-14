import { applyTitleTemplateCapability, describeTitleTemplateCapability } from '@/core/application-control/domains/videoEdit/videoEditTitleTemplateCapabilities'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'
import { splitVideoEditRef } from './videoEditReflection'
import { applyTitleTemplate } from './videoEditTitleTemplates'
import { generateTitleFromDescription } from './videoEditTitleDescription'
import { listVideoEditPresets, preferredVideoEditPreset } from './videoEditPresetCatalog'

/** No explicit template: the user's default, else the best-liked one; never a silent arbitrary pick. */
function preferredTitleTemplateId(): string {
  const preferred = preferredVideoEditPreset('title')
  if (preferred) return preferred.id
  throw new Error(`还没有默认或评过分的标题模板，请传 templateRef。可用模板：${listVideoEditPresets('title').map(entry => `${entry.name}（${entry.id}）`).join('、')}`)
}

export async function handleTitleTemplateCapability(id: string, raw: unknown, signal?: AbortSignal): Promise<Record<string, unknown> | undefined> {
  if (id !== applyTitleTemplateCapability.id && id !== describeTitleTemplateCapability.id) return undefined
  const input = id === applyTitleTemplateCapability.id ? applyTitleTemplateCapability.inputSchema.parse(raw) : describeTitleTemplateCapability.inputSchema.parse(raw)
  const projectId = input.documentRef.id; const owner = requireVideoEditInstance(projectId); const sequenceId = splitVideoEditRef(input.sequenceRef).childId
  const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  if (splitVideoEditRef(input.sequenceRef).projectId !== projectId || !sequence) throw new Error('sequenceRef 必须属于明确的原剪辑。')
  let track: number | undefined
  if (input.trackRef) { const value = splitVideoEditRef(input.trackRef); track = sequence.tracks.find(track => track.id === value.childId)?.index; if (value.projectId !== projectId || track === undefined) throw new Error('trackRef 必须属于目标序列。') }
  signal?.throwIfAborted()
  const placement = { frame: input.frame, ...(track !== undefined ? { track, mode: 'overwrite' as const } : { mode: 'top' as const }) }
  const ids = !('description' in input) ? applyTitleTemplate(projectId, sequenceId, input.templateRef?.id ?? preferredTitleTemplateId(), input.parameters, placement) : (await generateTitleFromDescription(projectId, sequenceId, { description: input.description, providerId: input.providerId, modelId: input.modelId, placement }, signal)).clipIds
  await saveVideoEdit(projectId)
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，不能核对新的会话。')
  const verified = await verifyVideoEditSaved(projectId, owner.document)
  return { resultRef: input.documentRef, clipRefs: ids.map(id => ({ kind: 'video_edit.clip', id: `${projectId}:${id}` })), verified, message: '标题动画已添加，可继续编辑文字、图形和关键帧。' }
}
