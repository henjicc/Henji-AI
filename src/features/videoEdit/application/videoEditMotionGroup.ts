import { superKeyframeSessionId } from '@/core/creativeIntent/captureIntent'
import { createLogger } from '@/core/logging'
import { semanticRecordingEvents } from '@/core/creativeIntent/semanticIntentRecording'
import { serializeRecordingInput } from '@/core/creativeIntent/recordingSerializer'
import type { ExplanationEvent } from '@/core/creativeIntent/schema'
import { requireVideoEditInstance } from './videoEditService'
import { readMotionPages, readMotionResource } from './videoEditMotionResources'

const logger = createLogger('features.videoEdit.motionGroup')

/** 整组按页展开，模型拿到原始比例姿态、双时钟和讲解；不重放录制操作。 */
export async function readVideoMotionGroup(id: string, draftId: string, offset: number, signal: AbortSignal): Promise<{ lines: string[]; nextOffset: number | null }> {
  const owner = requireVideoEditInstance(id), head = owner.document.creativeIntents
  const draft = head?.drafts.find(value => value.id === draftId)
  if (!head || !draft) throw new Error('超级关键帧组已不存在，请重新读取草稿列表。')
  const session = head.sessions.find(value => value.id === superKeyframeSessionId(draftId))
  if (session && !session.consent?.textUpload) throw new Error('PERMISSION_DENIED:这组讲解尚未授权读取。')
  const assertCurrent = (): void => {
    signal.throwIfAborted()
    if (requireVideoEditInstance(id) !== owner || owner.document.creativeIntents !== head) throw new Error('超级关键帧组已变化，请从第一页重新读取。')
  }
  async function* records(): AsyncGenerator<string> {
    yield JSON.stringify({ kind: 'super-keyframes', draftId, units: { position: '画幅比例，中心为 [0.5,0.5]；写 x/y 时减去 0.5', rotationTurns: '圈；写 rotation 时乘 360', scaleXY: '倍率', monoUs: '同组单调微秒', frame: '序列整数帧；写关键帧 time 时减去片段 start' }, apply: '默认直接应用：先读取目标当前关键帧，保留未修改范围，在一次 change_application_entities 中写所有目标的 *.keyframes；整组一次撤销。只有用户要挑选时才生成候选。录制命令是证据，不可重放。' })
    for (const target of draft!.targets) {
      const sequence = owner.document.sequences.find(value => value.clips.some(clip => `${id}:${clip.id}` === target.ref.id))
      const clip = sequence?.clips.find(value => `${id}:${value.id}` === target.ref.id)
      yield JSON.stringify({ kind: 'target', ...target, current: clip ? { name: clip.name, start: clip.start, duration: clip.duration, curves: clip.curves, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${sequence!.id}` }, frameRate: sequence!.frameRate } : null })
    }
    for (const clock of draft!.clockSegments) yield JSON.stringify({ kind: 'clock', ...clock })
    for (const take of draft!.takes) {
      const targets = new Map<string, { kind: string; id: string }>()
      for await (const page of readMotionPages(id, { ...draft!, takes: [take] })) {
        assertCurrent()
        if (page.kind === 'samples') for (const sample of page.entries) { targets.set(sample.targetRef.id, sample.targetRef); yield JSON.stringify({ kind: 'sample', ...sample }) }
      }
      yield JSON.stringify({ kind: 'take', ...take, targetRefs: [...targets.values()] })
    }
    if (session) {
      const read = async (resourceId: string): Promise<unknown> => {
        assertCurrent()
        const resource = head!.resources.find(value => value.resourceId === resourceId && value.kind === 'page')
        if (!resource) throw new Error('讲解记录缺失，请恢复原文件。')
        return readMotionResource(resource)
      }
      const includes = (at: number, end = at): boolean => draft!.takes.some(take => take.monoSpanUs[0] <= end && at <= take.monoSpanUs[1])
      const retainedEvents = async function* (): AsyncGenerator<ExplanationEvent> {
        for await (const event of semanticRecordingEvents(session!, read)) if (includes(event.monoUs, event.kind === 'transcript' ? event.monoSpanUs[1] : event.monoUs)) yield event
      }
      const retainedSession = { ...session, finalPoseRefs: [], bindings: [], clockSegments: session.clockSegments.filter(clock => includes(...clock.monoSpanUs)), visualEvidenceRefs: session.visualEvidenceRefs.filter(visual => visual.frames.some(frame => includes(frame.monoUs))) }
      for await (const line of serializeRecordingInput(retainedSession, retainedEvents(), { size: draft!.targets[0]?.compositionSize ?? [1, 1], includeImages: false, directApplication: true })) yield line
      for (const visual of retainedSession.visualEvidenceRefs) yield JSON.stringify({ ...visual, recordType: 'visual-reference', documentRef: { kind: 'video_edit.document', id }, sessionId: session.id, read: '使用 read_video_edit_intent_recording 的图片分页读取实际图像；仅采用此处列出的画面，已删段落不可用于应用。引用本身不代表看过画面。' })
    }
  }
  logger.info('读取超级关键帧组', { event: 'video_edit.motion_group.read.start', context: { documentId: id, draftId, offset } })
  try {
    const lines: string[] = []; let index = 0, size = 0
    for await (const line of records()) {
      assertCurrent()
      // 大记录按字符片段分页，避免单个长段突破工具输出预算。
      const parts = line.length > 12_000 ? Array.from({ length: Math.ceil(line.length / 12_000) }, (_, part) => JSON.stringify({ kind: 'record-fragment', record: index, part, count: Math.ceil(line.length / 12_000), text: line.slice(part * 12_000, (part + 1) * 12_000) })) : [line]
      for (const part of parts) {
        if (index++ < offset) continue
        if (lines.length && (lines.length >= 64 || size + part.length > 24_000)) {
          logger.info('超级关键帧分页读取完成', { event: 'video_edit.motion_group.read.completed', context: { documentId: id, draftId, nextOffset: index - 1 } })
          return { lines, nextOffset: index - 1 }
        }
        lines.push(part); size += part.length
      }
    }
    assertCurrent()
    logger.info('超级关键帧组读取完成', { event: 'video_edit.motion_group.read.completed', context: { documentId: id, draftId } })
    return { lines, nextOffset: null }
  } catch (error) { logger.warn('超级关键帧组读取失败', { event: 'video_edit.motion_group.read.failed', error }); throw error }
}
