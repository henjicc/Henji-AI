import type { z } from 'zod'
import { createLogger } from '@/core/logging'
import { assertApplicationCallerGrant } from '@/core/application-control/callerContext'
import { queryVideoEditSubtitleCorrectionCapability, applyVideoEditSubtitleCorrectionCapability } from '@/core/application-control/domains/videoEdit/videoEditSubtitleCorrectionCapabilities'
import { buildSubtitleCorrectionBatches, materializeSubtitleCorrection, subtitleCorrectionBudgetsSchema, validateSubtitleCorrectionCues, videoEditSubtitleCorrectionSource, type SubtitleCorrectionBatch, type SubtitleCorrectionSource } from '@/core/videoEdit/subtitleCorrection'
import { videoEditComposition, type VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditAudioContent } from '@/core/videoEdit/audioContent'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { videoEditCaptionClipIds } from '@/core/videoEdit/captionSpeech'
import type { VideoEditCaption } from '@/core/videoEdit/timedContent'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { verifyVideoEditClipMediaContent } from '../videoEditMediaContent'
import { editVideoSequence, requireVideoEditInstance, saveVideoEdit, type VideoEditInstance } from './videoEditService'
import { splitVideoEditRef } from './videoEditReflection'
import { isVideoEditContentCurrent, verifyVideoEditContentSaved } from './videoEditDocumentAlgorithm'

interface Batch { value: SubtitleCorrectionBatch; error?: string; applied?: { payload: string; captions: VideoEditCaption[] } }
interface Plan { sequenceId: string; sound: string; batches: Batch[]; protected: SubtitleCorrectionSource['protectedCaptions'] }
const plans = new WeakMap<VideoEditInstance, Map<string, Plan>>()
const logger = createLogger('features.videoEdit.subtitleCorrection')
type Context = Pick<CapabilityExecutionContext, 'signal' | 'callerGrant' | 'requestId' | 'execution'>
function target(documentId: string, sequenceRef: { kind: string; id: string }): { owner: VideoEditInstance; sequence: VideoEditSequence } {
  const split = splitVideoEditRef(sequenceRef)
  if (split.projectId !== documentId || !split.childId) throw new Error('sequenceRef 必须属于 documentRef。')
  const owner = requireVideoEditInstance(documentId); const sequence = owner.document.sequences.find(sequence => sequence.id === split.childId)
  if (!sequence) throw new Error('原序列不存在。')
  return { owner, sequence }
}
function assertCaller(context: Context): void { context.signal.throwIfAborted(); if (context.callerGrant) assertApplicationCallerGrant(context.callerGrant) }
function status(batch: Batch, sequence: VideoEditSequence): 'pending' | 'applied' | 'conflict' {
  const current = new Map(sequence.captions?.map(caption => [caption.id, caption]))
  const expected = batch.applied?.captions ?? batch.value.groups.map(group => group.caption)
  if (!expected.every(caption => JSON.stringify(current.get(caption.id)) === JSON.stringify(caption))) return 'conflict'
  return batch.applied ? 'applied' : 'pending'
}
async function validatePlan(owner: VideoEditInstance, sequence: VideoEditSequence, plan: Plan, context: Context, batch?: Batch): Promise<void> {
  assertCaller(context)
  if (plan.sequenceId !== sequence.id) throw new Error('校对计划不属于本序列。')
  const contentVersion = owner.contentVersion; const composition = videoEditComposition(owner.document, sequence.id)
  if (videoEditAudioContent(composition) !== plan.sound) throw new Error('原声音或片段时序已改变，请重新规划字幕校对；已完成结果保留。')
  const ids = new Set((batch ? [batch] : plan.batches).flatMap(batch => batch.value.groups.flatMap(group => videoEditCaptionClipIds(group.caption))))
  if ([...ids].some(id => !composition.clips.some(clip => clip.id === id))) throw new Error('原声音片段已移除或替换，请重新规划；不会沿旧词源写入。')
  await verifyVideoEditClipMediaContent(composition, composition.clips.filter(clip => ids.has(clip.id)), context.signal)
  assertCaller(context)
  if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('核对来源期间作品已改变，请重新读取本批；不会覆盖新修改。')
}
function requirePlan(owner: VideoEditInstance, id: string): Plan {
  const plan = plans.get(owner)?.get(id)
  if (!plan) throw new Error('校对计划已失效或文档已重开，请重新查询；已保存的结果不会重做。')
  return plan
}

export async function queryVideoEditSubtitleCorrection(raw: unknown, context: Context): Promise<z.infer<typeof queryVideoEditSubtitleCorrectionCapability.outputSchema>> {
  const input = queryVideoEditSubtitleCorrectionCapability.inputSchema.parse(raw)
  const { owner, sequence } = target(input.documentRef.id, input.sequenceRef); assertCaller(context)
  logger.info('字幕校对批次查询开始', { event: 'video_edit.subtitle.correction.query.start', requestId: context.requestId, context: { documentId: owner.document.id, sequenceId: sequence.id } })
  try {
  let planId = input.planId; let plan: Plan
  if (planId) {
    if (input.budgets || input.rules !== undefined || input.glossary || input.captionRefs) throw new Error('计划选项已固定；续查只传planId、batchIndex或protectedOffset，修改选项请新建计划。')
    plan = requirePlan(owner, planId)
    await validatePlan(owner, sequence, plan, context)
  } else {
    const captionIds = input.captionRefs?.map(ref => {
      const split = splitVideoEditRef(ref)
      if (split.projectId !== owner.document.id || !split.childId) throw new Error('captionRefs 必须属于本剪辑。')
      return split.childId
    })
    const source = videoEditSubtitleCorrectionSource(sequence, captionIds)
    plan = { sequenceId: sequence.id, sound: videoEditAudioContent(videoEditComposition(owner.document, sequence.id)), batches: buildSubtitleCorrectionBatches(source.groups, input.budgets ?? subtitleCorrectionBudgetsSchema.parse({}), input.rules, input.glossary).map(value => ({ value })), protected: source.protectedCaptions }
    planId = crypto.randomUUID()
    await validatePlan(owner, sequence, plan, context)
    const saved = plans.get(owner) ?? new Map<string, Plan>(); plans.set(owner, saved)
    while (saved.size >= 4) saved.delete(saved.keys().next().value!)
    saved.set(planId, plan)
  }
  const states = plan.batches.map(batch => status(batch, sequence))
  const selectedIndex = input.batchIndex ?? states.findIndex(state => state === 'pending')
  if (input.batchIndex !== undefined && !plan.batches[selectedIndex]) throw new Error(`batchIndex 超出范围；本计划共有${plan.batches.length}批。`)
  const selected = plan.batches[selectedIndex]
  const batchPacket = (() => {
    if (!selected || states[selectedIndex] !== 'pending') return null
    const { instructions, rules, ...body } = selected.value.packet
    return { ...structuredClone(body), ...(!input.planId || input.includeGuidance ? { instructions, rules } : {}) }
  })()
  const captionRef = (id: string) => ({ kind: 'video_edit.caption' as const, id: `${owner.document.id}:${id}` })
  const protectedRecords = plan.protected.slice(input.protectedOffset, input.protectedOffset + 20)
  const completed = states.filter(state => state === 'applied').length; const pending = states.filter(state => state === 'pending').length; const conflicts = states.filter(state => state === 'conflict').length
  logger.info('字幕校对批次已读取', { event: 'video_edit.subtitle.correction.query.completed', requestId: context.requestId, context: { documentId: owner.document.id, sequenceId: sequence.id, batches: states.length, completed, pending, conflicts, protected: plan.protected.length } })
  return { documentRef: input.documentRef, sequenceRef: input.sequenceRef, planId, batchCount: states.length, completed, pending, conflicts,
    batch: selected ? { index: selectedIndex, state: states[selectedIndex], packet: batchPacket, estimatedInputTokens: selected.value.estimatedInputTokens, estimatedOutputTokens: selected.value.estimatedOutputTokens, captionRefs: selected.value.groups.map(group => captionRef(group.caption.id)), lastError: selected.error ?? null } : null,
    protected: protectedRecords.map(record => ({ captionRef: captionRef(record.captionId), reason: record.reason })), protectedCount: plan.protected.length, protectedNextOffset: input.protectedOffset + protectedRecords.length < plan.protected.length ? input.protectedOffset + protectedRecords.length : null,
    message: `共${states.length}批，已应用${completed}批，待校对${pending}批，${conflicts}批有新修改；${plan.protected.length}条字幕受保护。`,
  }
  } catch (error) {
    const meta = { event: context.signal.aborted ? 'video_edit.subtitle.correction.query.cancelled' : 'video_edit.subtitle.correction.query.failed', requestId: context.requestId, context: { documentId: owner.document.id, sequenceId: sequence.id } }
    if (context.signal.aborted) logger.info('字幕校对批次查询已取消', meta)
    else logger.error('字幕校对批次查询失败', error, meta)
    throw error
  }
}

export async function applyVideoEditSubtitleCorrection(raw: unknown, context: Context): Promise<z.infer<typeof applyVideoEditSubtitleCorrectionCapability.outputSchema>> {
  const input = applyVideoEditSubtitleCorrectionCapability.inputSchema.parse(raw)
  const { owner, sequence } = target(input.documentRef.id, input.sequenceRef); const plan = requirePlan(owner, input.planId)
  const batch = plan.batches[input.batchIndex]
  if (!batch) throw new Error(`batchIndex 超出范围；本计划共有${plan.batches.length}批。`)
  logger.info('应用字幕校对批次开始', { event: 'video_edit.subtitle.correction.apply.start', requestId: context.requestId, context: { documentId: owner.document.id, batchIndex: input.batchIndex } })
  try {
    await validatePlan(owner, sequence, plan, context, batch)
    const cues = validateSubtitleCorrectionCues(batch.value, input.cues, batch.value.outputTokenBudget); const payload = JSON.stringify(cues)
    const replayed = Boolean(batch.applied)
    if (batch.applied) {
      const current = new Map(sequence.captions?.map(caption => [caption.id, caption]))
      if (batch.applied.payload !== payload || batch.applied.captions.some(caption => JSON.stringify(current.get(caption.id)) !== JSON.stringify(caption))) throw new Error('本批已应用过其他结果或后来被修改/撤销，不会覆盖新修改；请重新规划需要的字幕。')
    } else if (status(batch, sequence) !== 'pending') throw new Error('本批字幕已有人工修改，请重新读取；其他已完成批次保留。')
    assertVideoEditClipsEditable(sequence, batch.value.groups.flatMap(group => videoEditCaptionClipIds(group.caption)))
    const captions = batch.applied?.captions ?? materializeSubtitleCorrection(batch.value, cues, () => crypto.randomUUID())
    const originalIds = new Set(batch.value.groups.map(group => group.caption.id)); const originals = new Map(batch.value.groups.map(group => [group.caption.id, group.caption]))
    const createdIds = replayed ? [] : captions.filter(caption => !originalIds.has(caption.id)).map(caption => caption.id)
    const updatedIds = replayed ? [] : captions.filter(caption => originalIds.has(caption.id) && JSON.stringify(caption) !== JSON.stringify(originals.get(caption.id))).map(caption => caption.id)
    const changed = createdIds.length > 0 || updatedIds.length > 0
    assertCaller(context)
    if (changed) {
      editVideoSequence(owner.document.id, sequence.id, current => ({ ...current, captions: [...(current.captions ?? []).filter(caption => !originalIds.has(caption.id)), ...captions].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)) }))
      context.execution?.report({ targetMutation: 'applied' })
    }
    // Compare retries to the authoritative normalized document, not the pre-commit object shape.
    const appliedIds = new Set(captions.map(caption => caption.id))
    const committed = owner.document.sequences.find(current => current.id === sequence.id)!.captions!.filter(caption => appliedIds.has(caption.id))
    batch.applied = { payload, captions: structuredClone(committed) }; batch.error = undefined
    const expected = owner.document; const version = owner.contentVersion
    await saveVideoEdit(owner.document.id)
    const verified = await verifyVideoEditContentSaved(owner, expected, version)
    const refs = (ids: string[]) => ids.map(id => ({ kind: 'video_edit.caption' as const, id: `${owner.document.id}:${id}` }))
    logger.info('字幕校对批次应用完成', { event: 'video_edit.subtitle.correction.apply.completed', requestId: context.requestId, context: { documentId: owner.document.id, batchIndex: input.batchIndex, changed, replayed, verified } })
    return { documentRef: input.documentRef, sequenceRef: input.sequenceRef, batchIndex: input.batchIndex, captionRefs: refs(captions.map(caption => caption.id)), createdCaptionRefs: refs(createdIds), updatedCaptionRefs: refs(updatedIds), changed, replayed, verified, message: replayed ? '本批已应用，已核对当前结果，未重复修改。' : changed ? '本批字幕已校对并保存，可一次撤销。' : '本批文字和断句无需修改，未新增撤销记录。' }
  } catch (error) {
    batch.error = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
    logger.error('字幕校对批次应用失败', error, { event: 'video_edit.subtitle.correction.apply.failed', requestId: context.requestId, context: { documentId: owner.document.id, batchIndex: input.batchIndex } })
    throw error
  }
}
