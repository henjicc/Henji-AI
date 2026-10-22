import { superKeyframeSessionId } from '@/core/creativeIntent/captureIntent'
import { createLogger } from '@/core/logging'
import type { SuperKeyframeAttachment } from '@/core/assistant/attachments'
import { openAssistant } from '@/features/assistant'
import { loadRecordingSetup, saveRecordingSetup } from '@/services/recordingSetupModel'
import { executeUiApplicationCapability } from '@/features/application-control'
import { requireVideoEditInstance } from './videoEditService'
import { pauseVideoMotion, resumeVideoMotion, startVideoMotion, stopVideoMotion, videoMotionOrigin, videoMotionState } from './videoEditMotionDraft'
import { configureVideoExplanationMicrophone, pauseVideoExplanation, preflightVideoExplanation, resumeVideoExplanation, startVideoExplanation, stopVideoExplanation, transcribeVideoExplanation, videoExplanationState, reopenVideoExplanation } from './videoEditExplanation'

const logger = createLogger('features.videoEdit.superKeyframes')
export function superKeyframeMicrophonePreference(): { enabled: boolean; deviceId: string } {
  const { setup } = loadRecordingSetup()
  return { enabled: setup.microphone, deviceId: setup.microphoneId }
}
/** 与现有录制共享用户的麦克风偏好，不新增第二份设备设置。 */
export async function configureSuperKeyframeMicrophone(id: string, enabled: boolean, deviceId: string): Promise<void> {
  const owner = requireVideoEditInstance(id)
  if (videoExplanationState(owner)) await configureVideoExplanationMicrophone(id, enabled, deviceId)
  const saved = loadRecordingSetup()
  saveRecordingSetup({ ...saved, setup: { ...saved.setup, microphone: enabled, microphoneId: deviceId } })
}
export async function startSuperKeyframes(id: string): Promise<void> {
  const owner = requireVideoEditInstance(id), preference = superKeyframeMicrophonePreference()
  await startVideoMotion(id)
  const draft = videoMotionState(owner)!.draft
  try {
    if (videoExplanationState(owner)?.collector.session.id !== superKeyframeSessionId(draft.id) && owner.document.creativeIntents?.sessions.some(session => session.id === superKeyframeSessionId(draft.id))) {
      await reopenVideoExplanation(id, superKeyframeSessionId(draft.id))
      videoExplanationState(owner)!.originMs = videoMotionOrigin(owner)!
    }
    if (videoExplanationState(owner)?.collector.session.id === superKeyframeSessionId(draft.id)) {
      await configureVideoExplanationMicrophone(id, preference.enabled, preference.deviceId)
      await resumeVideoExplanation(id, true)
    } else await startVideoExplanation(id, `super-keyframes:${draft.id}`, { sessionId: superKeyframeSessionId(draft.id), originMs: videoMotionOrigin(owner), microphone: preference.enabled, deviceId: preference.deviceId })
  } catch (error) { pauseVideoMotion(id); throw error }
}
export async function pauseSuperKeyframes(id: string): Promise<void> {
  pauseVideoMotion(id)
  await pauseVideoExplanation(id)
}
export async function resumeSuperKeyframes(id: string): Promise<void> {
  const owner = requireVideoEditInstance(id), motion = videoMotionState(owner)
  if (motion?.automatic && motion.activeTargetId !== `${id}:${owner.selection}`) {
    await stopVideoMotion(id)
    await stopVideoExplanation(id)
    await startSuperKeyframes(id)
    return
  }
  await resumeVideoExplanation(id, true)
  try { resumeVideoMotion(id) } catch (error) { await pauseVideoExplanation(id); throw error }
}
export function superKeyframeAttachment(id: string, draftId: string): SuperKeyframeAttachment {
  const owner = requireVideoEditInstance(id), head = owner.document.creativeIntents
  const draft = head?.drafts.find(value => value.id === draftId)
  if (!draft) throw new Error('超级关键帧组已不存在，请重新录制。')
  const session = head!.sessions.find(value => value.id === superKeyframeSessionId(draftId))
  const draftRef = { kind: 'video_edit.intent_draft' as const, id: `${id}:${encodeURIComponent(draftId)}` }
  return { schemaVersion: 'super-keyframe-reference/v1', mediaRef: `${draftRef.kind}:${draftRef.id}`, modality: 'super_keyframes', lifecycle: 'document', displayName: '超级关键帧', mimeType: 'application/vnd.henji.super-keyframes', sizeBytes: 0, dataClass: 'C2', sourceStatus: 'ready', draftRef,
    summary: { takeCount: draft.takes.length, durationSeconds: draft.takes.reduce((sum, take) => sum + take.monoSpanUs[1] - take.monoSpanUs[0], 0) / 1_000_000,
      elements: draft.targets.map(target => owner.document.sequences.flatMap(sequence => sequence.clips).find(clip => `${id}:${clip.id}` === target.ref.id)?.name ?? '已移除元素'), hasNarration: Boolean(session?.pages.some(page => page.kind === 'transcript')) } }
}
/** 渲染层交接入口：只把正式原稿引用放进助手草稿，不自动发送。 */
export function openVideoSuperKeyframesInAssistant(id: string, draftId: string): void {
  const attachment = superKeyframeAttachment(id, draftId)
  if (!attachment.summary.takeCount) throw new Error('请先录制一段超级关键帧。')
  openAssistant('请处理这组超级关键帧。', { autoSend: false, appendToDraft: true, attachments: [{ attachment, previewSrc: '' }] })
}
export async function finishSuperKeyframes(id: string): Promise<void> {
  const owner = requireVideoEditInstance(id)
  await stopVideoMotion(id)
  await stopVideoExplanation(id)
  const draftId = videoMotionState(owner)!.draft.id
  if (videoExplanationState(owner)?.collector.session.id !== superKeyframeSessionId(draftId) && owner.document.creativeIntents?.sessions.some(value => value.id === superKeyframeSessionId(draftId))) await reopenVideoExplanation(id, superKeyframeSessionId(draftId))
  const session = videoExplanationState(owner)?.collector.session
  try {
    if (session?.id === superKeyframeSessionId(draftId) && session.pages.some(page => page.kind === 'audio')) {
      await preflightVideoExplanation(id)
      await transcribeVideoExplanation(id, `super-keyframes:${draftId}`, session.state === 'recoverable')
    }
    openVideoSuperKeyframesInAssistant(id, draftId)
    logger.info('超级关键帧已放入助手草稿', { event: 'video_edit.super_keyframes.handoff.completed', context: { documentId: id, draftId } })
  } catch (error) { logger.warn('超级关键帧交接未完成，原稿已保留', { event: 'video_edit.super_keyframes.handoff.failed', error, context: { documentId: id, draftId } }); throw error }
}
/** UI 和外部智能体都走原稿集合的同一个删除事务。 */
export async function removeSuperKeyframeTake(id: string, draftId: string, takeId: string): Promise<void> {
  const parent = { kind: 'video_edit.intent_draft', id: `${id}:${encodeURIComponent(draftId)}` }
  const signal = new AbortController().signal
  const baseline = await executeUiApplicationCapability({ id: 'read_application_entity', version: 1, input: { ref: parent } }, signal)
  if (!baseline.ok) throw new Error(baseline.error.message)
  const result = await executeUiApplicationCapability({ id: 'change_application_entities', version: 2, expectedRevisions: baseline.data.revisions as Record<string, number>, input: { summary: '删除超级关键帧段落', changes: [{ kind: 'remove_items', entityType: 'video_edit.intent_take', parent, targets: [{ kind: 'video_edit.intent_take', id: `${parent.id}:${encodeURIComponent(takeId)}` }] }] } }, signal)
  if (!result.ok) throw new Error(result.error.message)
}
