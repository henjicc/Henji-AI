import { getPlatform } from '@/platform'
import { createLogger } from '@/core/logging'
import { detectVideoEditPrivacyCapability } from '@/core/application-control/domains/videoEdit/videoEditPrivacyCapability'
import { privacyCandidateEffect } from '@/core/screenRecording/privacyEffects'
import { recordingPrivacySchema } from '@/core/screenRecording/privacy'
import { videoEditClipMedia } from '@/core/videoEdit/document'
import { videoEditClipSourceRange } from '@/core/videoEdit/clipSpeed'
import { videoEditFps } from '@/core/videoEdit/time'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { requireVideoEditInstance, editVideoProject, holdVideoEditActivity, saveVideoEdit } from './videoEditService'
import { splitVideoEditRef } from './videoEditReflection'
import { isVideoEditContentCurrent, verifyVideoEditContentSaved } from './videoEditDocumentAlgorithm'

const logger = createLogger('features.videoEdit.privacy')
export async function executeVideoEditPrivacy(raw: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  const input = detectVideoEditPrivacyCapability.inputSchema.parse(raw), target = splitVideoEditRef(input.clipRef)
  if (target.projectId !== input.documentRef.id) throw new Error('clipRef 必须属于 documentRef。')
  const owner = requireVideoEditInstance(input.documentRef.id), baseline = owner.document, version = owner.contentVersion
  const sequence = baseline.sequences.find(v => v.clips.some(c => c.id === target.childId)), clip = sequence?.clips.find(c => c.id === target.childId)
  const media = clip && videoEditClipMedia(baseline, clip)
  if (!sequence || !clip || clip.kind !== 'video' || clip.sourceComponent === 'audio' || !media) throw new Error('请选择有原片的视频片段。')
  if (sequence.tracks.find(t => t.index === clip.track)?.locked) throw new Error('轨道已锁定，请先解锁。')
  const range = videoEditClipSourceRange(clip, videoEditFps(sequence.frameRate)), requestId = crypto.randomUUID(), api = getPlatform().smartRegions
  const release = holdVideoEditActivity(baseline.id, '敏感文字识别')
  const cancel = (): void => { void api.cancelSensitiveText(requestId).catch(error => logger.warn('取消识别失败', { event: 'video_edit.privacy.cancel.failed', error })) }
  context.signal.addEventListener('abort', cancel, { once: true })
  logger.info('开始寻找敏感文字', { event: 'video_edit.privacy.start', context: { documentId: baseline.id, clipId: clip.id } })
  try {
    context.signal.throwIfAborted()
    const result = await api.detectSensitiveText({ requestId, source: media.path, mediaId: media.id, startUs: Math.max(0, Math.floor(range.from * 1e6)), endUs: Math.ceil(range.to * 1e6), originUs: 0 })
    context.signal.throwIfAborted()
    if (!isVideoEditContentCurrent(owner, version)) throw new Error('CONFLICT:识别期间剪辑已修改，请重新识别。')
    const effects = recordingPrivacySchema.parse(result.privacy).candidates.map(c => privacyCandidateEffect(c, 0, false))
    if (effects.length) editVideoProject(baseline.id, doc => ({ ...doc, sequences: doc.sequences.map(s => s.id !== sequence.id ? s : { ...s, clips: s.clips.map(c => c.id !== clip.id ? c : { ...c, effects: [...c.effects ?? [], ...effects] }) }) }))
    const expected = owner.document, nextVersion = owner.contentVersion
    try { await saveVideoEdit(baseline.id) } catch (error) { throw new ApplicationPersistenceFailure('候选打码已生成但未保存，请重试保存，不要重复识别。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error) }
    const verified = await verifyVideoEditContentSaved(owner, expected, nextVersion)
    logger.info('敏感文字候选已生成', { event: 'video_edit.privacy.completed', context: { documentId: baseline.id, candidates: effects.length } })
    return { resultRef: input.clipRef, effectRefs: effects.map(effect => ({ kind: 'video_edit.effect', id: `${baseline.id}:${effect.id}` })), verified, message: `已生成 ${effects.length} 个未启用的打码效果；请检查画面并确认后启用。` }
  } catch (error) { logger.error('寻找敏感文字失败', error, { event: context.signal.aborted ? 'video_edit.privacy.cancelled' : 'video_edit.privacy.failed', context: { documentId: baseline.id } }); throw error }
  finally { context.signal.removeEventListener('abort', cancel); release() }
}
