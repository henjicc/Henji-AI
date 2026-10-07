import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { videoEditPictureSeconds } from '@/core/videoEdit/time'
import { VideoEditRenderer } from './videoEditRenderer'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import type { VideoSample } from 'mediabunny'
import type { VideoEditFrameBackend } from './videoEditFrameSource'
import { createVideoEditNativeClipAudio, type VideoEditPcmSession } from './videoEditNativeAudio'
import { VideoEditNativePicture } from './videoEditNativePicture'
import type { NativeVideoFrame } from './videoEditNativeFrames'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'

const boundary = vi.hoisted(() => ({ scheduled: [] as Array<{ path: string; timestamps: number[] }>, disposed: [] as string[], pictures: [] as number[], generatorCalls: 0, compilerCalls: 0, compilerDisposed: 0, failGenerator: false, released: [] as string[][], pendingCode: undefined as Promise<CodeMaterialProgram> | undefined, snapshotCalls: [] as boolean[], normalizedReleased: 0, pendingSnapshot: undefined as Promise<void> | undefined, draws: [] as Array<{ ids: string[]; timestamps: number[]; offscreen: boolean; size?: [number, number] }>, divisors: [] as number[], mixes: [] as Array<number | number[]>, opacities: [] as number[], evaluatedClips: [] as VideoEditClip[], builtinParams: [] as Record<string, unknown>[] }))
/** The start of the 60fps picture showing at `time` (exact grid times stay exact despite floating point). */
const gridPicture = vi.hoisted(() => (time: number, fps = 60): number => Math.floor(time * fps + 1e-6) / fps)
/** Source seconds compared at whole microseconds (picture starts computed on the grid vs. expectations summed in seconds). */
const us = (values: ReadonlyArray<number | undefined>): Array<number | undefined> => values.map(value => value === undefined ? undefined : Math.round(value * 1e6))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn() }) }))
vi.mock('./videoEditCodeCompiler', async () => {
  const { compileCodeMaterial } = await import('@/core/videoEdit/codeMaterial/compiler')
  return { VideoEditCodeCompiler: class {
    async compile(source: string): Promise<CodeMaterialProgram> { boundary.compilerCalls++; return boundary.pendingCode ?? compileCodeMaterial(source) }
    dispose(): void { boundary.compilerDisposed++ }
  } }
})
vi.mock('mediabunny', async () => {
  const actual = await vi.importActual<typeof import('mediabunny')>('mediabunny')
  return { ...actual,
    UrlSource: class { constructor(readonly path: string) {} },
    Input: class {
      readonly path: string
      constructor(options: { source: { path: string } }) { this.path = options.source.path }
      async getPrimaryVideoTrack() { if (this.path.includes('missing')) throw new Error('Error fetching henji-media://local/missing.mp4: 404 Not Found'); return { path: this.path, getDecoderConfig: async () => ({ codec: 'avc1' }) } }
      async getPrimaryAudioTrack() { return { path: this.path } }
      dispose(): void { boundary.disposed.push(this.path) }
    },
    VideoSampleSink: class {
      constructor(readonly track: { path: string }) {}
      // Like a decoder: the last 60fps picture starting at or before the time (lookups carry the container timestamp tolerance).
      async getSample(time: number) { return { timestamp: gridPicture(time) || (this.track.path.includes('B') ? 2 : 1), duration: 1 / 60, format: 'NV12', close: vi.fn() } }
      async *samples(start: number) { for (let frame = 0; frame < 4; frame++) yield { timestamp: gridPicture(start) + frame / 60, duration: 1 / 60, format: 'NV12', close: vi.fn() } }
      async *samplesAtTimestamps(timestamps: number[]) { boundary.scheduled.push({ path: this.track.path, timestamps: [...timestamps] }); for (const timestamp of timestamps) yield { timestamp: gridPicture(timestamp), duration: 1 / 60, format: 'NV12', close: vi.fn() } }
    },
    AudioSampleSink: class {
      constructor(readonly track: { path: string }) {}
      async *samples() { const path = this.track.path; yield { timestamp: 0, duration: 2, numberOfFrames: 96000, sampleRate: 48000, numberOfChannels: 2,
        copyTo(data: Float32Array, options: { planeIndex: number }): void { data.fill(path.includes('B') ? .75 : options.planeIndex === 0 ? .25 : .5) }, close: vi.fn() } }
    },
  }
})
// The playback decode pump has its own tests; here the schedule reads the same fake sink.
vi.mock('./videoEditPlaybackDecoder', async () => {
  const { VideoSampleSink } = await import('mediabunny')
  return { scheduledVideoSamples: (track: ConstructorParameters<typeof VideoSampleSink>[0], options: ConstructorParameters<typeof VideoSampleSink>[1], timestamps: number[]) => new VideoSampleSink(track, options).samplesAtTimestamps(timestamps) }
})
vi.mock('./videoEditGpuCompositor', async () => {
  const { VideoEditGpuFrame } = await import('./videoEditGpuFrame')
  const { VideoEditCodePicture } = await import('./videoEditCodeGpu')
  const owner = {} as import('@/core/imageEdit/worker/webgpuRuntimeSupport').GpuDevice
  const target = (width: number, height: number) => new VideoEditCodePicture({ createView: () => ({}), destroy: vi.fn() }, width, height, owner)
  class MockCompositor {
  fork(): MockCompositor { return new MockCompositor() }
  async blank(width: number, height: number, timestamp: number, duration: number) {
    return new VideoEditGpuFrame({ timestamp, duration, displayWidth: width, displayHeight: height, rotation: 0, flip: false }, { createView: () => ({}), destroy: vi.fn() }, undefined, 4, () => {})
  }
  async snapshot(sample: { timestamp: number; duration: number }, compact: boolean) {
    boundary.snapshotCalls.push(compact); await boundary.pendingSnapshot
    return new VideoEditGpuFrame({ ...sample, displayWidth: 3840, displayHeight: 2160, rotation: 0, flip: false }, { createView: () => ({}), destroy: vi.fn() }, undefined, 100, () => { boundary.normalizedReleased++ })
  }
  async code() { return { generator: async (_key: string, _program: CodeMaterialProgram, context: { time: number }) => { boundary.generatorCalls++; if (boundary.failGenerator) throw new Error('代码画面失败'); return { timestamp: context.time } }, releaseUnused: (keys: ReadonlySet<string>) => { boundary.released.push([...keys]) },
    target: async (_key: string, width: number, height: number) => target(width, height), releaseNestedFrames: vi.fn(),
    builtin: async (_key: string, instance: { params: Record<string, unknown> }, input: InstanceType<typeof VideoEditCodePicture>) => { boundary.builtinParams.push({ ...instance.params }); return target(input.width, input.height) },
    mix: async (_key: string, left: InstanceType<typeof VideoEditCodePicture>, _right: InstanceType<typeof VideoEditCodePicture>, amount: number, through?: readonly number[]) => { boundary.mixes.push(through ? [amount, ...through] : amount); return target(left.width, left.height) },
  } }
  async prepareImages() { return new Map() }
  imageDiagnostics() { return { textures: 0, bytes: 0, uploads: 0 } }
  codeDiagnostics() { return undefined }
  async draw(document: { width: number; height: number }, clips: VideoEditClip[], pictures: Array<{ timestamp?: number } | null>, _shouldPresent: unknown, _deadline: unknown, destination?: unknown) { boundary.pictures = pictures.map(picture => picture?.timestamp as number); boundary.opacities = clips.map(clip => clip.opacity); if (destination) boundary.evaluatedClips = clips; boundary.draws.push({ ids: clips.map(clip => clip.id), timestamps: [...boundary.pictures], offscreen: Boolean(destination), ...(boundary.divisors.length ? { size: [document.width, document.height] as [number, number] } : {}) }); return { presented: true, completion: Promise.resolve() } }
  setPictureDivisor(divisor: number): void { boundary.divisors.push(divisor) }
  async dispose(): Promise<void> {}
  cancelPresentation(): void {}
  }
  return { VideoEditGpuCompositor: MockCompositor }
})
vi.mock('./videoEditSeekDecoder', () => ({ VideoEditSeekDecoder: class {
  constructor(private readonly path: string, private readonly cache: import('./videoEditFrameCache').VideoEditFrameCache) {}
  async sample(time: number) { const frame = this.cache.get(this.path, time) as import('./videoEditGpuFrame').VideoEditGpuFrame | undefined; return { sample: frame?.clone(), hit: !!frame } }
  async dispose() { this.cache.deleteMedia(this.path) }
} }))
beforeEach(() => {
  boundary.disposed = []; boundary.pictures = []
  boundary.generatorCalls = 0; boundary.compilerCalls = 0; boundary.compilerDisposed = 0; boundary.failGenerator = false; boundary.released = []; boundary.pendingCode = undefined
  boundary.snapshotCalls = []; boundary.normalizedReleased = 0; boundary.pendingSnapshot = undefined
  boundary.draws = []; boundary.mixes = []; boundary.divisors = []; boundary.evaluatedClips = []; boundary.builtinParams = []
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} })
  vi.stubGlobal('VideoDecoder', { isConfigSupported: async () => ({ supported: true }) })
})
it('真实转场窗口准备两端原视频余量，不改片段时钟，禁用轨道不产生转场或额外解码', async () => {
  const document = { ...fixture(), fps: 60, frameRate: { numerator: 60, denominator: 1 } }
  document.media = document.media.map(media => ({ ...media, durationSeconds: 3 }))
  const base = document.clips[0]
  document.clips = [{ ...base, sourceInUs: 1_000_000 }, { ...base, id: 'right', itemId: 'item-B', start: 60, sourceInUs: 1_000_000 }]
  document.transitions = [{ id: 'cross', kind: 'cross_dissolve', leftClipId: base.id, rightClipId: 'right', durationFrames: 10 }]
  const renderer = new VideoEditRenderer(document)
  try {
    for (const frame of [55, 60, 64]) {
      boundary.draws = []
      const result = await renderer.render(frame); await result.completion
      expect(result.presented).toBe(true)
      expect(us(result.sourceTimestamps)).toEqual(expect.arrayContaining(us([1 + frame / 60, 1 + (frame - 60) / 60]))); expect(result.sourceTimestamps).toHaveLength(2)
      expect(boundary.draws.map(draw => ({ ...draw, timestamps: us(draw.timestamps) }))).toEqual([
        { ids: [base.id], timestamps: us([1 + frame / 60]), offscreen: true },
        { ids: ['right'], timestamps: us([1 + (frame - 60) / 60]), offscreen: true },
        { ids: [base.id], timestamps: [undefined], offscreen: false },
      ])
    }
    expect(boundary.mixes).toEqual([0, 5 / 9, 1]); expect(boundary.compilerCalls).toBe(0)
    boundary.draws = []; await renderer.render(65)
    expect(boundary.draws.map(draw => ({ ...draw, timestamps: us(draw.timestamps) }))).toEqual([{ ids: ['right'], timestamps: us([1 + 5 / 60]), offscreen: false }])
    const decodes = boundary.snapshotCalls.length
    await renderer.updateDocument({ ...document, tracks: document.tracks.map(track => track.index === 1 ? { ...track, enabled: false } : track) })
    boundary.draws = []; const hidden = await renderer.render(55)
    expect(hidden.sourceTimestamps).toEqual([]); expect(boundary.snapshotCalls).toHaveLength(decodes)
    expect(boundary.draws).toEqual([{ ids: [], timestamps: [], offscreen: false }]); expect(boundary.mixes).toHaveLength(3)
  } finally { await renderer.dispose() }
})
it('媒体不足时转场重复首尾帧（PR），黑场过渡把纯色交给混合（4.3）', async () => {
  const document = { ...fixture(), fps: 60, frameRate: { numerator: 60, denominator: 1 } }
  const base = document.clips[0]
  // 两段都是完整素材，首尾没有余量
  document.clips = [{ ...base, duration: 120 }, { ...base, id: 'right', itemId: 'item-B', start: 120 }]
  document.transitions = [{ id: 'dip', kind: 'dip_to_black', leftClipId: base.id, rightClipId: 'right', durationFrames: 10 }]
  const renderer = new VideoEditRenderer(document)
  try {
    const before = await renderer.render(118); await before.completion
    // 右片段在入点之前停在自己的第一帧（源 0 秒）
    expect(us(before.sourceTimestamps)).toEqual(expect.arrayContaining(us([118 / 60, 2])))
    const after = await renderer.render(122); await after.completion
    // 左片段越过源结尾停在最后一帧
    expect(us(after.sourceTimestamps)).toEqual(expect.arrayContaining(us([119 / 60, 2 / 60])))
    expect(boundary.mixes).toEqual([[3 / 9, 0, 0, 0, 1], [7 / 9, 0, 0, 0, 1]])
  } finally { await renderer.dispose() }
})
it('淡化手柄：画面按帧乘不透明度，声音按恒定功率包络混音（4.3）', async () => {
  const document = fixture()
  document.clips = [{ ...document.clips[0], duration: 90, fadeInFrames: 30, fadeOutFrames: 15 }]
  const renderer = new VideoEditRenderer(document)
  try {
    await renderer.render(15); expect(boundary.opacities).toEqual([.5])
    await renderer.render(45); expect(boundary.opacities).toEqual([1])
    await renderer.render(82); expect(boundary.opacities[0]).toBeCloseTo(7 / 15)
    expect((await renderer.mixAudio(0, .01))[0][0]).toBe(0)
    expect((await renderer.mixAudio(.5, .01))[0][0]).toBeCloseTo(.25 * Math.SQRT1_2)
    expect((await renderer.mixAudio(1.2, .01))[0][0]).toBe(.25)
  } finally { await renderer.dispose() }
})
it('音频过渡：左片段越过出点、右片段提前入点，恒定功率交叉淡化（4.3）', async () => {
  const document = fixture()
  const sound = { ...document.clips[0], kind: 'audio' as const, track: 0, sourceComponent: 'audio' as const }
  document.media = document.media.map(media => ({ ...media, durationSeconds: 4, hasAudio: true }))
  document.clips = [{ ...sound, id: 'a', sourceInUs: 0 }, { ...sound, id: 'b', itemId: 'item-B', start: 60, sourceInUs: 1_000_000 }]
  document.transitions = [{ id: 'fade', kind: 'constant_power', leftClipId: 'a', rightClipId: 'b', durationFrames: 30 }]
  const renderer = new VideoEditRenderer(document)
  try {
    // 窗口 45..75 帧（1.5–2.5 秒）；1.75 秒处进度 1/4，左右各乘 cos/sin(π/8)
    expect((await renderer.mixAudio(1.75, .01))[0][0]).toBeCloseTo(.25 * Math.cos(Math.PI / 8) + .75 * Math.sin(Math.PI / 8))
    expect((await renderer.mixAudio(1, .01))[0][0]).toBe(.25)
    expect((await renderer.mixAudio(2.6, .01))[0][0]).toBe(.75)
  } finally { await renderer.dispose() }
})
it('单侧过渡：画面从黑场淡入、淡出到透明，声音在片段一端淡入淡出（4.4）', async () => {
  const document = fixture()
  document.clips = [{ ...document.clips[0], start: 30, duration: 60 }]
  document.transitions = [{ id: 'head', kind: 'dip_to_black', rightClipId: 'clip', durationFrames: 10 }, { id: 'tail', kind: 'cross_dissolve', leftClipId: 'clip', durationFrames: 10 }]
  const renderer = new VideoEditRenderer(document)
  try {
    // 入点：同一片段两次传入，借纯色混合的后半段（0.5 → 1）；出点借前半段（0 → 0.5），透明为全零预乘色
    await renderer.render(33); expect(boundary.mixes).toEqual([[.5 + 3 / 18, 0, 0, 0, 1]])
    await renderer.render(89); expect(boundary.mixes).toEqual([[.5 + 3 / 18, 0, 0, 0, 1], [.5, 0, 0, 0, 0]])
  } finally { await renderer.dispose() }
  const sound = fixture()
  sound.media = sound.media.map(media => ({ ...media, durationSeconds: 4, hasAudio: true }))
  sound.clips = [{ ...sound.clips[0], kind: 'audio', track: 0, sourceComponent: 'audio', start: 30, duration: 60 }]
  sound.transitions = [{ id: 'in', kind: 'constant_gain', rightClipId: 'clip', durationFrames: 30 }]
  const mixer = new VideoEditRenderer(sound)
  try {
    // 入点窗口 30..60 帧（1–2 秒），1.25 秒处进度 1/4：恒定增益只乘 0.25，窗口之后整段原音量
    expect((await mixer.mixAudio(1.25, .01))[0][0]).toBeCloseTo(.25 * .25)
    expect((await mixer.mixAudio(2.2, .01))[0][0]).toBe(.25)
  } finally { await mixer.dispose() }
})
it('顺序播放和导出使用定位同一GPU格式，每个实际解码帧只复制一次', async () => {
  const document = { ...fixture(), fps: 60, frameRate: { numerator: 60, denominator: 1 } }; const renderer = new VideoEditRenderer(document)
  try {
    await renderer.render(0, true); expect(boundary.pictures).toEqual([0])
    await renderer.render(0, true); expect(boundary.snapshotCalls).toEqual([true])
    await renderer.render(1, true); expect(boundary.pictures).toEqual([1 / 60])
    expect(boundary.snapshotCalls).toEqual([true, true]); expect(boundary.normalizedReleased).toBe(1)
    // Export's non-preview session also normalizes random requested source frames.
    await renderer.render(2, false); expect(boundary.pictures).toEqual([2 / 60])
    expect(boundary.snapshotCalls).toEqual([true, true, true])
  } finally { await renderer.dispose() }
  expect(boundary.normalizedReleased).toBe(3)
})
it('正向预览的已呈现帧留在同一有界缓存，倒退不重新解码且关闭释放全部引用', async () => {
  const document = { ...fixture(), fps: 60, frameRate: { numerator: 60, denominator: 1 } }
  const renderer = new VideoEditRenderer(document, 3840, undefined, 200)
  const first = await renderer.render(0, true); const next = await renderer.render(1, true)
  expect(first.cacheBytes).toBe(100); expect(next.cacheBytes).toBe(200); expect(boundary.normalizedReleased).toBe(0)
  // Also protect continuous-playback callers that accidentally retain true.
  const reverse = await renderer.render(0, true)
  expect(reverse.cacheHits).toBe(1); expect(boundary.pictures).toEqual([0]); expect(boundary.snapshotCalls).toHaveLength(2)
  await renderer.dispose(); expect(boundary.normalizedReleased).toBe(2)
  expect(() => new VideoEditRenderer(document, 3840, undefined, 9 * 1024 ** 3)).toThrow('预算')
})
it('关闭或替换媒体期间晚到GPU复制不能挂回已释放源或遗留纹理', async () => {
  for (const action of ['dispose', 'replace'] as const) {
    const document = fixture(); const renderer = new VideoEditRenderer(document)
    let release!: () => void; boundary.pendingSnapshot = new Promise(resolve => { release = resolve })
    const rendering = renderer.render(0)
    await vi.waitFor(() => expect(boundary.snapshotCalls.length).toBeGreaterThan(0))
    if (action === 'dispose') await renderer.dispose()
    else await renderer.updateDocument({ ...document, revision: 1, clips: document.clips.map(clip => ({ ...clip, itemId: 'item-B' })) })
    release(); expect((await rendering).presented).toBe(false)
    expect(boundary.normalizedReleased).toBe(1)
    await renderer.dispose(); boundary.snapshotCalls = []; boundary.normalizedReleased = 0; boundary.pendingSnapshot = undefined
  }
})
afterEach(() => { vi.unstubAllGlobals() })
function fixture(): ReturnType<typeof videoEditComposition> {
  const document = createVideoEditDocument('媒体绑定'); addLegacyVideoEditTracks(document.sequences[0])
  document.media = ['A', 'B'].map(id => ({ id, name: id, path: `D:/${id}.mp4`, kind: 'video', width: 3840, height: 2160, durationSeconds: 2 }))
  document.items = document.media.map(media => ({ id: `item-${media.id}`, name: media.name, kind: media.kind, mediaId: media.id }))
  const clip: VideoEditClip = { id: 'clip', itemId: 'item-A', name: '片段', kind: 'video', track: 1, start: 0, duration: 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }
  document.sequences[0].clips = [clip]
  return videoEditComposition(document, document.sequences[0].id)
}
function nestedFixture(): ReturnType<typeof videoEditComposition> {
  const child = fixture(); const parent = createVideoEditSequence('父序列'); addLegacyVideoEditTracks(parent)
  parent.width = child.width; parent.height = child.height
  parent.clips = [{ ...child.clips[0], id: 'nested', kind: 'sequence', itemId: 'nested-item', volume: .5 }]
  return { ...child, ...parent, items: [...child.items, { id: 'nested-item', name: '子序列', kind: 'sequence', sequenceId: child.id }], sequences: [...child.sequences!, parent] }
}
it('多机位预览与导出按机位段选择画面，返回原机位且固定主音频，同一帧不同机位缓存隔离', async () => {
  const document = nestedFixture(); const child = document.sequences![0]
  const base = child.clips[0]
  child.clips.push({ ...base, id: 'camera-b', itemId: 'item-B', track: 2 })
  child.multicam = { cameras: [{ id: 'camera-a', name: '机位1', clipId: base.id }, { id: 'camera-b', name: '机位2', clipId: 'camera-b' }], audioCameraId: 'camera-a' }
  const parent = document.clips[0]
  document.clips = [{ ...parent, duration: 15, multicamCameraId: 'camera-a' }, { ...parent, id: 'cut-b', start: 15, duration: 15, sourceInUs: 500000, multicamCameraId: 'camera-b' }, { ...parent, id: 'return-a', start: 30, duration: 30, sourceInUs: 1000000, multicamCameraId: 'camera-a' }]
  const preview = new VideoEditRenderer(document, 960); const exporter = new VideoEditRenderer(document)
  try {
    for (const [frame, expected] of [[1, base.id], [15, 'camera-b'], [30, base.id]] as const) {
      boundary.draws = []; const a = await preview.render(frame, true); const b = await exporter.render(frame, true)
      expect(a.sourceTimestamps).toEqual(b.sourceTimestamps)
      expect(boundary.draws.filter(draw => draw.offscreen).map(draw => draw.ids)).toEqual([[expected], [expected]])
    }
    const samples = await exporter.mixAudio(0, 1.5)
    for (const at of [0, 24000, 48000]) { expect(samples[0][at]).toBeCloseTo(.125); expect(samples[1][at]).toBeCloseTo(.25) }
    await exporter.updateDocument({ ...document, revision: 1, clips: [{ ...parent, multicamCameraId: 'camera-a' }, { ...parent, id: 'overlay-b', track: 2, multicamCameraId: 'camera-b' }] })
    boundary.draws = []; await exporter.render(15)
    expect(boundary.draws.filter(draw => draw.offscreen).map(draw => draw.ids)).toEqual([[base.id], ['camera-b']])
  } finally { await preview.dispose(); await exporter.dispose() }
})
it('嵌套逐帧渲染：同一子序列同一帧只合成一次，父片段变速倒放沿共享源时钟', async () => {
  const document = nestedFixture(); document.clips.push({ ...document.clips[0], id: 'duplicate', track: 2 })
  const renderer = new VideoEditRenderer(document)
  try {
    const result = await renderer.render(15, true)
    expect(us(result.sourceTimestamps)).toEqual([500000]); expect(result.cacheHits).toBeGreaterThanOrEqual(1)
    expect(boundary.draws.map(draw => draw.ids)).toEqual([['clip'], ['nested', 'duplicate']])
    document.clips = [{ ...document.clips[0], sourceInUs: 2_000_000, duration: 30, speed: { numerator: 2, denominator: 1 }, reverse: true }]
    await renderer.updateDocument({ ...document, revision: 1 })
    expect(us((await renderer.render(5, true)).sourceTimestamps)).toEqual([1600000])
  } finally { await renderer.dispose() }
})
it('嵌套画面作为普通一层参与父效果与运动/不透明度关键帧', async () => {
  const document = nestedFixture()
  document.clips[0].effects = [{ id: 'nested-blur', name: '模糊', enabled: true, amount: .5, builtin: { id: 'gaussian_blur', params: {} } }]
  document.clips[0].curves = { x: [{ time: 0, value: .2, interpolation: 'linear' }], opacity: [{ time: 0, value: .5, interpolation: 'linear' }] }
  const renderer = new VideoEditRenderer(document)
  try {
    await renderer.render(15, true)
    expect(boundary.builtinParams).toHaveLength(1); expect(boundary.mixes).toContain(.5)
    expect(boundary.evaluatedClips).toMatchObject([{ id: 'nested', x: .2, opacity: .5 }])
  } finally { await renderer.dispose() }
})
it('子序列缩短后的父片段尾部渲染透明画面和静音，不冻结子序列最后一帧', async () => {
  const document = nestedFixture(); document.sequences![0].clips[0].duration = 30
  const renderer = new VideoEditRenderer(document)
  try {
    const result = await renderer.render(45, true)
    expect(result.sourceTimestamps).toEqual([])
    expect(boundary.draws.map(draw => draw.ids)).toEqual([[], ['nested']])
    expect((await renderer.mixAudio(1.5, .01)).every(plane => plane.every(sample => sample === 0))).toBe(true)
  } finally { await renderer.dispose() }
})
it('嵌套预览与导出使用相同帧；回放分辨率递归应用，字幕和过渡在子序列内合成', async () => {
  const document = nestedFixture(); const child = document.sequences![0]; const base = child.clips[0]
  child.clips = [{ ...base, duration: 30 }, { ...base, id: 'right-nested', itemId: 'item-B', start: 30, duration: 30 }]
  child.transitions = [{ id: 'nested-transition', kind: 'cross_dissolve', leftClipId: base.id, rightClipId: 'right-nested', durationFrames: 10 }]
  child.captions = [{ id: 'nested-caption', start: 0, duration: 60, text: '字幕' }]
  const preview = new VideoEditRenderer(document, 960); const exporter = new VideoEditRenderer(document)
  try {
    preview.setRenderDivisor(2)
    const a = await preview.render(30, true); const b = await exporter.render(30, true)
    expect(us(a.sourceTimestamps)).toEqual(us(b.sourceTimestamps))
    expect(boundary.mixes).toHaveLength(2)
    expect(boundary.draws.some(draw => draw.size?.[0] === document.width / 2 && draw.offscreen)).toBe(true)
    expect(boundary.draws.some(draw => draw.ids.some(id => id.includes('nested-caption')))).toBe(true)
    expect(() => exporter.setRenderDivisor(2)).toThrow('完整分辨率')
  } finally { await preview.dispose(); await exporter.dispose() }
})
it('递归声音按子采样率与声道重采样，父音量/变速/倒放与导出一致，修改子素材使缓存失效', async () => {
  const document = nestedFixture(); const child = document.sequences![0]
  child.sampleRate = 44100; child.channels = 1
  const preview = new VideoEditRenderer(document, 960); const exporter = new VideoEditRenderer(document)
  try {
    const a = await preview.mixAudio(.5, .01); const b = await exporter.mixAudio(.5, .01)
    expect(a).toEqual(b); expect(a[0][0]).toBeCloseTo(.1875); expect(a[1][0]).toBeCloseTo(.1875)
    const next: ReturnType<typeof videoEditComposition> = { ...document, revision: 1, clips: [{ ...document.clips[0], sourceInUs: 2_000_000, duration: 30, speed: { numerator: 2, denominator: 1 }, reverse: true }], sequences: document.sequences!.map(sequence => sequence.id === child.id ? { ...sequence, clips: sequence.clips.map(clip => ({ ...clip, itemId: 'item-B' })) } : sequence) }
    await preview.updateDocument(next); await exporter.updateDocument(next)
    const reversed = await preview.mixAudio(.5, .01)
    expect(reversed).toEqual(await exporter.mixAudio(.5, .01)); expect(reversed[0][0]).toBeCloseTo(.375)
  } finally { await preview.dispose(); await exporter.dispose() }
})
it('修改素材项引用后画面与声音共同使用新素材，关闭旧解码输入', async () => {
  const document = fixture(); const renderer = new VideoEditRenderer(document)
  try {
    await renderer.render(0); expect(boundary.pictures).toEqual([1])
    expect((await renderer.mixAudio(0, .01))[0][0]).toBe(.25)
    await renderer.updateDocument({ ...document, clips: document.clips.map(clip => ({ ...clip, itemId: 'item-B' })) })
    // Picture and sound of one file share a single parsed input, closed once when no clip uses it.
    expect(boundary.disposed).toEqual(['D:/A.mp4'])
    await renderer.render(0); expect(boundary.pictures).toEqual([2])
    expect((await renderer.mixAudio(0, .01))[0][0]).toBe(.75)
  } finally { await renderer.dispose() }
  expect(boundary.disposed).toEqual(['D:/A.mp4', 'D:/B.mp4'])
})
it('44.1kHz 单声道实际混音包含两源声道，NTSC 分块样本边界连续', async () => {
  const document = { ...fixture(), sampleRate: 44100 as const, channels: 1 as const, frameRate: { numerator: 30000, denominator: 1001 }, fps: 30000 / 1001 }
  const renderer = new VideoEditRenderer(document)
  try {
    const duration = 30 / document.fps
    const first = await renderer.mixAudio(0, duration); const second = await renderer.mixAudio(duration, duration)
    expect(first).toHaveLength(1); expect(first[0][0]).toBe(.375)
    expect(first[0].length + second[0].length).toBe(Math.ceil(2 * duration * 44100 - 1e-7))
    await renderer.updateDocument({ ...document, tracks: document.tracks.map(track => ({ ...track, muted: true })) })
    expect((await renderer.mixAudio(0, .01))[0].every(sample => sample === 0)).toBe(true)
  } finally { await renderer.dispose() }
})
it('拆出的音画共用原引用且混音逐样本不增倍，纯画面独奏不误静音独立声音', async () => {
  const document = fixture(); const renderer = new VideoEditRenderer(document)
  try {
    const original = await renderer.mixAudio(0, .01)
    const video = { ...document.clips[0], sourceComponent: 'video' as const }
    const audio = { ...document.clips[0], id: 'audio-component', kind: 'audio' as const, track: 0, sourceComponent: 'audio' as const }
    await renderer.updateDocument({ ...document, clips: [video, audio], tracks: document.tracks.map(track => ({ ...track, solo: track.index === 1 })) })
    const split = await renderer.mixAudio(0, .01)
    expect(split).toEqual(original)
    await renderer.render(0); expect(boundary.pictures).toEqual([1])
    await renderer.updateDocument({ ...document, clips: [video] })
    expect((await renderer.mixAudio(0, .01))[0].every(sample => sample === 0)).toBe(true)
  } finally { await renderer.dispose() }
})
const codeSource = 'export default {apiVersion:1,name:"原创透明图形",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:10,seed:42,parameters:{},render(ctx){return [rect({x:0,y:0,width:100,height:100,fill:[1,0,0,.5]})];}}'
function mixedFixture(): ReturnType<typeof videoEditComposition> {
  const document = fixture()
  document.codeMaterials = [{ id: 'definition', name: '原创图形', defaultVersionId: 'version', versions: [{ id: 'version', apiVersion: 1, languageVersion: 1, source: codeSource }] }]
  const instance = { definitionId: 'definition', versionId: 'version', parameters: {} }
  document.items.push({ id: 'code-item', name: '原创图形', kind: 'code', code: instance })
  document.clips.push({ ...document.clips[0], id: 'code-clip', itemId: 'code-item', name: '原创图形', kind: 'code', track: 2, code: instance })
  return document
}
function imageFixture(count = 1): ReturnType<typeof videoEditComposition> {
  const document = fixture(); document.clips = []
  document.media = Array.from({ length: count }, (_, index) => ({ id: `image-${index}`, name: '图片', kind: 'image', path: `D:/original-${index}.png`, width: 32, height: 32, durationSeconds: 0 }))
  document.items = document.media.map(media => ({ id: `item-${media.id}`, name: media.name, kind: media.kind, mediaId: media.id }))
  document.clips = document.items.map((item, index) => ({ ...fixture().clips[0], id: `image-clip-${index}`, itemId: item.id, kind: 'image', track: index + 1 }))
  return document
}
it('失败跨帧图片工作集有界，离开不再引用的成功解码图片及时释放', async () => {
  const document = mixedFixture(); const base = imageFixture(4)
  document.media = base.media; document.items.push(...base.items)
  document.clips = [document.clips[1], { ...base.clips[0], track: 1 }]
  const closed = Array.from({ length: 4 }, () => vi.fn())
  let decoded = 0
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }))
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 32, height: 32, close: closed[decoded++] })))
  boundary.failGenerator = true
  const renderer = new VideoEditRenderer(document)
  try {
    for (let index = 0; index < 4; index++) {
      const current = { ...document, revision: index, clips: [document.clips[0], { ...base.clips[index], track: 1 }] }
      await renderer.updateDocument(current)
      await expect(renderer.render(0)).rejects.toThrow('代码画面失败')
      expect(renderer.codeDiagnostics().decodedImages).toBe(1); expect(renderer.codeDiagnostics().decodedImageBytes).toBe(4096)
    }
    expect(closed.slice(0, 3).every(close => close.mock.calls.length === 1)).toBe(true)
  } finally { await renderer.dispose() }
  await Promise.resolve(); expect(closed.every(close => close.mock.calls.length === 1)).toBe(true)
})
it('取消图片消费者不等待原生解码，迟到旧图关闭且不能删除同路径重新定位的新图', async () => {
  const document = imageFixture(); const renderer = new VideoEditRenderer(document)
  const oldClose = vi.fn(); const newClose = vi.fn(); let finish!: (value: { width: number; height: number; close: () => void }) => void
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }))
  const decode = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ width: 32, height: 32, close: newClose })
  vi.stubGlobal('createImageBitmap', decode)
  const old = renderer.render(0)
  await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce())
  renderer.cancelPresentation(); expect((await old).presented).toBe(false)
  const refreshed = { ...document, revision: 1, media: document.media.map(media => ({ ...media, sourceRevision: 'explicit-relink' })) }
  await renderer.updateDocument(refreshed); await renderer.render(0)
  finish({ width: 32, height: 32, close: oldClose }); await vi.waitFor(() => expect(oldClose).toHaveBeenCalledOnce())
  expect(renderer.codeDiagnostics().decodedImages).toBe(1)
  await renderer.render(1); expect(decode).toHaveBeenCalledTimes(2)
  await renderer.dispose(); await Promise.resolve(); expect(newClose).toHaveBeenCalledOnce()
})
it('图片原生解码最多两份，低报元数据仍按实际驻留像素拒绝超预算', async () => {
  const document = imageFixture(3); const renderer = new VideoEditRenderer(document)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }))
  const finish: Array<(value: { width: number; height: number; close: () => void }) => void> = []
  const close = vi.fn(); const decode = vi.fn(() => new Promise(resolve => { finish.push(resolve) })); vi.stubGlobal('createImageBitmap', decode)
  const rendering = renderer.render(0)
  await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2))
  expect(renderer.codeDiagnostics().imageDecodes).toBe(2)
  finish[0]({ width: 32, height: 32, close }); await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(3))
  finish[1]({ width: 32, height: 32, close }); finish[2]({ width: 32, height: 32, close }); await rendering
  expect(renderer.codeDiagnostics().imageDecodes).toBe(0); await renderer.dispose(); await Promise.resolve(); expect(close).toHaveBeenCalledTimes(3)
  const sized = new VideoEditRenderer(imageFixture(2)); const oversizeClose = vi.fn()
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 6144, height: 6144, close: oversizeClose })))
  await expect(sized.render(0)).rejects.toThrow('256MiB')
  expect(sized.codeDiagnostics().decodedImageBytes).toBeLessThanOrEqual(256 * 1024 ** 2); expect(oversizeClose).toHaveBeenCalledOnce()
  await sized.dispose(); await Promise.resolve(); expect(oversizeClose).toHaveBeenCalledTimes(2)
})
it('可见原视频和代码画面走同一合成，静态变换修改复用纹理且离开释放', async () => {
  const document = mixedFixture(); const renderer = new VideoEditRenderer(document)
  try {
    await renderer.render(0); expect(boundary.pictures).toEqual([1, 0])
    expect(boundary.compilerCalls).toBe(1); expect(boundary.generatorCalls).toBe(1)
    await renderer.updateDocument({ ...document, revision: 1, clips: document.clips.map(clip => ({ ...clip, x: .2, opacity: .6 })) })
    const result = await renderer.render(20)
    expect(result.cacheHits).toBe(1); expect(boundary.compilerCalls).toBe(1); expect(boundary.generatorCalls).toBe(1)
    await renderer.render(70); expect(boundary.released.at(-1)).toEqual([])
  } finally { await renderer.dispose() }
  expect(boundary.compilerDisposed).toBe(1)
})
it('完全透明的代码片段不激活源码，隐藏后释放目标且恢复复用已检查program', async () => {
  const document = mixedFixture(); document.clips[1].opacity = 0
  const renderer = new VideoEditRenderer(document)
  try {
    await renderer.render(0)
    expect(boundary.pictures).toEqual([1]); expect(boundary.compilerCalls).toBe(0); expect(boundary.generatorCalls).toBe(0)
    const visible = { ...document, clips: document.clips.map(clip => ({ ...clip, opacity: 1 })) }
    await renderer.updateDocument(visible); await renderer.render(0)
    expect(boundary.compilerCalls).toBe(1); expect(boundary.generatorCalls).toBe(1)
    await renderer.updateDocument(document); await renderer.render(0)
    expect(boundary.pictures).toEqual([1]); expect(boundary.released.at(-1)).toEqual([])
    await renderer.updateDocument(visible); await renderer.render(0)
    expect(boundary.compilerCalls).toBe(1); expect(boundary.generatorCalls).toBe(2)
  } finally { await renderer.dispose() }
})
it('晚到代码检查在更新、取消或关闭后不能呈现旧画面', async () => {
  for (const action of ['update', 'cancel', 'dispose'] as const) {
    const document = mixedFixture(); const renderer = new VideoEditRenderer(document)
    let resolve!: (program: CodeMaterialProgram) => void
    boundary.pendingCode = new Promise(done => { resolve = done })
    const old = renderer.render(0)
    await vi.waitFor(() => expect(boundary.compilerCalls).toBeGreaterThan(0))
    if (action === 'update') await renderer.updateDocument({ ...document, revision: 1 })
    else if (action === 'cancel') renderer.cancelPresentation()
    else await renderer.dispose()
    resolve(compileCodeMaterial(codeSource))
    expect((await old).presented).toBe(false)
    expect(boundary.generatorCalls).toBe(0)
    await renderer.dispose(); boundary.compilerCalls = 0; boundary.pendingCode = undefined
  }
})
it('正向播放从第一帧起按文件建立一条解码计划：同文件剪辑点复用同一解码器且逐帧时间准确，暂停或倒放即释放', async () => {
  boundary.scheduled = []
  const document = { ...fixture(), fps: 60, frameRate: { numerator: 60, denominator: 1 } }
  document.media = document.media.map(media => ({ ...media, durationSeconds: 3 }))
  const base = document.clips[0]
  document.clips = [{ ...base, duration: 60, sourceInUs: 1_000_000 }, { ...base, id: 'repeat', start: 60, duration: 60, sourceInUs: 0 }]
  const renderer = new VideoEditRenderer(document, 3840)
  try {
    // The first frame of a play run is already the first scheduled picture (task 3.6 F1).
    const first = await renderer.render(50, true); await first.completion
    expect(us(first.sourceTimestamps)).toEqual(us([1 + 50 / 60]))
    expect(boundary.scheduled).toHaveLength(1)
    for (let frame = 51; frame <= 61; frame++) {
      const result = await renderer.render(frame, true); await result.completion
      expect(us(result.sourceTimestamps)).toEqual(us([frame < 60 ? 1 + frame / 60 : (frame - 60) / 60]))
    }
    // Both clips of D:/A.mp4 came from one generator (one decoder); the cut jumped back inside it.
    expect(boundary.scheduled.map(entry => entry.path)).toEqual(['D:/A.mp4'])
    // The schedule asks for picture times: source time plus the container timestamp tolerance (task 3.2, D3).
    expect(boundary.scheduled[0].timestamps.slice(0, 11)).toEqual(Array.from({ length: 10 }, (_, index) => 1 + (50 + index) / 60).concat([0]).map(videoEditPictureSeconds))
    const internals = renderer as unknown as { playback?: unknown }
    expect(internals.playback).toBeDefined()
    await (await renderer.render(61, false)).completion
    expect(internals.playback).toBeUndefined()
    // Playing again from elsewhere starts a new schedule at that frame.
    await (await renderer.render(40, true)).completion
    expect(internals.playback).toBeDefined(); expect(boundary.scheduled).toHaveLength(2)
    expect(boundary.scheduled[1].timestamps[0]).toBe(videoEditPictureSeconds(1 + 40 / 60))
  } finally { await renderer.dispose() }
})
it('暂停时预热起播：计划在按下播放前定位到播放头，重画同一暂停帧保留，起播直接取用，换位置即释放', async () => {
  boundary.scheduled = []
  const document = { ...fixture(), fps: 60, frameRate: { numerator: 60, denominator: 1 } }
  document.media = document.media.map(media => ({ ...media, durationSeconds: 3 }))
  document.clips = [{ ...document.clips[0], duration: 120, sourceInUs: 0 }]
  const renderer = new VideoEditRenderer(document, 3840)
  const internals = renderer as unknown as { playback?: unknown }
  try {
    await (await renderer.render(30, false)).completion
    await renderer.armPlayback(30)
    expect(boundary.scheduled).toHaveLength(1); expect(boundary.scheduled[0].timestamps[0]).toBe(videoEditPictureSeconds(30 / 60))
    // The paused frame drawn again (an overlay or region update) keeps the armed schedule; arming again is a no-op.
    await (await renderer.render(30, false)).completion; await renderer.armPlayback(30)
    expect(internals.playback).toBeDefined(); expect(boundary.scheduled).toHaveLength(1)
    // Play takes the armed schedule from its first frame, no second positioning.
    for (let frame = 30; frame <= 33; frame++) {
      const result = await renderer.render(frame, true); await result.completion
      expect(us(result.sourceTimestamps)).toEqual(us([frame / 60]))
    }
    expect(boundary.scheduled).toHaveLength(1)
    // Seeking elsewhere drops an armed schedule like any playback schedule.
    await renderer.armPlayback(70); expect(boundary.scheduled).toHaveLength(2)
    await (await renderer.render(10, false)).completion
    expect(internals.playback).toBeUndefined()
  } finally { await renderer.dispose() }
})

it('源文件缺失时给出可操作的提示，失败不缓存；重新定位到同一素材后立即恢复画面', async () => {
  const base = fixture()
  const missing = { ...base, media: base.media.map(media => media.id === 'A' ? { ...media, path: 'D:/missing.mp4' } : media) }
  const renderer = new VideoEditRenderer(missing)
  try {
    const failure = await renderer.render(0).then(() => undefined, (error: Error) => error)
    expect(failure?.message).toBe('找不到素材「A」的源文件，请在素材面板中右键该素材，选择“重新定位源文件”。')
    expect(failure?.message).not.toContain('henji-media')
    expect(boundary.disposed).toContain('D:/missing.mp4')
    await renderer.updateDocument(base)
    await renderer.render(0); expect(boundary.pictures).toEqual([1])
  } finally { await renderer.dispose() }
})
it('渲染器只经注入的帧源后端取帧：定位、顺序、正向计划与声音都走接口，打开与释放成对', async () => {
  boundary.scheduled = []; const opened: string[] = []; const released: string[] = []; const calls: string[] = []
  const picture = (timestamp: number) => ({ timestamp, duration: 1 / 60, format: 'NV12', close: vi.fn() }) as unknown as VideoSample
  const backend: VideoEditFrameBackend = {
    open(media) {
      opened.push(media.path)
      return { key: media.path, ready: Promise.resolve({ codec: 'avc1',
        clipFrames: () => ({ async *frames(start: number) { calls.push('frames'); for (let frame = 0; frame < 4; frame++) yield picture(gridPicture(start) + frame / 60) }, async frameAt(time: number) { calls.push('frameAt'); return picture(gridPicture(time)) } }),
        clipAudio: () => ({ async *chunks() { yield { timestamp: 0, duration: 2, numberOfFrames: 96000, numberOfChannels: 2, sampleRate: 48000, copyTo(data: Float32Array) { data.fill(.5) }, close: vi.fn() } } }),
        async *schedule(timestamps: readonly number[]) { calls.push('schedule'); for (const time of timestamps) yield picture(gridPicture(time)) },
      }) }
    },
    release(key) { released.push(key) },
    seeker(media, _cache, snapshot) { calls.push('seeker'); return { sample: async time => ({ sample: await snapshot(picture(gridPicture(time)), true), hit: false }), dispose: async () => {} } },
  }
  const document = { ...fixture(), fps: 60, frameRate: { numerator: 60, denominator: 1 } }
  const renderer = new VideoEditRenderer(document, 3840, undefined, 8 * 1024 ** 3, backend)
  try {
    await renderer.render(0); expect(boundary.pictures).toEqual([0])
    await renderer.render(1, true); expect(boundary.pictures).toEqual([1 / 60])
    await renderer.render(2, true); expect(boundary.pictures).toEqual([2 / 60])
    // Starting playback opens no sequential reader: the schedule alone positions and decodes (task 3.6 F1).
    expect(calls).toEqual(['seeker', 'schedule'])
    expect((await renderer.mixAudio(0, .01))[0][0]).toBe(.5)
    // The production fallback is untouched: nothing reached mediabunny.
    expect(boundary.disposed).toEqual([]); expect(boundary.scheduled).toEqual([])
  } finally { await renderer.dispose() }
  expect(opened.length).toBeGreaterThan(0); expect(released.sort()).toEqual(opened.sort())
})
it('原生借用帧经同一复制入口进入自有显存：正向计划、剪辑点预取与定位的每一帧复制后只交回一次，从不在渲染器里关闭帧本身', async () => {
  const lent: Array<{ ptsUs: number; release: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = []
  const picture = (seconds: number): VideoEditNativePicture => {
    const entry = { ptsUs: Math.round(seconds * 1e6), release: vi.fn(), close: vi.fn() }; lent.push(entry)
    return new VideoEditNativePicture({ frame: { codedWidth: 3840, codedHeight: 2160, format: 'NV12', close: entry.close }, meta: { route: 'r', streamId: 's', frameIndex: 0, timestampUs: entry.ptsUs, ptsUs: entry.ptsUs, durationUs: 16_667 }, receivedAt: 0, release: entry.release } as unknown as NativeVideoFrame, 0, 1 / 60)
  }
  const backend: VideoEditFrameBackend = {
    open: media => ({ key: media.path, ready: Promise.resolve({ clipFrames: () => ({ async *frames(start: number) { for (let frame = 0; frame < 3; frame++) yield picture(gridPicture(start) + frame / 60) }, frameAt: async (time: number) => picture(gridPicture(time)) }), clipAudio: () => undefined, async *schedule(timestamps: readonly number[]) { for (const time of timestamps) yield picture(gridPicture(time)) } }) }),
    release: () => {},
    seeker: (_media, _cache, snapshot) => ({ sample: async time => { const decoded = picture(gridPicture(time)); try { return { sample: await snapshot(decoded, true), hit: false } } finally { decoded.close() } }, dispose: async () => {} }),
  }
  const document = { ...fixture(), fps: 60, frameRate: { numerator: 60, denominator: 1 } }
  const renderer = new VideoEditRenderer(document, 3840, undefined, 8 * 1024 ** 3, backend)
  try {
    await renderer.render(0); await renderer.render(1, true); await renderer.render(2, true); await renderer.render(3, true)
    expect(boundary.pictures).toEqual([3 / 60])
  } finally { await renderer.dispose() }
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(lent.length).toBeGreaterThan(3)
  for (const entry of lent) { expect(entry.release, `帧 ${entry.ptsUs}`).toHaveBeenCalledOnce(); expect(entry.close).not.toHaveBeenCalled() }
})
it('源时间早于流的首个画面（MPEG 节目流从 0.533 秒开始）时该层透明、不记源时间，不让整帧失败；超出素材时长仍报错', async () => {
  const backend: VideoEditFrameBackend = {
    open: media => ({ key: media.path, ready: Promise.resolve({ clipFrames: () => ({ async *frames() {}, frameAt: async () => null }), clipAudio: () => undefined, async *schedule() {} }) }),
    release: () => {},
    seeker: () => ({ sample: async () => ({ hit: false }), dispose: async () => {} }),
  }
  const document = fixture()
  const renderer = new VideoEditRenderer(document, undefined, undefined, 8 * 1024 ** 3, backend)
  try {
    const result = await renderer.render(10)
    expect(result).toMatchObject({ presented: true, blankPictures: 1, sourceTimestamps: [] })
    const preview = new VideoEditRenderer(document, 3840, undefined, 8 * 1024 ** 3, backend)
    try { expect(await preview.render(10)).toMatchObject({ presented: true, blankPictures: 1 }) } finally { await preview.dispose() }
    // A sequential reader started before the first picture yields that picture early; it waits for its own time.
    const firstAtHalf: VideoEditFrameBackend = { ...backend, open: media => ({ key: media.path, ready: Promise.resolve({ clipFrames: () => ({ async *frames() { for (let index = 0; index < 30; index++) yield { timestamp: .5 + index / 30, duration: 1 / 30, format: 'NV12', close: vi.fn() } as unknown as VideoSample }, frameAt: async () => null }), clipAudio: () => undefined, async *schedule() {} }) }) }
    const sequential = new VideoEditRenderer({ ...document, fps: 30, frameRate: { numerator: 30, denominator: 1 } }, undefined, undefined, 8 * 1024 ** 3, firstAtHalf)
    try {
      expect(await sequential.render(14, true)).toMatchObject({ blankPictures: 1, sourceTimestamps: [] })
      expect(await sequential.render(15, true)).toMatchObject({ blankPictures: 0, sourceTimestamps: [.5] })
    } finally { await sequential.dispose() }
    const late = { ...document, clips: [{ ...document.clips[0], sourceInUs: 2_000_000 }] }
    await renderer.updateDocument(late)
    await expect(renderer.render(0)).rejects.toThrow('在此时间没有画面')
  } finally { await renderer.dispose() }
})
it('导出逐帧（无预览宽度的顺序渲染，2.4）：读取器跳过或提前结束时由单帧读取补上准确画面；单帧读取也失败时该帧失败、不画替代画面', async () => {
  const starts: number[] = []; const singleReads: number[] = []; const lent: Array<{ close: ReturnType<typeof vi.fn> }> = []
  const picture = (index: number): VideoSample => { const value = { timestamp: index / 30, duration: 1 / 30, format: 'NV12', close: vi.fn() }; lent.push(value); return value as unknown as VideoSample }
  // First reader: loses picture 2 on the way and ends after picture 4. Second reader: loses picture 10.
  const lost = [[2], [10]]; const lastIndex = [4, 59]
  let frameAtFails = false
  const backend: VideoEditFrameBackend = {
    open: media => ({ key: media.path, ready: Promise.resolve({ clipAudio: () => undefined, async *schedule() {},
      clipFrames: () => ({
        async *frames(start: number) { const reader = starts.push(start) - 1; for (let index = Math.round(start * 30); index <= lastIndex[reader]; index++) if (!lost[reader].includes(index)) yield picture(index) },
        async frameAt(time: number) { singleReads.push(Math.round(time * 30)); if (frameAtFails) throw new Error('素材「A」解码失败，请确认文件可用，或在素材面板中重新定位源文件。'); return picture(Math.round(time * 30)) },
      }) }) }),
    release: () => {},
    seeker: () => { throw new Error('导出不定位。') },
  }
  const renderer = new VideoEditRenderer(fixture(), undefined, undefined, 8 * 1024 ** 3, backend)
  try {
    const drawn: number[] = []; let reads = 0
    for (let frame = 0; frame < 10; frame++) {
      const result = await renderer.render(frame, true)
      expect(result).toMatchObject({ presented: true, blankPictures: 0, sourceTimestamps: [frame / 30] })
      drawn.push(Math.round(boundary.pictures[0] * 30)); reads += result.singleFrameReads
    }
    expect(drawn).toEqual(Array.from({ length: 10 }, (_, index) => index))
    // Picture 2 (lost) and 5 (after the first reader ended) came from single-frame reads; the next frame restarted the reader.
    expect(singleReads).toEqual([2, 5]); expect(reads).toBe(2); expect(starts).toEqual([0, 6 / 30].map(videoEditPictureSeconds))
    frameAtFails = true; const draws = boundary.draws.length
    await expect(renderer.render(10, true)).rejects.toThrow('素材「A」取不到准确的画面：解码失败，请确认文件可用，或在素材面板中重新定位源文件。')
    expect(boundary.draws).toHaveLength(draws); expect(singleReads).toEqual([2, 5, 10])
  } finally { await renderer.dispose() }
  // Every decoded picture, including the one held ahead of the failed frame, went back exactly once.
  for (const value of lent) expect(value.close).toHaveBeenCalledOnce()
})
it('预览播放回落到顺序读取器（时间计划没有该帧，3.1）：读取器漏掉的帧与变帧率时长不准的保持画面都由单帧读取定准，不画透明', async () => {
  // Pictures at 0, 1/30, 2/30 (lost by the reader), 3/30, then 4/30 with a too-short duration and the next at 6/30.
  const times = [0, 1 / 30, 2 / 30, 3 / 30, 4 / 30, 6 / 30, 7 / 30]
  const lent: Array<{ close: ReturnType<typeof vi.fn> }> = []
  const picture = (time: number): VideoSample => { const value = { timestamp: time, duration: time === 4 / 30 ? 1 / 60 : 1 / 30, format: 'NV12', close: vi.fn() }; lent.push(value); return value as unknown as VideoSample }
  const singleReads: number[] = []
  const backend: VideoEditFrameBackend = {
    open: media => ({ key: media.path, ready: Promise.resolve({ clipAudio: () => undefined, async *schedule() {},
      clipFrames: () => ({
        // Starts with the picture showing at its start (the last one starting at or before it), like the backends.
        async *frames(start: number) { const first = times.filter(value => value <= start + 1e-9).at(-1) ?? times[0]; for (const time of times) if (time >= first && time !== 2 / 30) yield picture(time) },
        // The single-frame read's definition: the last picture starting at or before the time.
        async frameAt(time: number) { singleReads.push(Math.round(time * 30)); const at = times.filter(value => value <= time + 1e-9).at(-1); return at === undefined ? null : picture(at) },
      }) }) }),
    release: () => {},
    seeker: () => ({ sample: async () => ({ hit: false }), dispose: async () => {} }),
  }
  const document = { ...fixture(), fps: 30, frameRate: { numerator: 30, denominator: 1 } }
  const renderer = new VideoEditRenderer(document, 3840, undefined, 8 * 1024 ** 3, backend)
  try {
    const drawn: number[] = []
    for (let frame = 0; frame < 8; frame++) {
      const result = await renderer.render(frame, true)
      expect(result, `帧 ${frame}`).toMatchObject({ presented: true, blankPictures: 0 })
      drawn.push(Math.round(boundary.pictures[0] * 30))
    }
    expect(drawn).toEqual([0, 1, 2, 3, 4, 4, 6, 7])
    expect(singleReads).toEqual([2, 5])
  } finally { await renderer.dispose() }
  for (const value of lent) expect(value.close).toHaveBeenCalledOnce()
})
/** A backend whose sound comes from the native reader over a fake PCM session, as the native backend will deliver it. */
function nativeSoundBackend(session: (path: string) => VideoEditPcmSession): { backend: VideoEditFrameBackend; opened: string[]; released: string[] } {
  const opened: string[] = []; const released: string[] = []
  const backend: VideoEditFrameBackend = {
    open(media) {
      opened.push(media.path)
      return { key: media.path, ready: Promise.resolve({ clipFrames: () => undefined, clipAudio: () => createVideoEditNativeClipAudio(async () => session(media.path)), async *schedule() {} }) }
    },
    release(key) { released.push(key) },
    seeker() { throw new Error('声音测试不定位画面。') },
  }
  return { backend, opened, released }
}
function pcmSession(sampleRate: number, channels: number, value: (channel: number, sample: number) => number, onClose = () => {}): VideoEditPcmSession {
  return { sampleRate, channels, close: onClose,
    async read(first: number, frames: number) { return Array.from({ length: channels }, (_, channel) => Float32Array.from({ length: frames }, (_, index) => value(channel, first + index))) } }
}
it.each([44100, 48000])('原生声音经混音逐样本对齐：微秒入点、非零流起点、跨混音块、末尾补零，%iHz 块混入 48kHz 序列（同采样率取最近样本）', async sourceRate => {
  // Sound only between 0.523s and 1.9s of the source timeline; a one-sample or one-microsecond shift changes the values.
  const [soundStart, soundEnd] = [Math.round(.523 * sourceRate), Math.round(1.9 * sourceRate)]
  const signal = (channel: number, sample: number): number => sample >= soundStart && sample < soundEnd ? Math.fround(channel * .5 + (sample * 7 % 1000) / 1000 * .4) : 0
  const { backend } = nativeSoundBackend(() => pcmSession(sourceRate, 2, signal))
  const base = fixture(); const fps = 30000 / 1001
  const clip = { ...base.clips[0], start: 7, duration: 60, sourceInUs: 400_000, sourceRemainder: { numerator: 1, denominator: 3 } }
  const document = { ...base, fps, frameRate: { numerator: 30000, denominator: 1001 }, clips: [clip] }
  const renderer = new VideoEditRenderer(document, undefined, undefined, 8 * 1024 ** 3, backend)
  try {
    const blocks: Float32Array[][] = []
    for (let start = 0; start < 2.5; start += .5) blocks.push(await renderer.mixAudio(start, .5))
    const rate = 48000; const inPoint = (400_000 + 1 / 3) / 1e6
    const [first, last] = [Math.ceil(clip.start / fps * rate - 1e-7), Math.ceil((clip.start + clip.duration) / fps * rate - 1e-7)]
    let worst = 0; let audible = 0
    for (const channel of [0, 1]) {
      const output = blocks.flatMap(block => [...block[channel]])
      expect(output).toHaveLength(2.5 * rate)
      output.forEach((actual, sample) => {
        let expected = 0
        if (sample >= first && sample < last) {
          const position = (inPoint + sample / rate - clip.start / fps) * sourceRate
          // Blocks at the sequence rate are read by nearest sample (no interpolation filter); others interpolate.
          if (sourceRate === rate) expected = signal(channel, Math.floor(position + .5 + 1e-6))
          else {
            const left = Math.floor(position); const alpha = position - left
            expected = signal(channel, left) * (1 - alpha) + signal(channel, left + 1) * alpha
          }
        }
        if (expected !== 0) audible++
        worst = Math.max(worst, Math.abs(actual - expected))
      })
    }
    expect(audible).toBeGreaterThan(rate); expect(worst).toBeLessThan(1e-5)
  } finally { await renderer.dispose() }
})
it('原生多声道按混音统一规则映射：立体声取前左前右，单声道取全部声道平均', async () => {
  const sixChannels = () => pcmSession(48000, 6, channel => Math.fround(.1 * (channel + 1)))
  for (const [channels, expected] of [[2, [.1, .2]], [1, [.35]]] as const) {
    const { backend } = nativeSoundBackend(sixChannels)
    const renderer = new VideoEditRenderer({ ...fixture(), channels }, undefined, undefined, 8 * 1024 ** 3, backend)
    try {
      const mix = await renderer.mixAudio(.25, .01)
      expect(mix).toHaveLength(channels)
      mix.forEach((plane, channel) => expect(plane.every(value => Math.abs(value - expected[channel]) < 1e-6)).toBe(true))
    } finally { await renderer.dispose() }
  }
})
it('片段声音读取器随源释放而关闭，原生会话只关一次，打开与释放成对', async () => {
  let closed = 0
  const { backend, opened, released } = nativeSoundBackend(() => pcmSession(48000, 2, () => .5, () => { closed++ }))
  const renderer = new VideoEditRenderer(fixture(), undefined, undefined, 8 * 1024 ** 3, backend)
  try {
    expect((await renderer.mixAudio(0, .01))[0][0]).toBe(.5)
    expect(closed).toBe(0)
    // Past the clip: the mix drops the clip's sound source and its native session.
    expect((await renderer.mixAudio(5, .01))[0].every(value => value === 0)).toBe(true)
    expect(closed).toBe(1)
    expect((await renderer.mixAudio(0, .01))[0][0]).toBe(.5)
  } finally { await renderer.dispose() }
  expect(closed).toBe(2); expect(released.sort()).toEqual(opened.sort())
})
it('混音把序列采样率交给声音读取器；序列采样率改变后按新采样率读取', async () => {
  const rates: Array<number | undefined> = []
  const backend: VideoEditFrameBackend = {
    open(media) { return { key: media.path, ready: Promise.resolve({ clipFrames: () => undefined, clipAudio: () => ({ chunks: (_start: number, _end: number, sampleRate?: number) => { rates.push(sampleRate); return (async function* () {})() } }), async *schedule() {} }) } },
    release() {},
    seeker() { throw new Error('声音测试不定位画面。') },
  }
  const document = fixture()
  const renderer = new VideoEditRenderer(document, undefined, undefined, 8 * 1024 ** 3, backend)
  try {
    await renderer.mixAudio(0, .01)
    await renderer.updateDocument({ ...document, sampleRate: 44100 })
    await renderer.mixAudio(0, .01)
    expect(rates).toEqual([48000, 44100])
  } finally { await renderer.dispose() }
})
it('同采样率块按最近样本混入：半样本相位在相邻混音块中选同一个邻居，块边界不漏不重', async () => {
  // A 48kHz in-point exactly half a sample in: every output sample takes the later neighbour, in every block.
  const signal = (_channel: number, sample: number): number => Math.fround(sample / 1e5)
  const { backend } = nativeSoundBackend(() => pcmSession(48000, 1, signal))
  const base = fixture()
  const clip = { ...base.clips[0], start: 0, duration: 60, sourceInUs: 10, sourceRemainder: { numerator: 5, denominator: 12 } }
  const renderer = new VideoEditRenderer({ ...base, channels: 1, clips: [clip] }, undefined, undefined, 8 * 1024 ** 3, backend)
  try {
    const output = [...(await renderer.mixAudio(0, .25))[0], ...(await renderer.mixAudio(.25, .25))[0]]
    // 10 + 5/12 µs at 48kHz is exactly 0.5 samples.
    expect(output.every((value, sample) => value === signal(0, sample + 1))).toBe(true)
  } finally { await renderer.dispose() }
})
it('声道映射（2.6）：每个片段按映射读取指定声音流，单声道居中、两条单声道合成立体声、单声道序列取平均；轨道静音逐轨生效，不再使用的流会话释放', async () => {
  const sessions: Array<{ stream: number | undefined; closed: boolean }> = []
  const backend: VideoEditFrameBackend = {
    open: media => ({ key: media.path, ready: Promise.resolve({ clipFrames: () => undefined, async *schedule() {},
      clipAudio: (stream?: number) => createVideoEditNativeClipAudio(async () => {
        if (stream === 9) return null
        const entry = { stream, closed: false }; sessions.push(entry)
        return pcmSession(48000, 1, () => Math.fround(.1 * ((stream ?? 0) + 1)), () => { entry.closed = true })
      }) }) }),
    release() {},
    seeker() { throw new Error('声音测试不定位画面。') },
  }
  const base = fixture()
  const sound = (id: string, track: number, audioMapping?: VideoEditClip['audioMapping']): VideoEditClip => ({ ...base.clips[0], id, kind: 'audio', sourceComponent: 'audio', track, ...(audioMapping ? { audioMapping } : {}) })
  const tracks = [...base.tracks, { id: 'a2', name: '音频 2', index: 8, kind: 'audio' as const, locked: false, enabled: true, muted: false, solo: false }, { id: 'a3', name: '音频 3', index: 9, kind: 'audio' as const, locked: false, enabled: true, muted: false, solo: false }]
  const clips = [sound('third', 0, { format: 'mono', sources: [{ stream: 2, channel: 0 }] }), sound('pair', 8, { format: 'stereo', sources: [{ stream: 0, channel: 0 }, { stream: 1, channel: 0 }] }), sound('missing', 9, { format: 'mono', sources: [{ stream: 9, channel: 0 }] })]
  const document = { ...base, tracks, clips }
  const renderer = new VideoEditRenderer(document, undefined, undefined, 8 * 1024 ** 3, backend)
  const level = (plane: Float32Array): number => { expect(plane.every(value => Math.abs(value - plane[0]) < 1e-7)).toBe(true); return plane[0] }
  try {
    expect((await renderer.mixAudio(.25, .01)).map(level).map(value => Math.round(value * 1e6) / 1e6)).toEqual([.4, .5])
    expect(sessions.map(entry => entry.stream).sort()).toEqual([0, 1, 2])
    // Muting the stereo pair's track leaves the centred mono clip in both channels.
    await renderer.updateDocument({ ...document, tracks: tracks.map(track => track.index === 8 ? { ...track, muted: true } : track) })
    expect((await renderer.mixAudio(.25, .01)).map(level).map(value => Math.round(value * 1e6) / 1e6)).toEqual([.3, .3])
    expect(sessions.filter(entry => entry.stream !== 2).every(entry => entry.closed)).toBe(true)
    // A mono sequence averages the stereo clip's two channels.
    await renderer.updateDocument({ ...document, channels: 1 })
    expect((await renderer.mixAudio(.25, .01)).map(level).map(value => Math.round(value * 1e6) / 1e6)).toEqual([.45])
    // A clip without a mapping still reads the first stream with its own channels.
    await renderer.updateDocument({ ...document, clips: [sound('plain', 0)] })
    expect((await renderer.mixAudio(.25, .01)).map(level).map(value => Math.round(value * 1e6) / 1e6)).toEqual([.1, .1])
    expect(sessions.at(-1)!.stream).toBeUndefined()
    expect(sessions.slice(0, -1).every(entry => entry.closed)).toBe(true)
  } finally { await renderer.dispose() }
  expect(sessions.every(entry => entry.closed)).toBe(true)
})
it('回放分辨率（4.9）：预览按 1/N 画布与合成尺寸渲染、换尺寸丢弃旧缓存帧；导出拒绝降低分辨率', async () => {
  const document = fixture()
  const renderer = new VideoEditRenderer(document, document.width)
  try {
    await (await renderer.render(0)).completion
    renderer.setRenderDivisor(4)
    expect([renderer.canvas.width, renderer.canvas.height]).toEqual([Math.round(document.width / 4), Math.round(document.height / 4)])
    expect(boundary.divisors).toEqual([4])
    boundary.draws = []
    await (await renderer.render(1)).completion
    expect(boundary.draws.at(-1)?.size).toEqual([Math.round(document.width / 4), Math.round(document.height / 4)])
    // 回到完整：画布、合成尺寸与解码图片尺寸一起恢复
    renderer.setRenderDivisor(1)
    expect([renderer.canvas.width, renderer.canvas.height]).toEqual([document.width, document.height])
    expect(boundary.divisors).toEqual([4, 1])
    boundary.draws = []
    await (await renderer.render(1)).completion
    expect(boundary.draws.at(-1)?.size).toEqual([document.width, document.height])
    expect(() => renderer.setRenderDivisor(3)).toThrow('回放分辨率无效')
  } finally { await renderer.dispose() }
  const exporter = new VideoEditRenderer(document)
  try { expect(() => exporter.setRenderDivisor(2)).toThrow('完整分辨率') } finally { await exporter.dispose() }
})
it('变速与倒放按片段速度取帧（4.13 帧采样）：正放跳帧，倒放逐帧后退', async () => {
  const document = { ...fixture(), fps: 60, frameRate: { numerator: 60, denominator: 1 } }
  const base = document.clips[0]
  document.clips = [{ ...base, duration: 30, speed: { numerator: 2, denominator: 1 } }]
  const renderer = new VideoEditRenderer(document)
  try {
    await renderer.render(5); expect(us(boundary.pictures)).toEqual(us([10 / 60]))
    await renderer.updateDocument({ ...document, clips: [{ ...base, duration: 30, sourceInUs: 1_000_000, speed: { numerator: 2, denominator: 1 }, reverse: true }] })
    // 倒放：开头那一刻是源 1 秒，第 k 帧取 1 - (k+1)·2/60。
    await renderer.render(0); expect(us(boundary.pictures)).toEqual(us([58 / 60]))
    await renderer.render(10); expect(us(boundary.pictures)).toEqual(us([38 / 60]))
  } finally { await renderer.dispose() }
})

it('片内运动、不透明度、Lumetri 关键帧在预览与导出同一帧求值一致', async () => {
  const document = { ...fixture(), fps: 60, frameRate: { numerator: 60, denominator: 1 } }
  const points = (from: number, to: number) => [{ time: 0, value: from, interpolation: 'ease' as const }, { time: 30, value: to, interpolation: 'linear' as const }]
  document.clips[0] = { ...document.clips[0], curves: { x: points(0, .4), y: points(0, -.2), scale: points(1, 2), rotation: points(0, 90), anchorX: points(.5, .25), opacity: points(1, .2) }, effects: [{ id: 'animated-color', name: 'Lumetri', enabled: true, amount: 1, builtin: { id: 'lumetri_color', params: {}, curves: { exposure: points(0, 2) } } }] }
  const preview = new VideoEditRenderer(document, 1920); const exported = new VideoEditRenderer(document)
  const read = () => ({ x: boundary.evaluatedClips[0].x, y: boundary.evaluatedClips[0].y, scale: boundary.evaluatedClips[0].scale, rotation: boundary.evaluatedClips[0].rotation, anchorX: boundary.evaluatedClips[0].anchorX, opacity: boundary.evaluatedClips[0].opacity, exposure: boundary.builtinParams.at(-1)?.exposure })
  try {
    await preview.render(15, true); const shown = read()
    expect(shown).toEqual({ x: .2, y: -.1, scale: 1.5, rotation: 45, anchorX: .375, opacity: .6, exposure: 1 })
    await exported.render(15); expect(read()).toEqual(shown)
  } finally { await preview.dispose(); await exported.dispose() }
})
