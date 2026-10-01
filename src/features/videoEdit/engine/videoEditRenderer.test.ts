import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditDocument, videoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { VideoEditRenderer } from './videoEditRenderer'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'

const boundary = vi.hoisted(() => ({ disposed: [] as string[], pictures: [] as number[], generatorCalls: 0, compilerCalls: 0, compilerDisposed: 0, released: [] as string[][], pendingCode: undefined as Promise<CodeMaterialProgram> | undefined, snapshotCalls: [] as boolean[], normalizedReleased: 0, pendingSnapshot: undefined as Promise<void> | undefined }))
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
      async getPrimaryVideoTrack() { return { path: this.path, getDecoderConfig: async () => ({ codec: 'avc1' }) } }
      async getPrimaryAudioTrack() { return { path: this.path } }
      dispose(): void { boundary.disposed.push(this.path) }
    },
    VideoSampleSink: class {
      constructor(readonly track: { path: string }) {}
      async getSample(time: number) { return { timestamp: time || (this.track.path.includes('B') ? 2 : 1), duration: 1 / 60, format: 'NV12', close: vi.fn() } }
      async *samples(start: number) { for (let frame = 0; frame < 4; frame++) yield { timestamp: start + frame / 60, duration: 1 / 60, format: 'NV12', close: vi.fn() } }
    },
    AudioSampleSink: class {
      constructor(readonly track: { path: string }) {}
      async *samples() { const path = this.track.path; yield { timestamp: 0, duration: 2, numberOfFrames: 96000, sampleRate: 48000, numberOfChannels: 2,
        copyTo(data: Float32Array, options: { planeIndex: number }): void { data.fill(path.includes('B') ? .75 : options.planeIndex === 0 ? .25 : .5) }, close: vi.fn() } }
    },
  }
})
vi.mock('./videoEditGpuCompositor', async () => {
  const { VideoEditGpuFrame } = await import('./videoEditGpuFrame')
  return { VideoEditGpuCompositor: class {
  async snapshot(sample: { timestamp: number; duration: number }, compact: boolean) {
    boundary.snapshotCalls.push(compact); await boundary.pendingSnapshot
    return new VideoEditGpuFrame({ ...sample, displayWidth: 3840, displayHeight: 2160, rotation: 0, flip: false }, { createView: () => ({}), destroy: vi.fn() }, undefined, 100, () => { boundary.normalizedReleased++ })
  }
  async code() { return { generator: async (_key: string, _program: CodeMaterialProgram, context: { time: number }) => { boundary.generatorCalls++; return { timestamp: context.time } }, releaseUnused: (keys: ReadonlySet<string>) => { boundary.released.push([...keys]) } } }
  async draw(_document: unknown, _clips: unknown, pictures: Array<{ timestamp: number }>) { boundary.pictures = pictures.map(picture => picture.timestamp); return { presented: true, completion: Promise.resolve() } }
  async dispose(): Promise<void> {}
  cancelPresentation(): void {}
} } })
beforeEach(() => {
  boundary.disposed = []; boundary.pictures = []
  boundary.generatorCalls = 0; boundary.compilerCalls = 0; boundary.compilerDisposed = 0; boundary.released = []; boundary.pendingCode = undefined
  boundary.snapshotCalls = []; boundary.normalizedReleased = 0; boundary.pendingSnapshot = undefined
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} })
  vi.stubGlobal('VideoDecoder', { isConfigSupported: async () => ({ supported: true }) })
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
  const document = createVideoEditDocument('媒体绑定')
  document.media = ['A', 'B'].map(id => ({ id, name: id, path: `D:/${id}.mp4`, kind: 'video', width: 3840, height: 2160, durationSeconds: 2 }))
  document.items = document.media.map(media => ({ id: `item-${media.id}`, name: media.name, kind: media.kind, mediaId: media.id }))
  const clip: VideoEditClip = { id: 'clip', itemId: 'item-A', name: '片段', kind: 'video', track: 1, start: 0, duration: 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }
  document.sequences[0].clips = [clip]
  return videoEditComposition(document, document.sequences[0].id)
}
it('修改项目项引用后画面与声音共同使用新素材，关闭旧解码输入', async () => {
  const document = fixture(); const renderer = new VideoEditRenderer(document)
  try {
    await renderer.render(0); expect(boundary.pictures).toEqual([1])
    expect((await renderer.mixAudio(0, .01))[0][0]).toBe(.25)
    await renderer.updateDocument({ ...document, clips: document.clips.map(clip => ({ ...clip, itemId: 'item-B' })) })
    expect(boundary.disposed).toEqual(['D:/A.mp4', 'D:/A.mp4'])
    await renderer.render(0); expect(boundary.pictures).toEqual([2])
    expect((await renderer.mixAudio(0, .01))[0][0]).toBe(.75)
  } finally { await renderer.dispose() }
  expect(boundary.disposed).toEqual(['D:/A.mp4', 'D:/A.mp4', 'D:/B.mp4', 'D:/B.mp4'])
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
const codeSource = 'export default {apiVersion:1,name:"原创透明图形",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:10,seed:42,parameters:{},render(ctx){return [rect({x:0,y:0,width:100,height:100,fill:[1,0,0,.5]})];}}'
function mixedFixture(): ReturnType<typeof videoEditComposition> {
  const document = fixture()
  document.codeMaterials = [{ id: 'definition', name: '原创图形', defaultVersionId: 'version', versions: [{ id: 'version', apiVersion: 1, languageVersion: 1, source: codeSource }] }]
  const instance = { definitionId: 'definition', versionId: 'version', parameters: {} }
  document.items.push({ id: 'code-item', name: '原创图形', kind: 'code', code: instance })
  document.clips.push({ ...document.clips[0], id: 'code-clip', itemId: 'code-item', name: '原创图形', kind: 'code', track: 2, code: instance })
  return document
}
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
