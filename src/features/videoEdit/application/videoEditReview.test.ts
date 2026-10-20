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
import { collectVideoEditCodeMotion } from '@/core/videoEdit/codeMotionReview'
import { collectVideoEditPixelMotion } from '@/core/videoEdit/pixelMotionReview'
import type { VideoMotionScan } from '@/core/media/motionEvidence'
import { testAuthorBundle, testAuthorProgram } from '../engine/videoEditAuthorTestFixtures'
const compileCodeMaterial = (source: string) => testAuthorProgram(testAuthorBundle(source))
import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import { readVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from './videoEditCodeState'
import { invalidateCodeTextMetrics } from '../videoEditGlyphMetrics'
import type { VideoEditMotionReviewRequest, VideoEditMotionReviewResponse } from '../engine/videoEditMotionReviewWorker'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { AudioContentAnalyzer } from '@/core/audioAnalysis/contentAnalysis'
import { codeMotionAudioKey } from '@/core/videoEdit/codeAudio'
import { readVideoEditContentQueries } from './videoEditContentQueryProgress'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'
import { videoEditCodeInputMotionPlacements } from '@/core/videoEdit/codeInputMotion'

const soundIO = vi.hoisted(() => ({ documents: [] as VideoEditComposition[], mix: vi.fn<[number, number], Promise<Float32Array[]>>(), dispose: vi.fn(async () => {}) }))
// Replace only PCM production and the thread boundary; keep sound selection,
// canonical cache, real signal analysis and the public review path intact.
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor(document: VideoEditComposition) { soundIO.documents.push(document) }
  async mixAudio(start: number, duration: number) {
    const planes = await soundIO.mix(start, duration)
    return { numberOfChannels: planes.length, getChannelData: (channel: number) => planes[channel] }
  }
  dispose = soundIO.dispose
} }))
vi.mock('./videoEditBeatWorkerClient', () => ({ analyzeVideoEditBeatsOffThread: async (rate: number, blocks: AsyncIterable<Float32Array[]>, signal: AbortSignal, fps: number) => {
  const analyzer = new AudioContentAnalyzer(rate, fps)
  for await (const planes of blocks) { signal.throwIfAborted(); analyzer.append(planes) }
  signal.throwIfAborted(); return analyzer.finish()
} }))

class MotionWorker {
  static instances: MotionWorker[] = []
  static automatic = true
  onmessage: ((event: MessageEvent<VideoEditMotionReviewResponse>) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  request!: VideoEditMotionReviewRequest
  constructor() { MotionWorker.instances.push(this) }
  postMessage(request: VideoEditMotionReviewRequest): void { this.request = request; if (MotionWorker.automatic) queueMicrotask(() => { void this.respond() }) }
  async respond(): Promise<void> {
    try {
      const { composition, range, policy, programs, pixels, audios } = this.request
      if (this.request.planInputsOnly) { this.onmessage?.(new MessageEvent<VideoEditMotionReviewResponse>('message', { data: { result: { records: [], sampledFrames: 0, sampledInstances: 0, inputPlacements: videoEditCodeInputMotionPlacements(composition, range) } } })); return }
      const result = collectVideoEditMotionStructure(composition, range, policy)
      if (pixels) result.records.push(...collectVideoEditPixelMotion(pixels, composition.fps, policy))
      if (programs) result.records.push(...(await collectVideoEditCodeMotion(composition, range, programs, policy, async (local, frame) => ({ sequenceId: local.id, revision: local.revision, frame, clips: local.clips.filter(clip => clip.code).map(clip => {
        const audio = audios?.[codeMotionAudioKey(local.id, clip.id)]
        const x = audio ? (audio.levels[Math.min(frame, audio.levels.length - 1)] ?? 0) * 500 : frame * 10
        return { clipId: clip.id, versionId: clip.code!.versionId, width: 1000, height: 1000, elements: [{ id: audio ? 'sound/0' : 'moving', name: '观察图层', bounds: [0,0,100,100], matrix: [1,0,0,1,x,10], corners: [[x,10],[x+100,10],[x+100,110],[x,110]], parameterKeys: [], textParameterKeys: [] }] }
      }) }))).records)
      this.onmessage?.({ data: { result } } as MessageEvent<VideoEditMotionReviewResponse>)
    } catch (error) { this.onmessage?.({ data: { error: error instanceof Error ? error.message : '分析失败' } } as MessageEvent<VideoEditMotionReviewResponse>) }
  }
}

const parse = queryVideoEditReviewCapability.outputSchema.parse
const context = () => ({ signal: new AbortController().signal })
const tracker: VideoEditTracker = { id: 'follow', name: '主体', method: 'box', prompts: [{ timeUs: 0, box: [.1, .1, .5, .5] }] }
const key = videoEditTrackerKey('media', tracker)
let handles: ReturnType<typeof tracking.videoEditTrackResults>
let trackingRevision: number
const data = () => createVideoEditTrackHeader({ method: 'box', model: 'test', fps: 10, firstFrame: 0, frameCount: 10, sourceWidth: 64, sourceHeight: 64, promptFrames: [0], boxes: Array.from({ length: 10 }, (_, index) => index === 3 || index === 4 ? null : [0, 0, .5, .5, index === 6 ? .2 : .9]), summary: { tracked: 8, lost: 2 } })
beforeEach(() => {
  soundIO.documents = []; soundIO.mix.mockReset(); soundIO.dispose.mockClear()
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
async function codeFixture(source = 'export default {name:"代码复核",width:1000,height:1000,durationSeconds:10,draw(){}}') {
  const data = await fixture(), { owner } = data
  const version = { id: 'code-v', apiVersion: 4 as const, languageVersion: 4 as const, ...testCodeManifest(source, owner.document) }
  rememberVideoEditCodeMetadata(owner, 'code-d', version, compileCodeMaterial(source))
  editVideoProject(owner.document.id, document => {
    document.codeMaterials = [{ id: 'code-d', name: '代码复核', defaultVersionId: version.id, versions: [version] }]
    document.items.push({ id: 'code-item', name: '代码复核', kind: 'code', code: { definitionId: 'code-d', versionId: version.id, parameters: {} } })
    document.sequences[0].clips.push(makeVideoEditItemClip(document, 'code-item', document.sequences[0].id, { frame: 0, duration: 120 }, readVideoEditCodeMetadata(owner, document)))
    return document
  })
  MotionWorker.instances = []; MotionWorker.automatic = true; vi.stubGlobal('Worker', MotionWorker)
  return data
}
async function soundFixture(explicit = false) {
  const source = 'export default {name:"声音复核",width:1000,height:1000,durationSeconds:1000,params:[{key:"sound",type:"audio",title:"声音",default:null}],draw(){}}'
  const data = await codeFixture(source), { owner } = data
  editVideoProject(owner.document.id, document => {
    document.media[0].hasAudio = true
    const sequence = document.sequences[0], clip = sequence.clips.find(clip => clip.kind === 'code')!
    addLegacyVideoEditTracks(sequence)
    clip.track = 2
    if (explicit) clip.code!.parameters = { sound: { kind: 'audio', mediaId: 'media' } }
    return document
  })
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue({ contentIdentity: 'a'.repeat(64), sizeBytes: 1000, fileModifiedAt: 1000 })
  const rate = owner.document.sequences[0].sampleRate
  soundIO.mix.mockImplementation(async (start, duration) => [Float32Array.from({ length: Math.round(rate * duration) }, (_, i) => start + i / rate >= 1 && start + i / rate < 2 ? .4 : .1)])
  return data
}
it.each([false, true])('public review analyzes actual %s sound selection, marks opaque draw motion unavailable and keeps managed source pins in the query only', async explicit => {
  const { owner, input } = await soundFixture(explicit), app = createApplicationHarness()
  const before = structuredClone(owner.document), history = owner.past.length
  try {
    const result = parse(await app.requireResult('query_video_edit_review', { ...input, motion: {}, limit: 50 }))
    expect(result.records.some(record => record.kind === 'code_unavailable')).toBe(true)
    expect(result.documentVersion).toContain('|review:')
    expect(soundIO.documents).toHaveLength(1)
    expect(soundIO.documents[0].clips.map(clip => clip.id)).toEqual(explicit ? ['content-audio'] : ['a', 'b'])
    expect(soundIO.mix).toHaveBeenCalledTimes(explicit ? 10 : 4)
    expect(soundIO.dispose).toHaveBeenCalledOnce()
    const clip = owner.document.sequences[0].clips.find(clip => clip.kind === 'code')!
    expect(MotionWorker.instances[0].request.audios?.[codeMotionAudioKey(owner.document.sequences[0].id, clip.id)].levels).toContainEqual(expect.closeTo(.4, 5))
    expect(owner.document).toEqual(before); expect(owner.past.length).toBe(history)
  } finally { app.dispose() }
})
it('public sound review reuses completed PCM analysis across pagination and visual edits, then invalidates audible changes and replaced files', async () => {
  const { owner, input } = await soundFixture(), query = { ...input, motion: {}, limit: 1 }
  const first = parse(await queryVideoEditReview(query, context()))
  expect(first.nextCursor).not.toBeNull()
  await queryVideoEditReview({ ...query, cursor: first.nextCursor }, context())
  await queryVideoEditReview(query, context())
  expect(soundIO.documents).toHaveLength(1)
  editVideoProject(owner.document.id, document => { document.sequences[0].clips[0].x = .8; return document })
  await queryVideoEditReview(query, context()); expect(soundIO.documents).toHaveLength(1)
  editVideoProject(owner.document.id, document => { document.sequences[0].clips[0].volume = .5; return document })
  const changed = parse(await queryVideoEditReview(query, context())); expect(soundIO.documents).toHaveLength(2)
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockResolvedValue({ contentIdentity: 'b'.repeat(64), sizeBytes: 1000, fileModifiedAt: 2000 })
  await expect(queryVideoEditReview({ ...query, cursor: changed.nextCursor }, context())).rejects.toThrow('重新定位')
  await queryVideoEditReview(query, context()); expect(soundIO.documents).toHaveLength(3)
})
it.each(['cancel', 'edit', 'close'] as const)('public pending sound review rejects %s, releases its mixer and never sends stale audio to the motion worker', async action => {
  const { owner, input } = await soundFixture(), controller = new AbortController()
  let accept!: (planes: Float32Array[]) => void
  soundIO.mix.mockImplementationOnce(() => new Promise(resolve => { accept = resolve }))
  const pending = queryVideoEditReview({ ...input, motion: {} }, { signal: controller.signal }), rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(soundIO.mix).toHaveBeenCalledOnce())
  if (action === 'cancel') controller.abort(new Error('取消声音复核'))
  else if (action === 'edit') editVideoProject(owner.document.id, document => { document.sequences[0].clips[0].volume = .2; return document })
  else await closeAllVideoEdits()
  await rejected
  expect(soundIO.dispose).toHaveBeenCalledOnce(); expect(MotionWorker.instances).toHaveLength(0)
  expect(readVideoEditContentQueries(owner, 'code-item')).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'cancelled' })]))
  accept([new Float32Array(48000).fill(.9)])
})
it('sound review merges equivalent code audio and rejects excessive complete contexts before decoding', async () => {
  const { owner, input } = await soundFixture()
  editVideoProject(owner.document.id, document => {
    const sequence = document.sequences[0], code = sequence.clips.find(clip => clip.kind === 'code')!
    sequence.clips.push({ ...code, id: 'same-sound', track: 3 })
    return document
  })
  await queryVideoEditReview({ ...input, motion: {} }, context())
  expect(soundIO.documents).toHaveLength(1)
  expect(Object.keys(MotionWorker.instances[0].request.audios!)).toHaveLength(2)
  editVideoProject(owner.document.id, document => { document.sequences[0].clips.find(clip => clip.kind === 'code')!.duration = 301 * 30; return document })
  soundIO.mix.mockClear()
  await expect(queryVideoEditReview({ ...input, motion: {} }, context())).rejects.toThrow('300秒完整声音上下文')
  expect(soundIO.mix).not.toHaveBeenCalled()
})
it.each(['cancel', 'edit'] as const)('a first managed-file identity read stops on %s without waiting for a late native reply', async action => {
  const { owner, input } = await soundFixture(), controller = new AbortController()
  let accept!: (value: { contentIdentity: string; sizeBytes: number; fileModifiedAt: number }) => void
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementationOnce(() => new Promise(resolve => { accept = resolve }))
  const pending = queryVideoEditReview({ ...input, motion: {} }, { signal: controller.signal }), rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(accept).toBeTypeOf('function'))
  if (action === 'cancel') controller.abort(new Error('取消来源核对'))
  else editVideoProject(owner.document.id, document => { document.sequences[0].name = '编辑后的序列'; return document })
  await rejected
  expect(soundIO.mix).not.toHaveBeenCalled(); expect(MotionWorker.instances).toHaveLength(0)
  accept({ contentIdentity: 'a'.repeat(64), sizeBytes: 1000, fileModifiedAt: 1000 })
})
it('rejects sound evidence when the actual file is replaced during PCM production', async () => {
  const { input } = await soundFixture()
  soundIO.mix.mockImplementation(async (_start, duration) => {
    vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockResolvedValue({ contentIdentity: 'b'.repeat(64), sizeBytes: 1000, fileModifiedAt: 2000 })
    return [new Float32Array(Math.round(duration * 48000)).fill(.25)]
  })
  await expect(queryVideoEditReview({ ...input, motion: {} }, context())).rejects.toThrow('重新定位')
  expect(soundIO.dispose).toHaveBeenCalledOnce(); expect(MotionWorker.instances).toHaveLength(0)
})
it('never combines old and new file identities across two complete sound contexts in one review', async () => {
  const { owner, input } = await soundFixture()
  editVideoProject(owner.document.id, document => {
    const sequence = document.sequences[0], code = sequence.clips.find(clip => clip.kind === 'code')!
    sequence.clips.push({ ...code, id: 'later-sound', start: 30, duration: 90, track: 3 })
    return document
  })
  let identity = 'a'.repeat(64)
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementation(async () => {
    const current = identity
    if (soundIO.dispose.mock.calls.length) identity = 'b'.repeat(64)
    return { contentIdentity: current, sizeBytes: 1000, fileModifiedAt: 1000 }
  })
  await expect(queryVideoEditReview({ ...input, motion: {} }, context())).rejects.toThrow('声音审查期间已改变')
  expect(MotionWorker.instances).toHaveLength(0)
})
it('rejects 33 distinct sound contexts before file inspection or PCM decoding', async () => {
  const { owner, input } = await soundFixture()
  editVideoProject(owner.document.id, document => {
    const sequence = document.sequences[0], code = sequence.clips.find(clip => clip.kind === 'code')!
    sequence.clips = [...sequence.clips.filter(clip => clip.kind !== 'code'), ...Array.from({ length: 33 }, (_, i) => ({ ...code, id: `sound-${i}`, start: i, duration: 1 }))]
    return document
  })
  await expect(queryVideoEditReview({ ...input, motion: {} }, context())).rejects.toThrow('最多32组')
  expect(getPlatform().assetLibrary.inspectFileContent).not.toHaveBeenCalled(); expect(soundIO.mix).not.toHaveBeenCalled()
})
async function pixelFixture() {
  const data = await fixture(), platform = getPlatform()
  editVideoProject(data.owner.document.id, document => { document.media[0].assetContent = { contentIdentity: 'a'.repeat(64), sizeBytes: 1000, fileModifiedAt: 1000 }; document.sequences[0].clips[0].duration = 90; return document })
  vi.spyOn(platform.assetLibrary, 'inspectFileContent').mockResolvedValue({ contentIdentity: 'a'.repeat(64), sizeBytes: 1000, fileModifiedAt: 1000 })
  const unsubscribe = vi.fn(); vi.spyOn(platform.sceneDetection, 'onProgress').mockReturnValue(unsubscribe)
  const result = (from: number, to: number): VideoMotionScan => ({ startSeconds: from, endSeconds: to, samplingFps: 15, width: 320, height: 180, sampledFrames: Math.ceil((to - from) * 15),
    samples: Array.from({ length: Math.ceil((to - from) * 15) }, (_, i) => ({ fromSeconds: from + i / 15, toSeconds: Math.min(to, from + (i + 1) / 15), speed: i < 15 ? 10 : 0, zoom: 0, change: 0, cut: false, still: i >= 15 })) })
  vi.spyOn(platform.sceneDetection, 'detect').mockImplementation(async request => ({ cutsSeconds: [], contentIdentity: 'b'.repeat(64), motionScan: result(request.startSeconds, request.endSeconds) }))
  const cancel = vi.spyOn(platform.sceneDetection, 'cancel').mockResolvedValue()
  MotionWorker.instances = []; MotionWorker.automatic = true; vi.stubGlobal('Worker', MotionWorker)
  return { ...data, platform, unsubscribe, cancel, result }
}
async function inputPixelFixture(kind: 'video' | 'fixed' | 'sequence') {
  const data = await pixelFixture(), { owner } = data
  const source = 'export default {name:"输入复核",width:1000,height:1000,durationSeconds:10,params:[{key:"picture",type:"image",title:"画面",default:null}],draw(){}}'
  const version = { id: 'input-v', apiVersion: 4 as const, languageVersion: 4 as const, ...testCodeManifest(source, owner.document) }
  rememberVideoEditCodeMetadata(owner, 'input-d', version, compileCodeMaterial(source))
  editVideoProject(owner.document.id, document => {
    const sequence = document.sequences[0]; addLegacyVideoEditTracks(sequence)
    document.codeMaterials = [{ id: 'input-d', name: '输入复核', defaultVersionId: version.id, versions: [version] }]
    document.items.push({ id: 'input-item', name: '输入复核', kind: 'code', code: { definitionId: 'input-d', versionId: version.id, parameters: { picture: kind === 'sequence' ? { kind: 'sequence', mediaId: 'below' } : { kind: 'video', mediaId: 'media', ...(kind === 'fixed' ? { time: .5 } : {}) } } } })
    if (kind !== 'sequence') sequence.clips = []
    sequence.clips.push({ ...makeVideoEditItemClip(document, 'input-item', sequence.id, { frame: 0, duration: 120 }, readVideoEditCodeMetadata(owner, document)), track: 3 })
    return document
  })
  return data
}
it.each(['video', 'fixed', 'sequence'] as const)('public pixel review includes %s code input, shares source scanning and keeps source candidates separate from visible motion', async kind => {
  const { owner, input, platform } = await inputPixelFixture(kind), app = createApplicationHarness()
  const before = structuredClone(owner.document)
  try {
    const result = parse(await app.requireResult('query_video_edit_review', { ...input, motion: { videoPixels: true }, limit: 50 }))
    const candidates = result.records.filter(record => record.motionEvidence?.basis === 'code_input_pixels')
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.every(record => record.motionEvidence?.input?.parameter === 'picture' && record.motionEvidence.input.mediaRef.id === `${owner.document.id}:media`)).toBe(true)
    expect(candidates.every(record => record.subjectRef.id.endsWith(`:${owner.document.sequences[0].clips.at(-1)!.id}`))).toBe(true)
    expect(candidates.every(record => record.motionEvidence?.suggestion.includes('不证明代码实际绘制或最终可见'))).toBe(true)
    if (kind === 'fixed') expect(candidates.some(record => record.kind === 'motion' || record.kind === 'motion_hard_stop')).toBe(false)
    else expect(candidates.some(record => record.kind === 'motion')).toBe(true)
    expect(platform.sceneDetection.detect).toHaveBeenCalledOnce()
    if (kind === 'sequence') expect(result.records.some(record => record.motionEvidence?.basis === 'video_pixels')).toBe(true)
    else expect(result.records.some(record => record.motionEvidence?.basis === 'video_pixels')).toBe(false)
    expect(owner.document).toEqual(before)
    const page = parse(await app.requireResult('query_video_edit_review', { ...input, motion: { videoPixels: true }, limit: 1 }))
    await queryVideoEditReview({ ...input, motion: { videoPixels: true }, limit: 1, cursor: page.nextCursor }, context())
    expect(platform.sceneDetection.detect).toHaveBeenCalledTimes(2)
    vi.mocked(platform.assetLibrary.inspectFileContent).mockResolvedValue({ contentIdentity: 'b'.repeat(64), sizeBytes: 1000, fileModifiedAt: 2000 })
    await expect(queryVideoEditReview({ ...input, motion: { videoPixels: true }, limit: 1, cursor: page.nextCursor }, context())).rejects.toThrow('重新定位')
  } finally { app.dispose() }
})
it('editing during background code-input mapping terminates the old worker before any source decoding starts', async () => {
  const { owner, input, platform } = await inputPixelFixture('video'); MotionWorker.automatic = false
  const pending = queryVideoEditReview({ ...input, motion: { videoPixels: true } }, context()), rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(MotionWorker.instances).toHaveLength(1))
  expect(MotionWorker.instances[0].request.planInputsOnly).toBe(true)
  editVideoProject(owner.document.id, document => { document.sequences[0].name = '新内容'; return document })
  await rejected
  expect(MotionWorker.instances[0].terminate).toHaveBeenCalledOnce(); expect(platform.sceneDetection.detect).not.toHaveBeenCalled()
  expect(readVideoEditContentQueries(owner, 'input-item')).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'cancelled' })]))
})
it('public pixel review scans overlapping source use once, retains both placements and pages without decoding again', async () => {
  const { owner, input, platform, unsubscribe } = await pixelFixture(), app = createApplicationHarness()
  const before = structuredClone(owner.document), past = owner.past.length, frame = owner.frame
  try {
    const first = parse(await app.requireResult('query_video_edit_review', { ...input, motion: { videoPixels: true }, limit: 1 }))
    const records = [...first.records]; let cursor = first.nextCursor
    while (cursor) { const page = parse(await app.requireResult('query_video_edit_review', { ...input, motion: { videoPixels: true }, limit: 1, cursor })); records.push(...page.records); cursor = page.nextCursor }
    expect(platform.sceneDetection.detect).toHaveBeenCalledTimes(1)
    expect(platform.sceneDetection.detect).toHaveBeenCalledWith(expect.objectContaining({ analysis: 'motion', startSeconds: 0, endSeconds: 3 }))
    const pixel = records.filter(record => record.motionEvidence?.basis === 'video_pixels')
    expect(new Set(pixel.map(record => record.subjectRef.id))).toEqual(new Set([`${owner.document.id}:a`, `${owner.document.id}:b`]))
    expect(pixel.some(record => record.kind === 'motion' && record.source && record.motionEvidence?.peakSpeed)).toBe(true)
    expect(pixel.some(record => record.kind === 'pixel_still')).toBe(true)
    expect(unsubscribe).toHaveBeenCalledOnce(); expect(MotionWorker.instances).toHaveLength(1)
    expect(owner.document).toEqual(before); expect(owner.past.length).toBe(past); expect(owner.frame).toBe(frame)
    vi.mocked(platform.assetLibrary.inspectFileContent).mockResolvedValue({ contentIdentity: 'c'.repeat(64), sizeBytes: 1000, fileModifiedAt: 1000 })
    await expect(queryVideoEditReview({ ...input, motion: { videoPixels: true }, limit: 1, cursor: first.nextCursor }, context())).rejects.toThrow('重新定位')
  } finally { app.dispose() }
})
it('fresh pixel analysis binds an unpinned project source only to its query snapshot and rejects changed files or malformed scans', async () => {
  const { owner, input, platform, result } = await pixelFixture()
  editVideoProject(owner.document.id, document => { delete document.media[0].assetContent; return document })
  const fresh = parse(await queryVideoEditReview({ ...input, motion: { videoPixels: true }, limit: 1 }, context()))
  expect(fresh.records.length).toBe(1)
  expect(owner.document.media[0].assetContent).toBeUndefined()
  expect(platform.sceneDetection.detect).toHaveBeenCalledOnce()
  vi.mocked(platform.assetLibrary.inspectFileContent).mockResolvedValue({ contentIdentity: 'c'.repeat(64), sizeBytes: 1000, fileModifiedAt: 1000 })
  await expect(queryVideoEditReview({ ...input, motion: { videoPixels: true }, limit: 1, cursor: fresh.nextCursor }, context())).rejects.toThrow('重新定位')
  vi.mocked(platform.assetLibrary.inspectFileContent).mockResolvedValue({ contentIdentity: 'a'.repeat(64), sizeBytes: 1000, fileModifiedAt: 1000 })
  editVideoProject(owner.document.id, document => { document.media[0].assetContent = { contentIdentity: 'a'.repeat(64), sizeBytes: 1000, fileModifiedAt: 1000 }; return document })
  vi.mocked(platform.sceneDetection.detect).mockImplementationOnce(async request => {
    vi.mocked(platform.assetLibrary.inspectFileContent).mockResolvedValue({ contentIdentity: 'c'.repeat(64), sizeBytes: 1000, fileModifiedAt: 1000 })
    return { cutsSeconds: [], contentIdentity: 'b'.repeat(64), motionScan: result(request.startSeconds, request.endSeconds) }
  })
  await expect(queryVideoEditReview({ ...input, motion: { videoPixels: true } }, context())).rejects.toThrow('重新定位')
  vi.mocked(platform.assetLibrary.inspectFileContent).mockResolvedValue({ contentIdentity: 'a'.repeat(64), sizeBytes: 1000, fileModifiedAt: 1000 })
  vi.mocked(platform.sceneDetection.detect).mockImplementationOnce(async request => ({ cutsSeconds: [], contentIdentity: 'b'.repeat(64), motionScan: { ...result(request.startSeconds, request.endSeconds), samples: [] } }))
  await expect(queryVideoEditReview({ ...input, motion: { videoPixels: true } }, context())).rejects.toThrow()
})
it.each(['cancel', 'edit'] as const)('a pending pixel scan %s cancels the shared native request, releases progress, and rejects the old plan', async kind => {
  const { owner, input, platform, cancel, unsubscribe, result } = await pixelFixture(), controller = new AbortController()
  let accept!: (value: Awaited<ReturnType<typeof platform.sceneDetection.detect>>) => void, ready!: () => void
  const started = new Promise<void>(resolve => { ready = resolve })
  vi.mocked(platform.sceneDetection.detect).mockImplementationOnce(() => { ready(); return new Promise(resolve => { accept = resolve }) })
  const pending = queryVideoEditReview({ ...input, motion: { videoPixels: true } }, { signal: controller.signal }), rejected = expect(pending).rejects.toThrow()
  await started
  if (kind === 'cancel') controller.abort(new Error('取消视频像素分析'))
  else editVideoProject(owner.document.id, document => { document.sequences[0].name = '已编辑'; return document })
  expect(cancel).toHaveBeenCalledOnce()
  accept({ cutsSeconds: [], contentIdentity: 'b'.repeat(64), motionScan: result(0, 3) }); await rejected
  expect(unsubscribe).toHaveBeenCalledOnce(); expect(MotionWorker.instances).toHaveLength(0)
})
it.each([12000, 60001])('pixel budgets preflight the whole query before decoding: %s placed frames', async frames => {
  const { owner, input, platform } = await pixelFixture()
  editVideoProject(owner.document.id, document => { document.media[0].durationSeconds = 10000; document.sequences[0].clips[0].duration = frames; return document })
  await expect(queryVideoEditReview({ ...input, to: frames, motion: { videoPixels: true } }, context())).rejects.toThrow(frames > 60000 ? '60000' : '300秒')
  expect(platform.sceneDetection.detect).not.toHaveBeenCalled()
})

it('rejects a code review whose font set changed while the real domain calculation was pending', async () => {
  const { input } = await codeFixture(); MotionWorker.automatic = false
  const pending = queryVideoEditReview({ ...input, motion: {} }, context())
  const rejected = expect(pending).rejects.toThrow('字体已改变')
  await vi.waitFor(() => expect(MotionWorker.instances).toHaveLength(1))
  invalidateCodeTextMetrics(); await MotionWorker.instances[0].respond(); await rejected
})
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
