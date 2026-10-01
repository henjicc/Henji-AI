import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditDocument, videoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { VideoEditRenderer } from './videoEditRenderer'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'

const boundary = vi.hoisted(() => ({ disposed: [] as string[], pictures: [] as number[], generatorCalls: 0, compilerCalls: 0, compilerDisposed: 0, failGenerator: false, released: [] as string[][], pendingCode: undefined as Promise<CodeMaterialProgram> | undefined, snapshotCalls: [] as boolean[], normalizedReleased: 0, pendingSnapshot: undefined as Promise<void> | undefined }))
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
  async code() { return { generator: async (_key: string, _program: CodeMaterialProgram, context: { time: number }) => { boundary.generatorCalls++; if (boundary.failGenerator) throw new Error('代码画面失败'); return { timestamp: context.time } }, releaseUnused: (keys: ReadonlySet<string>) => { boundary.released.push([...keys]) } } }
  async prepareImages() { return new Map() }
  imageDiagnostics() { return { textures: 0, bytes: 0, uploads: 0 } }
  codeDiagnostics() { return undefined }
  async draw(_document: unknown, _clips: unknown, pictures: Array<{ timestamp: number }>) { boundary.pictures = pictures.map(picture => picture.timestamp); return { presented: true, completion: Promise.resolve() } }
  async dispose(): Promise<void> {}
  cancelPresentation(): void {}
} } })
beforeEach(() => {
  boundary.disposed = []; boundary.pictures = []
  boundary.generatorCalls = 0; boundary.compilerCalls = 0; boundary.compilerDisposed = 0; boundary.failGenerator = false; boundary.released = []; boundary.pendingCode = undefined
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
