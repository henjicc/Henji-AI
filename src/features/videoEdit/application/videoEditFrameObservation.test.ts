
import { askAssistantAtVideoEditFrame, createVideoEditAnnotation } from './videoEditAnnotations'
import { useAssistantUiStore } from '@/features/assistant/store/assistantUiStore'
import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { getPlatform } from '@/platform/runtime'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { appendVideoEditMedia, appendVideoEditClip, closeVideoEditProject, listVideoEditInstances, setVideoEditView } from './videoEditService'
import { editVideoProject } from './videoEditService'



import { videoEditContactSheetLayout } from './videoEditContactSheet'
import { videoEditComposition } from '@/core/videoEdit/document'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import { observeVideoEditFrame } from './videoEditFrameObservation'
import { queryVideoEditReview } from './videoEditReview'
import * as tracking from './videoEditTracking'
import { videoEditObservationVersion } from './videoEditObservationVersion'
import { invalidateCodeTextMetrics } from '../videoEditGlyphMetrics'
import { collectVideoEditPixelMotion } from '@/core/videoEdit/pixelMotionReview'
import type { VideoEditMotionReviewRequest, VideoEditMotionReviewResponse } from '../engine/videoEditMotionReviewWorker'

// The production renderer is the replaced pixel boundary; composition building, scaling,
// library collection and the public capability are real.
const render = vi.hoisted(() => ({ calls: [] as Array<{ document: VideoEditComposition; frame: number }>, performance: [] as import('@/core/videoEdit/codeMaterial/performance').CodeFramePerformance[] }))
const hostIdentity = vi.hoisted(() => ({ epoch: 'renderer-before-restart' }))
vi.mock('@/core/application-control/runtimeIdentity', () => ({ get rendererEpoch() { return hostIdentity.epoch } }))
vi.mock('./videoEditCodeTrial', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), trialVideoEditCodeFrames: vi.fn(async (frames: Array<{ document: VideoEditComposition; frame: number }>, _signal?: AbortSignal, _keep?: boolean, _collect?: ImageBitmap[], measurements?: import('@/core/videoEdit/codeMaterial/performance').CodeFramePerformance[]) => {
  measurements?.push(...render.performance)
  render.calls.push(...frames); const last = frames.at(-1)!
  return { width: last.document.width, height: last.document.height, close: vi.fn() }
}) }))
vi.mock('mediabunny', () => ({ ALL_FORMATS: [], UrlSource: class {}, Input: class { async getPrimaryVideoTrack() { return null } async getPrimaryAudioTrack() { return null } async computeDuration() { return 0 } dispose() {} } }))
const assets = new Map<string, AssetRecord>(); const drawn: number[][] = []; const pixels = { labels: [] as string[], rectangles: [] as number[][] }
let encodedSize = { width: 0, height: 0 }
beforeEach(() => {
  installHarnessNativeStorage(); assets.clear(); render.calls = []; render.performance = []; drawn.length = 0; pixels.labels = []; pixels.rectangles = []
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {}
    getContext() { return { imageSmoothingQuality: 'low', drawImage: (_image: unknown, ...args: number[]) => drawn.push(args), save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), strokeRect: (...args: number[]) => pixels.rectangles.push(args), fillRect: vi.fn(), measureText: (text: string) => ({ width: text.length * 14 }), fillText: (text: string) => pixels.labels.push(text) } }
    async convertToBlob() { encodedSize = { width: this.width, height: this.height }; return new NativeBlob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }) } })
  vi.stubGlobal('crypto', webcrypto)
  const cached = new Map<string, Uint8Array>()
  const platform = getPlatform(); let size = { width: 0, height: 0 }
  vi.spyOn(platform.system.paths, 'tempDir').mockResolvedValue(os.tmpdir())
  vi.spyOn(platform.system.paths, 'join').mockImplementation(async (...parts) => path.join(...parts))
  vi.spyOn(platform.system.fs, 'mkdir').mockResolvedValue(undefined)
  vi.spyOn(platform.system.fs, 'exists').mockImplementation(async file => cached.has(file))
  vi.spyOn(platform.system.fs, 'writeFile').mockImplementation(async (file, bytes) => { cached.set(file, bytes) })
  vi.spyOn(platform.system.fs, 'readFile').mockImplementation(async file => cached.get(file)!)
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue('D:/observe.hjvid')
  vi.spyOn(platform.system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue('D:/managed')
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(platform.image, 'persistImageBinary').mockImplementation(async () => { size = encodedSize; return `D:/managed/observe-${drawn.length}.png` })
  vi.spyOn(platform.assetLibrary, 'createAsset').mockImplementation(async input => {
    const value: AssetRecord = { id: `asset-${assets.size + 1}`, filePath: input.filePath, mediaType: 'image', displayName: input.displayName ?? '', displayUrl: '', source: input.source, mimeType: 'image/png', sizeBytes: 4, width: size.width, height: size.height, durationSeconds: 0, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1, contentIdentity: 'd'.repeat(64), lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
    assets.set(value.id, value); return value
  })
  vi.spyOn(platform.assetLibrary, 'inspectAsset').mockImplementation(async id => structuredClone(assets.get(id)!))
  // 观察图打“助手观察”标签并在后台按保留规则清理（规则本身见 observationAssets.test）
  vi.spyOn(platform.assetLibrary, 'setAssetTags').mockImplementation(async (id, tags) => { const value = assets.get(id)!; value.tags = tags; return structuredClone(value) })
  vi.spyOn(platform.assetLibrary, 'queryAssets').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 })
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); useAssistantUiStore.getState().setPendingGoal(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

it('联系表经公共能力输出按时间顺序的网格和时间码，只缓存一张图片，非法范围点名字段', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id; const app = createApplicationHarness()
  appendVideoEditMedia(id, { id: 'sheet-media', name: '原片', path: 'D:/sheet.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 10 })
  appendVideoEditClip(id, 'sheet-media'); setVideoEditView(id, { frame: 7 })
  const input = { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'contact_sheet', startFrame: 0, endFrame: 120, frameCount: 5 }, maxWidth: 960 }
  try {
    const result = await app.requireResult('observe_video_edit_frame', input)
    expect(result).toMatchObject({ width: 960, height: 360, contactSheet: { frames: [0, 30, 60, 90, 120], columns: 3, rows: 2 }, resultRef: { kind: 'observation.image' }, storage: 'cache', reused: false })
    expect(render.calls.map(call => call.frame)).toEqual([0, 30, 60, 90, 120])
    expect(drawn).toEqual([[0, 0, 320, 180], [320, 0, 320, 180], [640, 0, 320, 180], [0, 180, 320, 180], [320, 180, 320, 180]])
    expect(pixels.labels).toEqual(['00:00:00:00', '00:00:01:00', '00:00:02:00', '00:00:03:00', '00:00:04:00'])
    expect(assets.size).toBe(0); expect(owner.frame).toBe(7)
    const composition = videoEditComposition(owner.document, owner.activeSequenceId)
    const portrait = videoEditContactSheetLayout({ ...composition, width: 4320, height: 7680 }, { startFrame: 0, endFrame: 120, frameCount: 12 }, 3840)
    expect(portrait.columns).toBe(4); expect(portrait.rows).toBe(3)
    expect(portrait.width).toBeLessThanOrEqual(3840); expect(portrait.height).toBeLessThanOrEqual(3840)
    for (const [field, value] of [['startFrame', -1], ['endFrame', 1000000], ['endFrame', 0], ['frameCount', 1], ['frameCount', 13]] as const) {
      const failed = await app.call('observe_video_edit_frame', { ...input, target: { ...input.target, [field]: value } })
      expect(failed.ok).toBe(false); expect(JSON.stringify(failed)).toContain(field)
    }
    const crowded = await app.call('observe_video_edit_frame', { ...input, target: { ...input.target, endFrame: 1, frameCount: 3 } })
    expect(crowded.ok).toBe(false); expect(JSON.stringify(crowded)).toContain('frameCount')
    expect(render.calls).toHaveLength(5)
  } finally { app.dispose() }
})

async function inspectionFixture() {
  const owner = await createVideoEditProject(); const id = owner.document.id
  appendVideoEditMedia(id, { id: 'inspection-video', name: '原片', path: '/inspection.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 5 })
  appendVideoEditClip(id, 'inspection-video'); setVideoEditView(id, { frame: 12 })
  return { owner, id, documentRef: { kind: 'video_edit.document', id } }
}
it('检查计划直接交给取帧，编辑后拒绝旧版本且不启动渲染', async () => {
  const { owner, documentRef } = await inspectionFixture(); const app = createApplicationHarness()
  const sequenceRef = { kind: 'video_edit.sequence', id: `${owner.document.id}:${owner.activeSequenceId}` }
  try {
    const plan = await queryVideoEditReview({ documentRef, sequenceRef, from: 0, to: 90 }, { signal: new AbortController().signal })
    const checkpoints = plan.checkpoints as { frames: number[] }
    const input = { documentRef, documentVersion: plan.documentVersion, target: { kind: 'frames', sequenceRef, frames: checkpoints.frames } }
    const observed = await app.requireResult('observe_video_edit_frame', input)
    expect(observed.documentVersion).toBe(plan.documentVersion)
    const rendered = render.calls.length
    editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].name = '改变作品'; return document })
    const stale = await app.call('observe_video_edit_frame', input)
    expect(stale.ok).toBe(false); expect(JSON.stringify(stale)).toContain('重新查询检查点')
    expect(render.calls).toHaveLength(rendered); expect(owner.frame).toBe(12)
    const refreshed = await queryVideoEditReview({ documentRef, sequenceRef, from: 0, to: 90 }, { signal: new AbortController().signal })
    const recovered = await app.requireResult('observe_video_edit_frame', { ...input, documentVersion: refreshed.documentVersion, target: { kind: 'frames', sequenceRef, frames: (refreshed.checkpoints as { frames: number[] }).frames } })
    expect(recovered.documentVersion).toBe(refreshed.documentVersion)
  } finally { app.dispose() }
})
it('font changes invalidate the inspection-to-observation plan even without a document edit', async () => {
  const { owner, documentRef } = await inspectionFixture(), app = createApplicationHarness()
  const sequenceRef = { kind: 'video_edit.sequence', id: `${owner.document.id}:${owner.activeSequenceId}` }
  try {
    const plan = await queryVideoEditReview({ documentRef, sequenceRef, from: 0, to: 90 }, { signal: new AbortController().signal })
    const rendered = render.calls.length, revision = owner.document.revision
    invalidateCodeTextMetrics()
    const stale = await app.call('observe_video_edit_frame', { documentRef, documentVersion: plan.documentVersion, target: { kind: 'frames', sequenceRef, frames: (plan.checkpoints as { frames: number[] }).frames } })
    expect(stale.ok).toBe(false); expect(JSON.stringify(stale)).toContain('重新查询检查点')
    expect(render.calls).toHaveLength(rendered); expect(owner.document.revision).toBe(revision)
    const fresh = await queryVideoEditReview({ documentRef, sequenceRef, from: 0, to: 90 }, { signal: new AbortController().signal })
    const observed = await app.requireResult('observe_video_edit_frame', { documentRef, documentVersion: fresh.documentVersion, target: { kind: 'frames', sequenceRef, frames: (fresh.checkpoints as { frames: number[] }).frames } })
    expect(observed.documentVersion).toBe(fresh.documentVersion)
  } finally { app.dispose() }
})
it('pixel plans pin managed files only for observation, reject replacement before rendering, and recover with a fresh plan', async () => {
  const { owner, documentRef } = await inspectionFixture(), app = createApplicationHarness(), platform = getPlatform()
  const sequenceRef = { kind: 'video_edit.sequence', id: `${owner.document.id}:${owner.activeSequenceId}` }
  let identity = 'a'.repeat(64)
  vi.spyOn(platform.assetLibrary, 'inspectFileContent').mockImplementation(async () => ({ contentIdentity: identity, sizeBytes: 1000, fileModifiedAt: 1000 }))
  vi.spyOn(platform.sceneDetection, 'onProgress').mockReturnValue(() => undefined)
  vi.spyOn(platform.sceneDetection, 'detect').mockImplementation(async request => ({ cutsSeconds: [], contentIdentity: 'd'.repeat(64), motionScan: {
    startSeconds: request.startSeconds, endSeconds: request.endSeconds, samplingFps: 15, width: 320, height: 180, sampledFrames: Math.ceil((request.endSeconds - request.startSeconds) * 15),
    samples: Array.from({ length: Math.ceil((request.endSeconds - request.startSeconds) * 15) }, (_, i) => ({ fromSeconds: request.startSeconds + i / 15, toSeconds: Math.min(request.endSeconds, request.startSeconds + (i + 1) / 15), speed: 10, zoom: 0, change: 0, cut: false, still: false })),
  } }))
  vi.stubGlobal('Worker', class {
    onmessage: ((event: MessageEvent<VideoEditMotionReviewResponse>) => void) | null = null
    terminate(): void {}
    postMessage(request: VideoEditMotionReviewRequest): void { queueMicrotask(() => this.onmessage?.({ data: { result: { records: collectVideoEditPixelMotion(request.pixels ?? [], request.composition.fps, request.policy), sampledFrames: 0, sampledInstances: 0 } } } as MessageEvent<VideoEditMotionReviewResponse>)) }
  })
  const query = () => queryVideoEditReview({ documentRef, sequenceRef, from: 0, to: 90, motion: { videoPixels: true } }, { signal: new AbortController().signal })
  const observe = (plan: Record<string, unknown>) => app.call('observe_video_edit_frame', { documentRef, documentVersion: plan.documentVersion, target: { kind: 'frames', sequenceRef, frames: (plan.checkpoints as { frames: number[] }).frames } })
  try {
    const plan = await query(), revision = owner.document.revision
    expect((await observe(plan)).ok).toBe(true)
    expect(render.calls[0].document.media[0]).toMatchObject({ assetContent: { contentIdentity: identity }, sourceRevision: expect.stringContaining(':review:') })
    expect(owner.document.media[0].assetContent).toBeUndefined()
    const count = render.calls.length; identity = 'b'.repeat(64)
    expect((await observe(plan)).ok).toBe(false); expect(render.calls).toHaveLength(count)
    const fresh = await query()
    expect(fresh.documentVersion).not.toBe(plan.documentVersion)
    expect((await observe(fresh)).ok).toBe(true)
    expect(owner.document.revision).toBe(revision); expect(owner.document.media[0].assetContent).toBeUndefined()
    vi.mocked(trialVideoEditCodeFrames).mockImplementationOnce(async frames => { identity = 'c'.repeat(64); return { width: frames[0].document.width, height: frames[0].document.height, close: vi.fn() } as unknown as ImageBitmap })
    expect((await observe(fresh)).ok).toBe(false)
  } finally { app.dispose() }
})
it('作品未编辑但已有跟踪结果更新时也拒绝旧观察计划，进度单独变化不影响版本', async () => {
  const { owner, documentRef } = await inspectionFixture(); const app = createApplicationHarness()
  let revision = 1; let handles: ReturnType<typeof tracking.videoEditTrackResults> = {}
  vi.spyOn(tracking, 'videoEditTrackingRevision').mockImplementation(() => revision)
  vi.spyOn(tracking, 'videoEditTrackResults').mockImplementation(() => handles)
  vi.spyOn(getPlatform().tracking, 'status').mockResolvedValue({ state: 'failed', reason: 'decode' })
  editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].clips[0].trackers = [{ id: 't', name: '跟踪', method: 'box', prompts: [{ timeUs: 0, box: [.1, .1, .5, .5] }] }]; return document })
  const version = videoEditObservationVersion(owner, owner.document.revision)
  const documentRevision = owner.document.revision
  try {
    revision++; expect(videoEditObservationVersion(owner, owner.document.revision)).toBe(version)
    handles = { changed: { url: 'henji-media://tracking', version: 'new' } }; revision++
    const rejected = await app.call('observe_video_edit_frame', { documentRef, documentVersion: version, target: { kind: 'program', frame: 0 } })
    expect(rejected.ok).toBe(false); expect(JSON.stringify(rejected)).toContain('跟踪结果已改变')
    expect(owner.document.revision).toBe(documentRevision); expect(render.calls).toHaveLength(0)
  } finally { app.dispose() }
})
it('任意帧列表和切点连续帧经同一观察入口，去重排序、不改播放头和文档', async () => {
  const { owner, documentRef } = await inspectionFixture(); const app = createApplicationHarness()
  const document = structuredClone(owner.document); const history = owner.past.length
  try {
    const list = await app.requireResult('observe_video_edit_frame', { documentRef, target: { kind: 'frames', frames: [61, 59, 60, 59] } })
    expect(list).toMatchObject({ contactSheet: { frames: [59, 60, 61] } })
    const near = await app.requireResult('observe_video_edit_frame', { documentRef, target: { kind: 'near_cut', cutFrame: 60, before: 2, after: 1 } })
    expect(near).toMatchObject({ contactSheet: { frames: [58, 59, 60, 61] }, documentVersion: list.documentVersion })
    const first = await app.requireResult('observe_video_edit_frame', { documentRef, target: { kind: 'near_cut', cutFrame: 0 } })
    expect(first).toMatchObject({ contactSheet: { frames: [0, 1, 2] } })
    expect(render.calls.map(call => call.frame)).toEqual([59, 60, 61, 58, 59, 60, 61, 0, 1, 2])
    expect(owner.frame).toBe(12); expect(owner.document).toEqual(document); expect(owner.past.length).toBe(history)
  } finally { app.dispose() }
})
it('临时区域直接裁切合成和源画面，无需创建标注，联系表也复用同一裁切', async () => {
  const { owner, documentRef } = await inspectionFixture(); const app = createApplicationHarness()
  const document = structuredClone(owner.document); const cropRegion = { x: .25, y: .25, width: .5, height: .5 }
  try {
    const program = await app.requireResult('observe_video_edit_frame', { documentRef, target: { kind: 'program', frame: 1 }, cropRegion, maxWidth: 960 })
    expect(program).toMatchObject({ width: 960, height: 540, sourceWidth: 1920, sourceHeight: 1080 })
    expect(drawn[0]).toEqual([480, 270, 960, 540, 0, 0, 960, 540])
    const item = owner.document.items.find(item => item.mediaId === 'inspection-video')!
    await app.requireResult('observe_video_edit_frame', { documentRef, target: { kind: 'source', itemRef: { kind: 'video_edit.item', id: `${owner.document.id}:${item.id}` }, timeUs: 1000000 }, cropRegion, maxWidth: 960 })
    expect(drawn[1]).toEqual(drawn[0])
    await app.requireResult('observe_video_edit_frame', { documentRef, target: { kind: 'frames', frames: [0, 1] }, cropRegion, maxWidth: 960 })
    expect(drawn.slice(2).every(args => args.slice(0, 4).join() === '480,270,960,540')).toBe(true)
    expect(owner.document).toEqual(document)
  } finally { app.dispose() }
})
it('参考视频按成片时间加偏移逐帧并排，保持画幅、固定版本和实际源时间', async () => {
  const { owner, id, documentRef } = await inspectionFixture(); const app = createApplicationHarness()
  appendVideoEditMedia(id, { id: 'reference-video', name: '参考片', path: '/reference.mp4', kind: 'video', width: 1080, height: 1920, durationSeconds: 5, assetId: 'reference-asset', assetContent: { sizeBytes: 100, fileModifiedAt: 1 } })
  const item = owner.document.items.find(item => item.mediaId === 'reference-video')!
  const reference = { itemRef: { kind: 'video_edit.item', id: `${id}:${item.id}` }, offsetUs: 500000 }
  const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue({ contentIdentity: 'reference', sizeBytes: 100, fileModifiedAt: 1 })
  const document = structuredClone(owner.document)
  try {
    const result = await app.requireResult('observe_video_edit_frame', { documentRef, target: { kind: 'frames', frames: [0, 30] }, reference, maxWidth: 960 })
    expect(result).toMatchObject({ width: 960, height: 135, comparison: { referenceItemRef: reference.itemRef, referenceTimesUs: [500000, 1500000] }, contactSheet: { frames: [0, 30], columns: 4, rows: 1 } })
    expect(render.calls.map(call => call.frame)).toEqual([0, 0, 30, 0])
    expect(render.calls[1].document.clips[0].sourceInUs).toBe(500000)
    expect(render.calls[1].document.media[0].sourceRevision).toBe('observe:reference')
    expect(render.calls[3].document.clips[0].sourceInUs).toBe(1500000)
    expect(drawn[1]).toEqual([322.03125, 0, 75.9375, 135])
    expect(pixels.labels).toContain('参考 0.500 s'); expect(inspect).toHaveBeenCalledTimes(3)
    expect(owner.document).toEqual(document); expect(owner.frame).toBe(12)
  } finally { app.dispose() }
})
it('参考素材在渲染期间改变则拒绝旧比较，不发布图片', async () => {
  const { owner, id, documentRef } = await inspectionFixture(); const app = createApplicationHarness()
  const item = owner.document.items.find(item => item.mediaId === 'inspection-video')!
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent')
    .mockResolvedValueOnce({ contentIdentity: 'before', sizeBytes: 100, fileModifiedAt: 1 })
    .mockResolvedValue({ contentIdentity: 'after', sizeBytes: 101, fileModifiedAt: 2 })
  try {
    const result = await app.call('observe_video_edit_frame', { documentRef, target: { kind: 'program', frame: 30 }, reference: { itemRef: { kind: 'video_edit.item', id: `${id}:${item.id}` } } })
    expect(JSON.stringify(result)).toContain('参考素材已改变'); expect(assets.size).toBe(0)
  } finally { app.dispose() }
})
it('非法区域、越界帧、跨文档参考和冲突选项明确拒绝，不渲染', async () => {
  const { documentRef } = await inspectionFixture(); const app = createApplicationHarness()
  try {
    for (const input of [
      { target: { kind: 'frames', frames: [99999] } }, { target: { kind: 'frames', frames: [] } },
      { target: { kind: 'near_cut', cutFrame: 99999 } }, { target: { kind: 'near_cut', cutFrame: 1, before: 6 } },
      { target: { kind: 'program', frame: 1 }, cropRegion: { x: .8, y: 0, width: .5, height: .5 } },
      { target: { kind: 'program', frame: 1 }, cropRegion: { x: 1, y: 0, width: 1e-12, height: .5 } },
      { target: { kind: 'program', frame: 1 }, cropRegion: { x: 0, y: 0, width: .5, height: .5 }, cropAnnotationId: 'mark' },
      { target: { kind: 'program', frame: 1 }, reference: { itemRef: { kind: 'video_edit.item', id: 'other:item' } } },
      { target: { kind: 'frames', frames: [0] }, overlayAnnotations: true },
    ]) expect((await app.call('observe_video_edit_frame', { documentRef, ...input })).ok).toBe(false)
    expect(render.calls).toHaveLength(0); expect(assets.size).toBe(0)
  } finally { app.dispose() }
})
it('单帧与联系表都拒绝渲染期间改变的作品，取消及落盘期间修改不发布迟到资产', async () => {
  const { id, documentRef } = await inspectionFixture(); const app = createApplicationHarness()
  try {
    for (const target of [{ kind: 'program', frame: 0 }, { kind: 'frames', frames: [0, 1] }]) {
      vi.mocked(trialVideoEditCodeFrames).mockImplementationOnce(async inputs => {
        editVideoProject(id, document => ({ ...document, name: document.name + '修改' }))
        return { width: inputs[0].document.width, height: inputs[0].document.height, close: vi.fn() } as unknown as ImageBitmap
      })
      const result = await app.call('observe_video_edit_frame', { documentRef, target })
      expect(JSON.stringify(result)).toContain('观察期间剪辑已改变')
    }
    const controller = new AbortController(); controller.abort(new Error('取消观察'))
    await expect(observeVideoEditFrame(id, { kind: 'program', frame: 0 }, 960, controller.signal)).rejects.toThrow('取消观察')
    vi.mocked(getPlatform().system.fs.writeFile).mockImplementationOnce(async () => {
      editVideoProject(id, document => ({ ...document, name: document.name + '落盘修改' }))
    })
    expect((await app.call('observe_video_edit_frame', { documentRef, target: { kind: 'program', frame: 0 } })).ok).toBe(false)
    expect(assets.size).toBe(0)
  } finally { app.dispose() }
})

it('重启后同一修订号的截帧具有不同 documentVersion；同一快照稳定，编辑后变化', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  const app = createApplicationHarness()
  const input = { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'program', frame: 0 } }
  try {
    hostIdentity.epoch = 'renderer-before-restart'
    const first = await app.requireResult('observe_video_edit_frame', input)
    const same = await app.requireResult('observe_video_edit_frame', input)
    expect(first.documentVersion).toBe(same.documentVersion)
    // 模拟应用重新启动时宿主 epoch 更换而内容修订号相同；不改变落盘格式。
    hostIdentity.epoch = 'renderer-after-restart'
    const reopened = await app.requireResult('observe_video_edit_frame', input)
    expect(reopened.documentRevision).toBe(first.documentRevision)
    expect(reopened.documentVersion).not.toBe(first.documentVersion)
    editVideoProject(id, document => ({ ...document, name: '修改后的剪辑' }))
    const edited = await app.requireResult('observe_video_edit_frame', input)
    expect(edited.documentVersion).not.toBe(reopened.documentVersion)
    expect(edited.documentRevision).toBeGreaterThan(reopened.documentRevision as number)
  } finally { hostIdentity.epoch = 'renderer-before-restart'; app.dispose() }
})

it('公共观察按固定剪辑版本取指定合成帧与源时间画面，不改播放头，结果为可读资产', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'clip-media', name: '4K原片', path: 'D:/media/original.mp4', kind: 'video', width: 3840, height: 2160, durationSeconds: 7, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' })
  appendVideoEditClip(id, 'clip-media'); setVideoEditView(id, { frame: 3 })
  const item = owner.document.items.find(item => item.mediaId === 'clip-media')!
  const app = createApplicationHarness()
  try {
    const program = await app.requireResult('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'program', frame: 42 }, maxWidth: 960, saveToAssets: true })
    expect(render.calls[0]).toMatchObject({ frame: 42, document: { id: owner.activeSequenceId, revision: owner.document.revision } })
    expect(program).toMatchObject({ width: 960, height: 540, sourceWidth: 1920, sourceHeight: 1080, documentRevision: owner.document.revision, resultRef: { kind: 'asset', id: 'asset-1' } })
    expect(program.byteLength).toBe(4)
    expect(owner.frame).toBe(3)
    const source = await app.requireResult('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'source', itemRef: { kind: 'video_edit.item', id: `${id}:${item.id}` }, timeUs: 2_500_000 }, saveToAssets: true })
    expect(render.calls[1]).toMatchObject({ frame: 0, document: { width: 3840, height: 2160, fps: 60, clips: [{ sourceInUs: 2_500_000, start: 0, duration: 1 }] } })
    expect(source).toMatchObject({ width: 1920, height: 1080, sourceWidth: 3840, sourceHeight: 2160, target: { kind: 'source', timeUs: 2_500_000 } })
    expect(assets.get('asset-2')).toMatchObject({ source: 'video-edit', mediaType: 'image' })
    const outOfRange = await app.call('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'source', itemRef: { kind: 'video_edit.item', id: `${id}:${item.id}` }, timeUs: 7_000_000 } })
    expect(JSON.stringify(outOfRange)).toContain('素材时长内')
    expect(render.calls).toHaveLength(2)
  } finally { app.dispose() }
})

it('暂停直接说附完整帧与所选区域局部截图、固定上下文和open标注；右键保留点击位置，播放中拒绝', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 0, target: { kind: 'region', x: .25, y: .25, width: .5, height: .5 }, text: '这里要改' })
  await askAssistantAtVideoEditFrame(id)
  const options = useAssistantUiStore.getState().pendingGoalOptions!; const mark = owner.document.sequences[0].annotations[1]
  expect(options.autoSend).not.toBe(true); expect(options.attachments).toHaveLength(2); expect(options.context).toContain(mark.id); expect(mark).toMatchObject({ status: 'open', target: { kind: 'region' } })
  options.onTextSubmitted!('这块提高亮度'); expect(owner.document.sequences[0].annotations[1].text).toBe('这块提高亮度')
  await askAssistantAtVideoEditFrame(id, { x: .15, y: .35 }); expect(owner.document.sequences[0].annotations.at(-1)).toMatchObject({ target: { kind: 'point', x: .15, y: .35 } })
  setVideoEditView(id, { playing: true }); await expect(askAssistantAtVideoEditFrame(id)).rejects.toThrow('暂停')
})

it('轨道公开只读轨道号与类型，供按整数轨道号落片段；公共写入拒绝修改', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const track = owner.document.sequences[0].tracks.find(value => value.kind === 'video')!
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'video_edit.track', id: `${id}:${track.id}` }
    expect((await app.read(ref, ['video_edit.track.index', 'video_edit.track.kind'])).properties).toEqual({ 'video_edit.track.index': track.index, 'video_edit.track.kind': 'video' })
    expect((await app.change(ref, { 'video_edit.track.index': 5 })).ok).toBe(false)
    expect(owner.document.sequences[0].tracks.find(value => value.id === track.id)!.index).toBe(track.index)
  } finally { app.dispose() }
})

it('源素材观察保留横竖8K与120帧，超大源等比缩至序列预算', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  const app = createApplicationHarness()
  try {
    for (const [index, width, height, expectedWidth, expectedHeight] of [[0, 7680, 4320, 7680, 4320], [1, 4320, 7680, 4320, 7680], [2, 15360, 8640, 7680, 4320]]) {
      const mediaId = `media-${index}`
      appendVideoEditMedia(id, { id: mediaId, name: '原片', path: `/fixture/${index}.mp4`, kind: 'video', width, height, durationSeconds: 1, frameRate: { numerator: 120, denominator: 1 }, frameRateMode: 'sampled-constant' })
      const item = owner.document.items.find(value => value.mediaId === mediaId)!
      await app.requireResult('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'source', itemRef: { kind: 'video_edit.item', id: `${id}:${item.id}` }, timeUs: 0 } })
      expect(render.calls.at(-1)?.document).toMatchObject({ width: expectedWidth, height: expectedHeight, fps: 120 })
    }
  } finally { app.dispose() }
})


it('公共观察叠加同帧标注与稳定编号，按标注裁切放大；错序列、错帧与无区域目标拒绝且不渲染', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id; const app = createApplicationHarness()
  const regionId = createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 5, target: { kind: 'region', x: .25, y: .25, width: .5, height: .5 }, text: '改标题', status: 'open' })
  const rangeId = createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 5, endFrame: 10, target: { kind: 'range', startFrame: 5, endFrame: 10 }, text: '剪紧一点', status: 'open' })
  createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 8, target: { kind: 'point', x: .5, y: .5 }, text: '另一帧' })
  try {
    await app.requireResult('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'program', frame: 5 }, overlayAnnotations: true, maxWidth: 960 })
    expect(pixels.labels).toEqual(['1', '2']); expect(pixels.rectangles[0]).toEqual([240, 135, 480, 270])
    const crop = await app.requireResult('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'program', frame: 5 }, annotationIds: [regionId], cropAnnotationId: regionId, maxWidth: 960 })
    expect(drawn.at(-1)).toEqual([480, 270, 960, 540, 0, 0, 960, 540]); expect(crop).toMatchObject({ width: 960, height: 540 }); expect(pixels.rectangles.at(-1)).toEqual([0, 0, 960, 540])
    for (const options of [{ annotationIds: ['missing'] }, { cropAnnotationId: rangeId }, { annotationIds: [regionId], frame: 8 }]) {
      const result = await app.call('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'program', frame: options.frame ?? 5 }, annotationIds: options.annotationIds, cropAnnotationId: options.cropAnnotationId })
      expect(result).toMatchObject({ ok: false })
    }
    expect(render.calls).toHaveLength(2)
  } finally { app.dispose() }
})



it('超预算帧测量与最重源码结构经公共能力schema读回', async () => {
  const owner = await createVideoEditProject(); const app = createApplicationHarness()
  render.performance = [{ frame: 0, cpuMs: 25, gpuMs: 10, budgetMs: 1000/60, heaviest: { kind: 'repeat', cpuMs: 22, sourceSpan: { file: 'main.ts', start: 10, end: 30, startLine: 3, startColumn: 2, endLine: 3, endColumn: 22 } } }]
  render.performance[0].structures = [{ ...render.performance[0].heaviest!, gpuMs: 8, cpuShare: .8, gpuShare: .9 }]
  render.performance[0].reuse = { culledGroups: 1, culledDraws: 3, frameHits: 0, subtreeHits: 2, subtreeMisses: 1, operations: 123 }
  render.performance[0].attribution = 'draw-preparation-wall'
  render.performance[0].preparation = { wallMs: 500, cpuMs: 60, gpuMs: 300, sessionReused: false }
  render.performance[0].sampling = { mode: 'adjacent-frame', precedingFrame: 1 }
  try {
    const result = await app.requireResult('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, target: { kind: 'program', frame: 0 } })
    expect(result.performance).toEqual(render.performance)
    expect(result.resultRef).toMatchObject({kind:'observation.image'})
  } finally { app.dispose() }
})

it('源码检查超时经公共入口返回可重试，未创建观察素材', async () => {
  const owner = await createVideoEditProject(), app = createApplicationHarness()
  try {
    vi.mocked(trialVideoEditCodeFrames).mockRejectedValueOnce(Object.assign(new Error('源码检查超过时限'), { name: 'VideoEditCodeCompileTimeoutError' }))
    expect(await app.call('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, target: { kind: 'program', frame: 0 } })).toMatchObject({ ok: false, error: { recoverable: true } })
    expect(assets.size).toBe(0)
  } finally { app.dispose() }
})

it('相同内容复用可读缓存引用，只有显式要求才收录为素材', async () => {
  const owner = await createVideoEditProject(), app = createApplicationHarness()
  const input = { documentRef: { kind: 'video_edit.document', id: owner.document.id }, target: { kind: 'program', frame: 0 } }
  try {
    const first = await app.requireResult('observe_video_edit_frame', input)
    const same = await app.requireResult('observe_video_edit_frame', input)
    expect(first).toMatchObject({ storage: 'cache', reused: false, resultRef: { kind: 'observation.image' } })
    expect(same).toMatchObject({ storage: 'cache', reused: true, resultRef: first.resultRef })
    expect(same.message).toContain((first.resultRef as { id: string }).id)
    expect(getPlatform().system.fs.writeFile).toHaveBeenCalledOnce(); expect(assets.size).toBe(0)
    expect(await app.requireResult('observe_video_edit_frame', { ...input, saveToAssets: true })).toMatchObject({ storage: 'assets', resultRef: { kind: 'asset' } })
    expect(assets.size).toBe(1)
    vi.mocked(getPlatform().system.fs.readFile).mockResolvedValueOnce(new Uint8Array([137]))
    expect(await app.requireResult('observe_video_edit_frame', input)).toMatchObject({ storage: 'cache', reused: false, resultRef: first.resultRef })
    expect(getPlatform().system.fs.writeFile).toHaveBeenCalledTimes(2)
  } finally { app.dispose() }
})
