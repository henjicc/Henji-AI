import { extractVideoEditWorkStyleCapability, extractVideoEditReferenceStyleCapability, insertVideoEditStyleSampleCapability, styleKitTargetSchema } from '@/core/application-control/domains/videoEdit/videoEditStyleKitCapabilities'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'
import { BUILTIN_STYLE_KITS } from '@/core/videoEdit/styleKitPresets'
import { resolveVideoEditStyleKit, styleKitContent } from '@/core/videoEdit/styleKit'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'
import { splitVideoEditRef } from './videoEditReflection'
import { projectStyleKit, extractVideoEditWorkStyle } from './videoEditStyleKits'
import { extractVideoEditReferenceStyle } from './videoEditStyleReference'
import { videoEditStyleKitLibrary } from './videoEditStyleKitLibrary'
import { insertVideoEditStyleSample } from './videoEditStyleSamples'

export async function handleVideoEditStyleKitCapability(id: string, raw: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown> | undefined> {
  const definition = [extractVideoEditWorkStyleCapability, extractVideoEditReferenceStyleCapability, insertVideoEditStyleSampleCapability].find(value => value.id === id)
  if (!definition) return undefined
  const target = styleKitTargetSchema.strip().parse(raw)
  const projectId = target.documentRef.id; const owner = requireVideoEditInstance(projectId)
  const sequenceRef = target.sequenceRef
  const { projectId: parent, childId: sequenceId } = splitVideoEditRef(sequenceRef); const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  if (parent !== projectId || !sequence) throw new ApplicationPreflightFailure('sequenceRef 必须属于明确的原剪辑。')
  const base = resolveVideoEditStyleKit(owner.document, sequence) ?? BUILTIN_STYLE_KITS[0]
  if (id === extractVideoEditReferenceStyleCapability.id) {
    const input = extractVideoEditReferenceStyleCapability.inputSchema.parse(raw)
    let reference: Parameters<typeof extractVideoEditReferenceStyle>[0]
    if (input.reference.kind === 'asset') { if (!context.callerGrant?.permissions.includes('assets:read')) throw new Error('读取资产参考需要 assets:read 权限，请授权或选择剪辑素材。'); reference = { kind: 'asset', assetId: input.reference.assetRef.id } }
    else { const value = splitVideoEditRef(input.reference.itemRef); if (value.projectId !== projectId) throw new Error('itemRef 必须属于原剪辑。'); reference = { kind: 'item', projectId, itemId: value.childId, timeUs: input.reference.timeUs } }
    const kit = await extractVideoEditReferenceStyle(reference, base, input.name, context.signal)
    return { name: kit.name, content: styleKitContent(kit), message: '已生成参考风格候选；预览确认后创建风格包并绑定序列。' }
  }
  if (id === extractVideoEditWorkStyleCapability.id) { const input = extractVideoEditWorkStyleCapability.inputSchema.parse(raw); const kit = await extractVideoEditWorkStyle(projectId, sequenceId, input.name, context.signal); return { name: kit.name, content: styleKitContent(kit), message: '已生成作品风格候选；预览确认后创建风格包并绑定序列。' } }
  const input = insertVideoEditStyleSampleCapability.inputSchema.parse(raw)
  let kit
  if (input.styleRef.kind === 'video_edit.style_kit') { const value = splitVideoEditRef(input.styleRef); if (value.projectId !== projectId) throw new ApplicationPreflightFailure('工程风格包必须属于原剪辑。'); try { kit = projectStyleKit(owner.document, value.childId) } catch (error) { throw new ApplicationPreflightFailure(error) } }
  else { kit = videoEditStyleKitLibrary.list().find(value => value.id === input.styleRef.id); if (!kit) throw new ApplicationPreflightFailure('风格预设不存在，请重新列出。') }
  if (!kit.samples.some(sample => sample.id === input.sampleId)) throw new ApplicationPreflightFailure('风格组件不存在，请重新读取该风格包的组件。')
  const before = owner.document
  const ids = await insertVideoEditStyleSample(projectId, sequenceId, kit, input.sampleId, { frame: input.frame, mode: 'top' }, context.signal)
  try { await saveVideoEdit(projectId) } catch (error) { throw new ApplicationPersistenceFailure('组件已保留但保存未确认，请重试保存，不要重复插入。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error) }
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑会话已关闭，请读取工程确认插入结果，不要重复执行。')
  const after = owner.document; const styled = after.sequences.find(value => value.id === sequenceId)!
  const style = projectStyleKit(after, styled.styleKitId!); const clips = styled.clips.filter(clip => ids.includes(clip.id)); const verified = await verifyVideoEditSaved(projectId, after)
  return { resultRef: input.documentRef, sequenceRef: input.sequenceRef, clipRefs: clips.map(clip => ({ kind: 'video_edit.clip', id: `${projectId}:${clip.id}` })), itemRefs: clips.map(clip => ({ kind: 'video_edit.item', id: `${projectId}:${clip.itemId}` })), definitionRefs: clips.map(clip => ({ kind: 'video_edit.code_material', id: `${projectId}:${clip.code!.definitionId}` })), versionRefs: clips.map(clip => ({ kind: 'video_edit.code_version', id: `${projectId}:${clip.code!.versionId}` })), trackRefs: styled.tracks.filter(track => !before.sequences.find(value => value.id === sequenceId)!.tracks.some(old => old.id === track.id)).map(track => ({ kind: 'video_edit.track', id: `${projectId}:${track.id}` })), styleRef: { kind: 'video_edit.style_kit', id: `${projectId}:${style.id}` }, styleEffect: before.styleKits?.some(value => value.id === style.id) ? 'update' : 'create', verified, message: '风格组件已添加，换序列风格时会一起更新。' }
}
