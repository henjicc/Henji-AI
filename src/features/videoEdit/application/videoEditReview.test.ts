// @vitest-environment jsdom
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { queryVideoEditReviewCapability } from '@/core/application-control/domains/videoEdit/videoEditReviewCapability'
import { createVideoEditTrackHeader, videoEditTrackerKey, type VideoEditTracker } from '@/core/videoEdit/tracking'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { closeAllVideoEdits, createVideoEditTestProject, reopenVideoEdit } from './videoEditDocumentTestKit'
import { editVideoProject } from './videoEditService'
import { queryVideoEditReview } from './videoEditReview'
import { videoEditObservationVersion } from './videoEditObservationVersion'
import * as tracking from './videoEditTracking'
import * as trackReader from '../engine/videoEditTrackResults'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { collectVideoEditMotionStructure } from '@/core/videoEdit/motionStructure'
import type { VideoEditMotionReviewRequest, VideoEditMotionReviewResponse } from '../engine/videoEditMotionReviewWorker'

class MotionWorker {
  static instances: MotionWorker[] = []
  static automatic = true
  onmessage: ((event: MessageEvent<VideoEditMotionReviewResponse>) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  request!: VideoEditMotionReviewRequest
  constructor() { MotionWorker.instances.push(this) }
  postMessage(request: VideoEditMotionReviewRequest): void { this.request = request; if (MotionWorker.automatic) queueMicrotask(() => this.respond()) }
  respond(): void { this.onmessage?.({ data: { result: collectVideoEditMotionStructure(this.request.composition, this.request.range, this.request.policy) } } as MessageEvent<VideoEditMotionReviewResponse>) }
}

const parse = queryVideoEditReviewCapability.outputSchema.parse
const context = () => ({ signal: new AbortController().signal })
const tracker: VideoEditTracker = { id: 'follow', name: '主体', method: 'box', prompts: [{ timeUs: 0, box: [.1, .1, .5, .5] }] }
const key = videoEditTrackerKey('media', tracker)
let handles: ReturnType<typeof tracking.videoEditTrackResults>
let trackingRevision: number
const data = () => createVideoEditTrackHeader({ method: 'box', model: 'test', fps: 10, firstFrame: 0, frameCount: 10, sourceWidth: 64, sourceHeight: 64, promptFrames: [0], boxes: Array.from({ length: 10 }, (_, index) => index === 3 || index === 4 ? null : [0, 0, .5, .5, index === 6 ? .2 : .9]), summary: { tracked: 8, lost: 2 } })
beforeEach(() => {
  installHarnessNativeStorage(); handles = { [key]: { url: 'henji-media://track', version: '1' } }; trackingRevision = 1
  vi.spyOn(tracking, 'videoEditTrackResults').mockImplementation(() => handles)
  vi.spyOn(tracking, 'videoEditTrackingRevision').mockImplementation(() => trackingRevision)
  vi.spyOn(trackReader, 'readVideoEditTrackReviewHeader').mockImplementation(async () => data())
  vi.spyOn(getPlatform().tracking, 'status').mockResolvedValue({ state: 'ready', result: { path: path.resolve(path.sep, 'track.htrk'), startUs: 0, endUs: 10000000, fps: 10, summary: { tracked: 8, lost: 2 } } })
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = await createVideoEditTestProject(); const sequenceId = owner.document.sequences[0].id
  editVideoProject(owner.document.id, document => {
    document.media = [{ id: 'media', kind: 'video', name: '视频', path: path.resolve(path.sep, 'review.mp4'), width: 64, height: 64, durationSeconds: 10 }]
    document.items = [{ id: 'item', kind: 'video', name: '视频', mediaId: 'media' }]
    const sequence = document.sequences[0]
    const base = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 60 })
    sequence.clips = [{ ...base, id: 'a', trackers: [tracker] }, { ...base, id: 'b', start: 90, duration: 30, trackers: [tracker] }]
    sequence.captions = [{ id: 'caption', text: '需要检查', start: 10, duration: 15 }]
    return document
  })
  return { owner, input: { documentRef: { kind: 'video_edit.document', id: owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequenceId}` }, from: 0, to: 120 } }
}
it('public native-motion review returns frame-bound evidence and local suggestions without editing the work, and pages reuse the finished computation', async () => {
  const { owner, input } = await fixture(); const app = createApplicationHarness()
  MotionWorker.instances = []; MotionWorker.automatic = true; vi.stubGlobal('Worker', MotionWorker)
  editVideoProject(owner.document.id, document => {
    document.sequences[0].clips[0].curves = { x: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 15, value: .5, interpolation: 'linear' }] }
    return document
  })
  const before = structuredClone(owner.document), past = owner.past.length, frame = owner.frame
  try {
    const first = parse(await app.requireResult('query_video_edit_review', { ...input, motion: {}, limit: 1 }))
    const records = [...first.records]; let cursor = first.nextCursor
    while (cursor) {
      const page = parse(await app.requireResult('query_video_edit_review', { ...input, motion: {}, limit: 1, cursor }))
      records.push(...page.records); cursor = page.nextCursor
    }
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'motion', subjectRef: { kind: 'video_edit.clip', id: `${owner.document.id}:a` }, motionEvidence: { basis: 'clip_transform', peakSpeed: expect.any(Number), suggestion: expect.any(String) } }),
      expect.objectContaining({ kind: 'motion_hard_stop', timeline: { fromFrame: 15, toFrame: 17 } }),
      expect.objectContaining({ kind: 'motion_hold' }),
      expect.objectContaining({ kind: 'event_crowded', subjectRef: { kind: 'video_edit.sequence', id: input.sequenceRef.id } }),
    ]))
    expect(MotionWorker.instances).toHaveLength(1); expect(MotionWorker.instances[0].terminate).toHaveBeenCalledOnce()
    expect(first.warnings.join('')).toContain('变换保持不等于画面静止')
    expect(owner.document).toEqual(before); expect(owner.past.length).toBe(past); expect(owner.frame).toBe(frame)
    await expect(queryVideoEditReview({ ...input, motion: { minGapSeconds: 0 }, cursor: first.nextCursor }, context())).rejects.toThrow('分页已失效')
  } finally { app.dispose() }
})
it.each(['changed', 'cancelled'] as const)('a pending native-motion query %s rejects its old plan', async kind => {
  const { owner, input } = await fixture()
  MotionWorker.instances = []; MotionWorker.automatic = false; vi.stubGlobal('Worker', MotionWorker)
  const controller = new AbortController(), pending = queryVideoEditReview({ ...input, motion: {} }, { signal: controller.signal })
  await vi.waitFor(() => expect(MotionWorker.instances).toHaveLength(1))
  const rejected = expect(pending).rejects.toThrow()
  if (kind === 'changed') editVideoProject(owner.document.id, document => { document.sequences[0].name = '新的剪辑'; return document })
  else controller.abort(new Error('取消分析'))
  MotionWorker.instances[0].respond(); await rejected
})
it('公共查询选出有界检查帧并区分同素材两次跟踪实例，不运行模型、不改变历史或视图', async () => {
  const { owner, input } = await fixture(); const app = createApplicationHarness()
  const before = structuredClone(owner.document); const history = owner.past.length; const frame = owner.frame
  const renderState = vi.spyOn(trackReader, 'setVideoEditTrackResults'); const start = vi.spyOn(getPlatform().tracking, 'run')
  try {
    const result = parse(await app.requireResult('query_video_edit_review', input))
    expect(result.checkpoints.frames.length).toBeLessThanOrEqual(8)
    expect(result.checkpoints.frames.every(frame => frame >= 0 && frame < 120)).toBe(true)
    const lost = result.records.filter(record => record.kind === 'tracking_lost')
    expect(lost.map(record => record.path[0].clipRef.id)).toEqual([`${owner.document.id}:a`, `${owner.document.id}:b`])
    expect(lost[0]).toMatchObject({ timeline: { fromFrame: 9, toFrame: 15 }, subjectRef: { kind: 'video_edit.tracker', id: `${owner.document.id}:tracker:1:afollow` } })
    expect(result.records.some(record => record.kind === 'tracking_uncovered')).toBe(true)
    expect(trackReader.readVideoEditTrackReviewHeader).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled(); expect(renderState).not.toHaveBeenCalled()
    expect(owner.document).toEqual(before); expect(owner.past.length).toBe(history); expect(owner.frame).toBe(frame)
    const ref = lost[0].subjectRef
    const read = await app.requireResult('read_application_entity', { ref, propertyIds: ['video_edit.tracker.prompts'] })
    expect(JSON.stringify(read)).toContain('timeUs')
  } finally { app.dispose() }
})
it('分页绑定文档、跟踪结果和查询条件，结果副本不能污染缓存；进度变化不使版本失效', async () => {
  const { owner, input } = await fixture()
  const first = parse(await queryVideoEditReview({ ...input, limit: 1 }, context())); expect(first.nextCursor).not.toBeNull()
  first.checkpoints.frames.push(1000); first.records[0].subjectRef.id = 'polluted'
  trackingRevision++
  const second = parse(await queryVideoEditReview({ ...input, limit: 1, cursor: first.nextCursor }, context()))
  expect(second.documentVersion).toBe(first.documentVersion); expect(second.checkpoints.frames).not.toContain(1000)
  expect(second.records[0].subjectRef.id).not.toBe('polluted')
  await expect(queryVideoEditReview({ ...input, threshold: .1, cursor: first.nextCursor }, context())).rejects.toThrow('失效')
  handles = { [key]: { url: 'henji-media://track', version: '2' } }; trackingRevision++
  await expect(queryVideoEditReview({ ...input, cursor: first.nextCursor }, context())).rejects.toThrow('失效')
  expect(videoEditObservationVersion(owner, owner.document.revision)).not.toBe(first.documentVersion)
  const fresh = parse(await queryVideoEditReview({ ...input, limit: 1 }, context()))
  editVideoProject(owner.document.id, document => { document.sequences[0].captions![0].text = '已改'; return document })
  await expect(queryVideoEditReview({ ...input, cursor: fresh.nextCursor }, context())).rejects.toThrow('失效')
  const reopenedPlan = parse(await queryVideoEditReview({ ...input, limit: 1 }, context()))
  await reopenVideoEdit(owner.document.id)
  await expect(queryVideoEditReview({ ...input, cursor: reopenedPlan.nextCursor }, context())).rejects.toThrow('失效')
})
it('已有结果缺失时明确待复核，读取失败不会伪装为跟踪正常', async () => {
  const { input } = await fixture(); handles = {}; trackingRevision++
  const absent = parse(await queryVideoEditReview(input, context()))
  expect(absent.records.filter(record => record.kind === 'tracking_unavailable')).toHaveLength(2)
  expect(trackReader.readVideoEditTrackReviewHeader).not.toHaveBeenCalled()
  handles = { [key]: { url: 'henji-media://track', version: '2' } }; trackingRevision++
  vi.mocked(trackReader.readVideoEditTrackReviewHeader).mockRejectedValue(new Error('无法读取'))
  const failed = parse(await queryVideoEditReview(input, context()))
  expect(failed.records.filter(record => record.kind === 'tracking_unavailable')).toHaveLength(2)
  expect(failed.warnings).toContain('部分已有跟踪结果不可读，请稍后复核或重新跟踪。')
})
it('查询取消、读取中编辑或跟踪结果更新，不交付旧计划', async () => {
  const { owner, input } = await fixture(); const controller = new AbortController(); controller.abort()
  await expect(queryVideoEditReview(input, { signal: controller.signal })).rejects.toThrow()
  vi.mocked(trackReader.readVideoEditTrackReviewHeader).mockImplementationOnce(async () => {
    handles = { [key]: { url: 'henji-media://track', version: 'updated' } }; trackingRevision++; return data()
  })
  await expect(queryVideoEditReview(input, context())).rejects.toThrow('跟踪结果已改变')
  vi.mocked(trackReader.readVideoEditTrackReviewHeader).mockImplementationOnce(async () => {
    editVideoProject(owner.document.id, document => { document.sequences[0].name = '已改'; return document }); return data()
  })
  await expect(queryVideoEditReview(input, context())).rejects.toThrow('已改变')
})
it('只读授权可查询；范围、完整序列引用和输出预算受公共契约约束', async () => {
  const { input } = await fixture(); const app = createApplicationHarness()
  const grant = createApplicationCallerGrant({ callerId: 'review-read', capabilityIds: ['query_video_edit_review'], permissions: ['video_edit:read'], allowWrites: false, allowDestructive: false })
  const session = createApplicationCapabilitySession(grant)
  try {
    const response = await session.execute({ id: 'query_video_edit_review', version: 1, input }, { ...context(), requestId: crypto.randomUUID() })
    expect(response).toMatchObject({ ok: true, data: { checkpoints: { selection: 'prioritized_sample' } } })
    for (const patch of [{ maxFrames: 13 }, { threshold: -1 }, { limit: 51 }, { from: .5 }, { to: 0 }]) expect(queryVideoEditReviewCapability.inputSchema.safeParse({ ...input, ...patch }).success).toBe(false)
    await expect(queryVideoEditReview({ ...input, documentRef: { ...input.documentRef, id: 'other' } }, context())).rejects.toThrow('必须属于')
    await expect(queryVideoEditReview({ ...input, from: 120, to: 150 }, context())).rejects.toThrow('序列时长')
  } finally { app.dispose() }
})
it('返回的跟踪器沿正式描述、属性事务、回读补锚点，保留其他提示和重复实例并可撤销', async () => {
  const { owner, input } = await fixture(); const app = createApplicationHarness()
  try {
    const review = parse(await app.requireResult('query_video_edit_review', input))
    const ref = review.records.find(record => record.kind === 'tracking_lost')!.subjectRef
    const description = await app.requireResult('describe_application_entities', { entityTypes: ['video_edit.tracker'], refs: [ref] })
    expect(JSON.stringify(description)).toContain('video_edit.tracker.prompts')
    const history = owner.past.length
    const prompts = [...tracker.prompts, { timeUs: 350000, box: [.2, .2, .4, .4] }]
    const changed = await app.change(ref, { 'video_edit.tracker.prompts': prompts })
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    const read = await app.requireResult('read_application_entity', { ref, propertyIds: ['video_edit.tracker.prompts'] })
    expect(read.properties).toMatchObject({ 'video_edit.tracker.prompts': prompts })
    expect(owner.document.sequences[0].clips[1].trackers![0].prompts).toEqual(tracker.prompts)
    expect(owner.past.length).toBe(history + 1)
    await app.requireResult('undo_video_edit', { documentRef: input.documentRef })
    expect(owner.document.sequences[0].clips[0].trackers![0].prompts).toEqual(tracker.prompts)
  } finally { app.dispose() }
})
