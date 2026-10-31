import { expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import type { AuthorModule } from './videoEditAuthorModule'
import { VideoEditCodeFingerprint } from './videoEditCodeFingerprint'
import { VideoEditCodeSources } from './videoEditCodeSources'

const state = vi.hoisted(() => ({ effect: undefined as AuthorModule | undefined }))
// 只替换编译和原生 ESM 边界；保留正式片段准备、参数/输入求值、完整文件表及指纹路径。
vi.mock('./videoEditCodeCompiler', async () => {
  const { testAuthorBundle } = await import('./videoEditAuthorTestFixtures')
  return { VideoEditCodeCompiler: class { async bundle(files: CodeMaterialFiles) { return testAuthorBundle(files) } dispose() {} } }
})
vi.mock('./videoEditAuthorModules', () => ({ prepareAuthorModuleUrls: async () => ({ url: 'author-test', dispose() {} }) }))
vi.mock('./videoEditAuthorModule', () => ({ loadAuthorModule: async () => state.effect! }))

function fixture(data = 'red', helper = 'paint', declared = true) {
  const document = createVideoEditTestDocument('作者画面键')
  const version = { id: 'version', apiVersion: 6 as const, languageVersion: 4 as const,
    ...testCodeManifest('export default { name: "键", createWebGPU() {} }', document) }
  for (const [path, source] of [['film/film.ts', data], ['style/paint.ts', helper]]) {
    version.files.push({ ...testCodeManifest(source, document).files[0], path })
  }
  document.codeMaterials = [{ id: 'definition', name: '键', defaultVersionId: version.id, versions: [version] }]
  document.sequences[0].clips = [{ id: 'code', itemId: 'code', name: '键', kind: 'code', track: 1, start: 0, duration: 120,
    sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '',
    code: { definitionId: 'definition', versionId: version.id, parameters: {} } }]
  const effect: AuthorModule = { name: '键', createWebGPU: vi.fn(() => { throw new Error('不能创建 GPU') }),
    dataFiles: ['film/film.ts', 'missing.ts'],
    ...(declared ? { frameKey: (_p, _w, _h, info) => info.time < 1 ? 'opening' : data } satisfies Pick<AuthorModule, 'frameKey'> : {}) }
  return { document, effect }
}
async function frames(data = 'red', helper = 'paint') {
  const { document, effect } = fixture(data, helper)
  state.effect = effect
  const worker = new VideoEditCodeFingerprint(videoEditComposition(document, document.sequences[0].id))
  try { return [await worker.frame('code', 0, {}), await worker.frame('code', 90, {})] }
  finally { await worker.dispose() }
}

it('WebGPU 的声明键跳过录制；数据文件只让变了的时刻失效，画法文件让所有帧失效', async () => {
  const before = await frames()
  expect(before.every(value => value.method === 'frameKey' && value.digest)).toBe(true)
  const dataChanged = await frames('blue')
  expect(dataChanged[0]).toEqual(before[0])
  expect(dataChanged[1].digest).not.toBe(before[1].digest)
  const paintChanged = await frames('red', 'other-paint')
  expect(paintChanged.every((value, index) => value.digest !== before[index].digest)).toBe(true)
})

it('声明键抛错走版本摘要；没有声明键时 dataFiles 不会让原生 GPU 获得可比较键', async () => {
  for (const declared of [true, false]) {
    const { document, effect } = fixture('red', 'paint', declared)
    if (declared) effect.frameKey = () => { throw new Error('bad-key') }
    state.effect = effect
    const worker = new VideoEditCodeFingerprint(videoEditComposition(document, document.sequences[0].id))
    try {
      const value = await worker.frame('code', 0, {})
      expect(value.digest).toBeUndefined()
      expect(value.fallback).toContain(declared ? 'frame-key-error:bad-key' : 'native-gpu')
      expect(effect.createWebGPU).not.toHaveBeenCalled()
    } finally { await worker.dispose() }
  }
})

it('声明键保留网页内容与取帧时间身份，不读取网页布局也不绘制素材图层', async () => {
  const { document, effect } = fixture()
  effect.createWebGPU = undefined
  effect.layers = () => { throw new Error('不能读取素材') }
  effect.params = [{ key: 'screen', type: 'image', title: '画面' }]
  effect.frameKey = () => 'same-picture'
  document.sequences[0].clips[0].code!.parameters.screen = { kind: 'web', path: '/site', width: 320, height: 180, scale: 1 }
  state.effect = effect
  const worker = new VideoEditCodeFingerprint(videoEditComposition(document, document.sequences[0].id))
  try {
    const first = await worker.frame('code', 0, { '/site': 'content-1' })
    expect(first.method).toBe('frameKey')
    expect((await worker.frame('code', 1, { '/site': 'content-1' })).digest).not.toBe(first.digest)
    expect((await worker.frame('code', 0, { '/site': 'content-2' })).digest).not.toBe(first.digest)
    expect((await worker.frame('code', 0, { '/site': 'unknown' })).fallback).toBe('unknown-web-content')
    effect.frameKey = (_p, _w, _h, info) => info.web
    expect((await worker.frame('code', 0, { '/site': 'content-1' })).fallback).toContain('web-layout-required')
  } finally { await worker.dispose() }
})


it('片段准备一次后批量求帧；每帧只调用一次作者键，预算到达立即交回调度', async () => {
  const { document, effect } = fixture()
  const sequence = document.sequences[0]
  effect.layers = () => { throw new Error('不能求值图层') }; effect.createWebGPU = undefined
  const key = vi.fn<Parameters<NonNullable<AuthorModule['frameKey']>>, unknown>((_p, _w, _h, info) => ({ time: info.time }))
  effect.frameKey = key
  state.effect = effect
  const prepare = vi.spyOn(VideoEditCodeSources.prototype, 'prepareGeneratorFrames')
  const worker = new VideoEditCodeFingerprint(videoEditComposition(document, sequence.id))
  try {
    const first = await worker.frames('code', 0, 100, {}, 0)
    expect(first).toHaveLength(1)
    const remaining = await worker.frames('code', 1, 100, {}, 1000)
    expect(remaining).toHaveLength(99)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(key).toHaveBeenCalledTimes(100)
    expect(key.mock.calls[99][3]).toMatchObject({ time: 99 / 30, exposure: { shutter: 180, phase: -90 } })
  } finally { await worker.dispose(); prepare.mockRestore() }
})

it('正式素材指纹不把登记尺寸当解码尺寸，捕获素材可比较，按尺寸求效果则回退', async () => {
  const { document, effect } = fixture()
  document.codeMaterials![0].versions[0].apiVersion = 7
  effect.createWebGPU = undefined
  effect.params = [{ key: 'screen', type: 'image', title: '图片', default: null }]
  document.media = [{ id: 'image', name: '代理画面', kind: 'image', path: '/image.png', width: 1920, height: 1080, durationSeconds: 1 }]
  document.sequences[0].clips[0].code!.parameters.screen = { kind: 'image', mediaId: 'image' }
  effect.frameKey = () => 'same'
  effect.layers = (_p, _w, _h, assets) => {
    const image = assets.screen
    return [{ draw(ctx) { ctx.drawImage(image, 0, 0) } }]
  }
  state.effect = effect
  const worker = new VideoEditCodeFingerprint(videoEditComposition(document, document.sequences[0].id))
  try {
    expect((await worker.frame('code', 0, {})).digest).toBeTruthy()
    effect.layers = (_p, _w, _h, assets) => [{ effects: () => [{ id: 'glow', params: { strength: (assets.screen as ImageBitmap).width / 100 } }], draw() {} }]
    expect((await worker.frame('code', 0, {})).fallback).toContain('decoded-asset-size-required')
  } finally { await worker.dispose() }
})

if (process.env.HENJI_FRAME_KEY_BENCHMARK === '1') it('四个片段各 2.1 万帧：正式片段准备与帧指纹路径（编译/ESM 边界替身，无 IPC/GPU）', async () => {
  const { document, effect } = fixture()
  const sequence = document.sequences[0]
  sequence.clips[0].duration = 21_000
  for (let index = 1; index < 4; index++) sequence.clips.push({ ...sequence.clips[0], id: `code-${index}` })
  effect.createWebGPU = undefined; effect.layers = () => []
  effect.frameKey = (_p, width, height, info) => ({ camera: [Math.sin(info.time), width, height],
    windows: Array.from({ length: 4 }, (_, index) => ({ id: index, x: index * 100 + info.time, title: `窗口${index}`, visible: true })) })
  state.effect = effect
  const worker = new VideoEditCodeFingerprint(videoEditComposition(document, sequence.id)), started = performance.now()
  try {
    for (const clip of sequence.clips) for (let frame = 0; frame < 21_000;) {
      const values = await worker.frames(clip.id, frame, 21_000, {}, 8)
      if (values.some(([, value]) => !value.digest)) throw new Error('声明键失败')
      frame += values.length
    }
    process.stdout.write(JSON.stringify({ clips: 4, framesPerClip: 21_000, elapsedMs: performance.now() - started }) + '\n')
  } finally { await worker.dispose() }
}, 120_000)
