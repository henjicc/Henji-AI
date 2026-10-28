import { recordingCursorFixture } from '@/tests/recordingCursorFixture'
import { testCodeSource, testSetCodeSource } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import { createVideoEditTestDocument as createVideoEditDocument } from '../../../core/videoEdit/testFixtures'
import { describe, expect, it, vi } from 'vitest'
import { testAuthorBundle, testAuthorProgram } from './videoEditAuthorTestFixtures'
import type { CodeAuthorProgram as CodeMaterialProgram, CodeAuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
import { codeMaterialFilesKey, type CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import * as codeComponents from '@/core/videoEdit/codeMaterial/components'
import * as inputHashes from '@/utils/save/hash'
import { codeMaterialImageIds } from '@/core/videoEdit/codeMaterialResources'
import { videoEditComposition, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { VideoEditCodeSources, type PreparedVideoEditCodeEffect } from './videoEditCodeSources'
import type { VideoEditCodeGpu } from './videoEditCodeGpu'
import type { VideoEditCodePicture, VideoEditCodeImageInput } from './videoEditCodeGpu'

import { createVideoEditGraphic } from '@/core/videoEdit/graphics'
import { videoEditTransitionWindow } from '@/core/videoEdit/transitions'
import { createVideoEditMaskShape } from '@/core/videoEdit/effectMasks'
import { codeMediaInputKey } from '@/core/videoEdit/codeMediaInput'
import { videoEditCodeInputs } from '@/core/videoEdit/codeInputParameters'
import { GOLDEN_SCENE_DECLARATION, goldenScene } from '@/core/videoEdit/scene/sceneTestFixtures'

const logWarn = vi.hoisted(() => vi.fn())
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), warn: logWarn }) }))
function source(mode: 'static' | 'dynamic' = 'static', name = '新图形', kind = 'generator'): string {
  return `export default {name:"${name}",kind:"${kind}",mode:"${mode}",width:3840,height:2160,durationSeconds:10,params:[{key:"amount",type:"number",title:"强度",default:.5,min:0,max:1,step:.01}],${kind === 'filter' ? 'createWebGPU(){return {draw(){}};}' : `draw(ctx,t,p){ctx.fillStyle="rgba(255,0,0,.5)";ctx.fillRect(${mode === 'dynamic' ? 't*20+' : ''}p.amount*100,0,200,100);}`}}`
}
function fixture(code = source(), count = 1): VideoEditComposition {
  const document = createVideoEditDocument('代码源生命周期')
  document.codeMaterials = [{ id: 'definition', name: '图形', defaultVersionId: 'v0', versions: Array.from({ length: count }, (_, index) => ({ id: `v${index}`, apiVersion: 4, languageVersion: 4, ...testCodeManifest(count === 1 ? code : source('static', `版本${index}`), document) })) }]
  document.items = [{ id: 'item', name: '代码', kind: 'code', code: { definitionId: 'definition', versionId: 'v0', parameters: {} } }]
  const clip: VideoEditClip = { id: 'clip', itemId: 'item', name: '代码', kind: 'code', code: { definitionId: 'definition', versionId: 'v0', parameters: {} }, track: 1, start: 0, duration: 90, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
  document.sequences[0].clips = [clip]
  return videoEditComposition(document, document.sequences[0].id)
}
function boundaries(document: VideoEditComposition) {
  const pictures = new Map<string, VideoEditCodePicture>()
  const generator = vi.fn(async (key: string, _instance: string, program: CodeMaterialProgram) => {
    let picture = pictures.get(key)
    if (!picture) { picture = { width: program.width, height: program.height } as VideoEditCodePicture; pictures.set(key, picture) }
    return picture
  })
  const releaseUnused = vi.fn((keys: ReadonlySet<string>) => { for (const key of pictures.keys()) if (!keys.has(key)) pictures.delete(key) })
  const runtime = { authorGenerator: generator, inspectAuthor: vi.fn(async (bundle: CodeAuthorBundle) => testAuthorProgram(bundle)), retainAuthorInstances: vi.fn(), observeAuthor: vi.fn(), releaseUnused }
  const acquire = vi.fn(async () => runtime)
  const compiler = { bundle: vi.fn(async (code: string | import('@/core/videoEdit/codeMaterial/sources').CodeMaterialFiles, _signal?: AbortSignal) => testAuthorBundle(code)), dispose: vi.fn() }
  return { sources: new VideoEditCodeSources(document, acquire, compiler), compiler, acquire, generator, releaseUnused, pictures }
}
function changedVersion(document: VideoEditComposition, id: string): VideoEditComposition {
  return { ...document, revision: document.revision + 1, clips: document.clips.map(clip => ({ ...clip, code: { ...clip.code!, versionId: id } })) }
}
const imageInputs = (id: string): Promise<ReadonlyMap<string, VideoEditCodeImageInput>> => Promise.resolve(new Map([[id, { source: {}, width: 100, height: 100 } as VideoEditCodeImageInput]]))
it('回放分辨率的缩小倍数随生成器调用传下并进静态缓存键：切回完整分辨率重新渲染整幅画面', async () => {
  const document = fixture()
  const boundary = boundaries(document)
  const runtime = await boundary.acquire()
  try {
    await boundary.sources.prepare(document, document.clips, 0, () => true)
    expect(boundary.generator.mock.lastCall).toHaveLength(10)
    const fullKey = boundary.generator.mock.lastCall![0]
    Object.assign(runtime, { renderDivisor: 2 })
    await boundary.sources.prepare(document, document.clips, 0, () => true)
    expect(boundary.generator).toHaveBeenCalledTimes(2)
    expect(boundary.generator.mock.lastCall![10 as number]).toBe(2)
    expect(boundary.generator.mock.lastCall![0]).not.toBe(fullKey)
    // 同一倍数下静态画面照常沿用
    await boundary.sources.prepare(document, document.clips, 1, () => true)
    expect(boundary.generator).toHaveBeenCalledTimes(2)
    Object.assign(runtime, { renderDivisor: 1 })
    await boundary.sources.prepare(document, document.clips, 0, () => true)
    expect(boundary.generator).toHaveBeenCalledTimes(3)
    expect(boundary.generator.mock.lastCall).toHaveLength(10)
    expect(boundary.generator.mock.lastCall![0]).toBe(fullKey)
  } finally { await boundary.sources.dispose() }
})

it('片子数据参数（作者接口 v5）：params 拿到解析结果、派生的取帧参数进 inputs.images，同一文档版本各帧共用一个解析结果；超限问题交给呈现通道', async () => {
  const code = `export default {name:"片子",mode:"dynamic",width:64,height:64,durationSeconds:10,params:[{key:"film",type:"scene",title:"片子",schema:${JSON.stringify(GOLDEN_SCENE_DECLARATION)}}],draw(){}}`
  const document = fixture(code)
  document.codeMaterials![0].versions[0].apiVersion = 5
  const mediaId = '089966db-89ab-4cde-8123-0123456789ab'
  document.clips[0].id = '12345678-1234-4abc-8def-123456789abc'
  document.media = [{ id: mediaId, name: '录屏', kind: 'video', path: '/screen.mp4', durationSeconds: 60, width: 1920, height: 1080 }]
  document.items.push({ id: 'screen', name: '录屏', kind: 'video', mediaId })
  document.scenes = [goldenScene(mediaId)]
  document.clips[0].code!.parameters = { film: { kind: 'scene', sceneId: 'golden-scene' } }
  document.clips[0].duration = 300
  const boundary = boundaries(document)
  const lastCall = (): Parameters<VideoEditCodeGpu['authorGenerator']> => boundary.generator.mock.lastCall as unknown as Parameters<VideoEditCodeGpu['authorGenerator']>
  try {
    const instance = document.clips[0].code!
    expect(boundary.sources.declarations(instance)).toBeUndefined()
    await boundary.sources.prepareScenes(document, document.clips)
    const film = videoEditCodeInputs(document, instance, value => boundary.sources.declarations(value))!.scenes.film
    const input = film.timetables[0].shots[0].input, picture = codeMediaInputKey(document.clips[0].id, input)
    expect(picture.length).toBeGreaterThan(100)
    const decoded = new Map(await imageInputs(picture))
    decoded.set(picture, { ...decoded.get(picture)!, texture: {} as VideoEditCodeImageInput['texture'] })
    const first = await boundary.sources.prepare(document, document.clips, 30, () => true, Promise.resolve(decoded))
    const [, , , , params, assets, , , , images = {}] = lastCall()
    expect(params.film).toBe(film)
    // 解析结果在各帧、各片段间共享，交给作者前已冻结
    expect(Object.isFrozen(film.records[0])).toBe(true)
    expect(() => { (film.byId as Map<string, unknown>).set('x', {}) }).toThrow()
    expect(Object.hasOwn(params, input)).toBe(false)
    expect(Object.keys(images)).toEqual([input])
    expect(Object.keys(assets)).toEqual([input])
    expect(assets[input]).toBe(decoded.get(picture)!.source)
    expect(images[input].texture).toBe(decoded.get(picture)!.texture)
    expect(images[input]).toMatchObject({ width: 100, height: 100 })
    expect(first.sceneIssues).toEqual([])
    await boundary.sources.prepare(document, document.clips, 31, () => true, imageInputs(picture))
    expect(lastCall()[4].film).toBe(film)
    await expect(boundary.sources.prepare(document, document.clips, 32, () => true)).rejects.toThrow('没有可绘制的源画面')
    await boundary.sources.prepare(document, document.clips, 33, () => true, imageInputs(picture))
    expect(Object.keys(lastCall()[9]!)).toEqual([input])
    // 新的文档版本：重新解析；一条取帧车道超过上限（保留的段放到 5.12 秒）时，问题只随截断以后的帧交给渲染器呈现
    const shots = Array.from({ length: 600 }, (_, index) => ({ id: `shot-${index}`, kind: 'shot', parent: 'win-demo', values: { at: index * 0.01, media: mediaId, src: index } }))
    const next: VideoEditComposition = { ...document, revision: document.revision + 1, scenes: [{ ...document.scenes[0], records: [...document.scenes[0].records.filter(record => record.kind !== 'shot'), ...shots] }] }
    boundary.sources.updateDocument(next)
    const intact = await boundary.sources.prepare(next, next.clips, 30, () => true, imageInputs(picture))
    expect(lastCall()[4].film).not.toBe(film)
    expect(intact.sceneIssues).toEqual([])
    const overflow = await boundary.sources.prepare(next, next.clips, Math.round(6 * next.fps), () => true)
    expect(overflow.sceneIssues).toHaveLength(1)
    expect(overflow.sceneIssues[0]).toContain(document.scenes[0].name)
  } finally { await boundary.sources.dispose() }
})

it('损坏的画面引用让当前帧明确失败，结构化日志只含参数键摘要与原因', async () => {
  const document = fixture('export default {name:"画面",params:[{key:"picture",type:"image",title:"画面",default:null}],draw(){}}')
  document.clips[0].code!.parameters = { picture: { kind: 'image', mediaId: 'x'.repeat(101) } }
  const boundary = boundaries(document)
  logWarn.mockClear()
  try {
    await expect(boundary.sources.prepare(document, document.clips, 0, () => true)).rejects.toThrow('素材引用无效')
    expect(boundary.generator).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(logWarn).toHaveBeenCalledOnce())
    expect(logWarn.mock.lastCall![1]).toEqual({ event: 'video_edit.code_input.failed', context: { sequenceId: document.id, clipId: document.clips[0].id, frame: 0, parameter: { digest: expect.stringMatching(/^[a-f0-9]{64}$/), length: 7 }, reason: expect.stringContaining('mediaId') } })
    expect(JSON.stringify(logWarn.mock.calls)).not.toContain('x'.repeat(101))
    expect(JSON.stringify(logWarn.mock.calls)).not.toContain('picture')
  } finally { await boundary.sources.dispose() }
})

it('滤镜的损坏画面引用按实例去重，通过问题呈现通道显示且不重复调用效果失败日志', async () => {
  const document = fixture('export default {name:"滤镜",kind:"filter",params:[{key:"picture",type:"image",title:"画面",default:null}],createWebGPU(){return {draw(){}};}}')
  const clip = document.clips[0]
  const effect = { id: 'filter', name: '滤镜', enabled: true, amount: 1, code: { ...clip.code!, parameters: { picture: { kind: 'video' as const, mediaId: 'screen', time: -1 } } } }
  document.clips = [{ ...clip, kind: 'video', code: undefined, effects: [effect] }]
  const boundary = boundaries(document), onEffectError = vi.fn()
  logWarn.mockClear()
  try {
    for (const frame of [0, 1, 2]) {
      const prepared = await boundary.sources.prepare(document, document.clips, frame, () => true, undefined, { onEffectError })
      expect(prepared.sceneIssues).toEqual([expect.stringContaining('素材引用无效')])
    }
    expect(onEffectError).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(logWarn).toHaveBeenCalledOnce())
    expect(logWarn.mock.lastCall![1].context).toMatchObject({ sequenceId: document.id, clipId: clip.id, effectId: effect.id, frame: 0, reason: expect.stringContaining('.time') })
    expect(boundary.generator).not.toHaveBeenCalled()
  } finally { await boundary.sources.dispose() }
})

it('引用失败按片段与参数去重，原因变化或恢复后允许重新记录；摘要不阻塞旧帧清理', async () => {
  const document = fixture('export default {name:"画面",params:[{key:"picture",type:"image",title:"画面",default:null}],draw(){}}')
  const invalid = { kind: 'image' as const, mediaId: 'x'.repeat(101) }
  document.clips[0].code!.parameters = { picture: invalid }
  const boundary = boundaries(document), digests: Array<(digest: string) => void> = []
  const hash = vi.spyOn(inputHashes, 'sha256HexString').mockImplementation(() => new Promise(resolve => digests.push(resolve)))
  logWarn.mockClear()
  try {
    for (const frame of [0, 1, 2]) await expect(boundary.sources.prepare(document, document.clips, frame, () => true, Promise.resolve(new Map()))).rejects.toThrow('素材引用无效')
    expect(hash).toHaveBeenCalledOnce()
    expect(logWarn).not.toHaveBeenCalled()
    expect(boundary.releaseUnused.mock.lastCall![0].size).toBe(0)
    const prepareValue = async (picture: import('@/core/videoEdit/codeMaterial/contract').CodeParameterValue, frame: number, clipId = document.clips[0].id): Promise<void> => {
      const next = { ...document, clips: [{ ...document.clips[0], id: clipId, code: { ...document.clips[0].code!, parameters: { picture } } }] }
      boundary.sources.updateParameters(next)
      await boundary.sources.prepare(next, next.clips, frame, () => true)
    }
    await expect(prepareValue({ kind: 'video', mediaId: 'screen', time: -1 }, 3)).rejects.toThrow('素材引用无效')
    expect(hash).toHaveBeenCalledTimes(2)
    await prepareValue(null, 4)
    expect(boundary.pictures.size).toBe(1)
    digests[0]('a'.repeat(64)); digests[1]('b'.repeat(64))
    await vi.waitFor(() => expect(logWarn).toHaveBeenCalledTimes(2))
    expect(boundary.pictures.size).toBe(1)
    await expect(prepareValue(invalid, 5)).rejects.toThrow('素材引用无效')
    await expect(prepareValue(invalid, 6, 'another-clip')).rejects.toThrow('素材引用无效')
    expect(hash).toHaveBeenCalledTimes(4)
    digests[2]('c'.repeat(64)); digests[3]('d'.repeat(64))
    await vi.waitFor(() => expect(logWarn).toHaveBeenCalledTimes(4))
    expect(logWarn.mock.calls.map(call => call[1].context.frame)).toEqual([0, 3, 5, 6])
    expect(logWarn.mock.lastCall![1].context.clipId).toBe('another-clip')
  } finally { digests.forEach(resolve => resolve('f'.repeat(64))); hash.mockRestore(); await boundary.sources.dispose() }
})

it('自定义结构含 kind 和 mediaId 字段也不决定媒体语义，不读素材且仍使用静态缓存', async () => {
  const code = 'export default {name:"自定义",mode:"static",types:{content:{title:"内容",layout:"row",fields:{kind:{type:"text",title:"类别",maxLength:40,default:"image"},mediaId:{type:"text",title:"标识",maxLength:100,default:"missing-screen"}}}},params:[{key:"content",type:"content",title:"内容",default:{}}],draw(){}}'
  const document = fixture(code), boundary = boundaries(document)
  const lastCall = (): Parameters<VideoEditCodeGpu['authorGenerator']> => boundary.generator.mock.lastCall as unknown as Parameters<VideoEditCodeGpu['authorGenerator']>
  logWarn.mockClear()
  try {
    for (const kind of ['image', 'video', 'sequence']) {
      const next = { ...document, clips: [{ ...document.clips[0], code: { ...document.clips[0].code!, parameters: { content: { kind, mediaId: 'missing-screen' } } } }] }
      boundary.sources.updateParameters(next)
      await boundary.sources.prepare(next, next.clips, 0, () => true)
      expect(lastCall()[4].content).toEqual({ kind, mediaId: 'missing-screen' })
      expect(lastCall()[5]).toEqual({})
      expect(lastCall()[9]).toEqual({})
      const declarations = boundary.sources.declarations(next.clips[0].code!)!
      expect(codeMaterialImageIds(next.clips[0].code, declarations)).toEqual(new Set())
      expect(codeMaterialImageIds(next.clips[0].code, declarations, { 'scene-input:test': { kind: 'image', mediaId: 'screen' } })).toEqual(new Set(['screen']))
      expect((await boundary.sources.prepare(next, next.clips, 1, () => true)).cacheHits).toBe(1)
    }
    expect(logWarn).not.toHaveBeenCalled()
  } finally { await boundary.sources.dispose() }
})

it('分层作者收到正式源时钟、参数和片段局部信息，动态曝光不误用静态缓存', async () => {
  const code = 'export default {name:"参数运动",width:64,height:64,durationSeconds:3,params:[{key:"amount",type:"number",title:"位置",default:0,min:0,max:100,step:1,animatable:true}],motionBlur:{},layers(p){return [{id:"box",bounds:[0,0,8,8],pose:t=>({x:p.amount+t}),draw(ctx){ctx.fillRect(0,0,8,8);}}];}}'
  const document = fixture(code)
  document.clips[0].code!.curves = { amount: [{ id: 'a', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: 0, interpolation: 'linear' }, { id: 'b', sourceInUs: 1_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, value: 100, interpolation: 'linear' }] }
  const boundary = boundaries(document)
  try {
    await boundary.sources.prepare(document, document.clips, 15, () => true)
    await boundary.sources.prepare(document, document.clips, 15, () => true)
    expect(boundary.generator).toHaveBeenCalledTimes(2)
    const options = boundary.generator.mock.calls[0] as unknown as Parameters<VideoEditCodeGpu['authorGenerator']>
    expect(options[3]).toMatchObject({ time: .5, frame: 15, localTime: .5 })
    expect(options[4]).toEqual({ amount: 50 })
    expect(options[6]).toMatchObject({ time: .5, frameDuration: 1 / 30, clip: { time: .5, duration: 3 } })
  } finally { await boundary.sources.dispose() }
})

it('t102 静态声明读取音频元数据仍随来源更新，视频参数按片段改写为当前帧输入', async () => {
  const code = 'export default {name:"音频",mode:"static",width:3840,height:2160,durationSeconds:3,params:[{key:"picture",type:"image",title:"画面",default:null},{key:"sound",type:"audio",title:"声音",default:null}],draw(ctx,t,p,w,h,assets,info){ctx.fillRect(info.audio.bpm,0,10,10);}}'
  const document = fixture(code)
  document.codeMaterials![0].versions[0].languageVersion = 4
  document.media.push({ id: 'video', name: '视频', path: 'D:/movie.mp4', kind: 'video', width: 64, height: 64, durationSeconds: 3 })
  const boundary = boundaries(document), audio = { fps: 30, duration: 3, bpm: 120, beats: [0, .5], onsets: [0, .5], beatsPerBar: 4, barOrigin: 0, levels: [], bands: { bass: [], mid: [], treble: [] } }
  const options = { audio: vi.fn(async () => ({ audio, audioTime: .5 })) }
  try {
    await boundary.sources.prepare(document, document.clips, 0, () => true, undefined, options)
    await boundary.sources.prepare(document, document.clips, 15, () => true, undefined, options)
    expect(boundary.generator).toHaveBeenCalledTimes(2)
    const next = { ...document, clips: document.clips.map(clip => ({ ...clip, code: { ...clip.code!, parameters: { picture: { kind: 'video' as const, mediaId: 'video' } } } })) }
    boundary.sources.updateParameters(next)
    await boundary.sources.prepare(next, next.clips, 15, () => true, imageInputs('code-input:["clip","picture"]'), options)
    expect(boundary.generator).toHaveBeenLastCalledWith(expect.any(String), 'clip', expect.anything(), expect.objectContaining({ audio, audioTime: .5 }), expect.objectContaining({ picture: { kind: 'image', mediaId: 'code-input:["clip","picture"]' } }), expect.any(Object), expect.objectContaining({ audio, audioTime: .5 }), undefined, true, { picture: { texture: undefined, width: 100, height: 100 } })
    // 位图只在作者读 assets 时才取，GPU 入口直接用 images 里的纹理。
    const assets = (boundary.generator.mock.lastCall as unknown as unknown[])[5] as Record<string, unknown>
    expect(Object.keys(assets)).toEqual(['picture'])
    expect(assets.picture).toEqual({})
  } finally { await boundary.sources.dispose() }
})

it('static code picture cache does not freeze its native animated effect mask', async () => {
  const document = fixture(); const shape = { ...createVideoEditMaskShape('rect', 'mask'), feather: 0 }
  document.clips[0].effects = [{ id: 'blur', name: '模糊', enabled: true, amount: 1, builtin: { id: 'gaussian_blur', params: {} }, mask: { regionId: 'shapes', shapes: [{ ...shape, pathAnimation: { pointIds: ['a', 'b', 'c', 'd'], keys: [
    { sourceTimeUs: 0, points: shape.points, interpolation: 'linear' },
    { sourceTimeUs: 1e6, points: shape.points.map(p => [p[0] + .2, ...p.slice(1)] as typeof p), interpolation: 'linear' },
  ] } }] } }]
  const boundary = boundaries(document)
  try {
    const first = (await boundary.sources.prepare(document, document.clips, 0, () => true)).effects.get('clip')![0]
    const last = (await boundary.sources.prepare(document, document.clips, 30, () => true)).effects.get('clip')![0]
    if (!first.builtin || !last.builtin) throw new Error('缺少内置效果')
    const pixel = Math.floor(first.mask!.height * .5) * first.mask!.width + Math.floor(first.mask!.width * .35)
    expect(first.mask!.data[pixel]).toBe(255)
    expect(last.mask!.data[pixel]).toBe(0)
    expect(boundary.generator).toHaveBeenCalledTimes(1)
  } finally { await boundary.sources.dispose() }
})

describe('可见代码源与固定内容复用', () => {
  it('静态v3生成器覆盖动画使用源时间，缓存按求值结果复用，覆盖修改后不复用旧画面', async () => {
    const document = fixture(source().replace('apiVersion:1,', 'apiVersion:1,languageVersion:3,').replace('rect({x:', 'rect({id:"box",x:'))
    document.codeMaterials![0].versions[0].languageVersion = 4
    const time = (sourceInUs: number) => ({ sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 } })
    document.clips[0].elementOverrides = { box: { curves: { dx: [{ id: 'first', ...time(0), value: 0, interpolation: 'linear' }, { id: 'last', ...time(1e6), value: 100, interpolation: 'linear' }] } } }
    const boundary = boundaries(document)
    try {
      await boundary.sources.prepare(document, document.clips, 0, () => true)
      await boundary.sources.prepare(document, document.clips, 15, () => true)
      expect(boundary.generator).toHaveBeenCalledTimes(2)
      expect(boundary.generator.mock.calls[0][0]).not.toBe(boundary.generator.mock.calls[1][0])
      expect((boundary.generator.mock.calls[1] as unknown[])[7]).toEqual({ box: { dx: 50 } })
      await boundary.sources.prepare(document, document.clips, 15, () => true); expect(boundary.generator).toHaveBeenCalledTimes(2)
      const next = { ...document, clips: [{ ...document.clips[0], elementOverrides: { box: { dx: 100 } } }] }
      boundary.sources.updateDocument(next); await boundary.sources.prepare(next, next.clips, 15, () => true); expect(boundary.generator).toHaveBeenCalledTimes(3)
    } finally { await boundary.sources.dispose() }
  })
  it('滤镜编译失败可跳过并报告，保留后续内置效果；未声明兜底的检查路径仍失败', async () => {
    const document = fixture(source('static', '坏滤镜', 'filter'))
    document.clips = [{ ...document.clips[0], kind: 'image', code: undefined, effects: [
      { id: 'bad', name: '坏滤镜', enabled: true, amount: 1, code: { definitionId: 'definition', versionId: 'v0', parameters: {} } },
      { id: 'good', name: '锐化', enabled: true, amount: 1, builtin: { id: 'sharpen', params: {} } },
    ] }]
    const boundary = boundaries(document)
    boundary.compiler.bundle.mockRejectedValue(new Error('编译失败'))
    const failures = vi.fn()
    try {
      const prepared = await boundary.sources.prepare(document, document.clips, 0, () => true, undefined, { onEffectError: failures })
      expect(prepared.effects.get(document.clips[0].id)?.map(plan => plan.effect.id)).toEqual(['good'])
      expect(failures).toHaveBeenCalledWith(document.clips[0].effects![0], expect.any(Error))
      await expect(boundary.sources.prepare(document, document.clips, 0, () => true)).rejects.toThrow('编译失败')
    } finally { await boundary.sources.dispose() }
  })
  it('40份不同代码滤镜同帧保留，下一帧不重新编译，缩短链后闲置缓存回落', async () => {
    const document = fixture(source(), 40)
    document.codeMaterials![0].versions.forEach((version, index) => { testSetCodeSource(document, version, source('static', `滤镜${index}`, 'filter')); })
    document.clips = [{ ...document.clips[0], kind: 'image', code: undefined,
      effects: Array.from({ length: 40 }, (_, index) => ({ id: `fx-${index}`, name: '效果', enabled: true, amount: 1, code: { definitionId: 'definition', versionId: `v${index}`, parameters: {} } })) }]
    const boundary = boundaries(document)
    try {
      for (const frame of [0, 1]) {
        const prepared = await boundary.sources.prepare(document, document.clips, frame, () => true)
        expect(prepared.effects.get('clip')).toHaveLength(40)
      }
      expect(boundary.compiler.bundle).toHaveBeenCalledTimes(40)
      expect(boundary.sources.diagnostics().programs).toBe(40)
      const next = { ...document, clips: [{ ...document.clips[0], effects: document.clips[0].effects!.slice(0, 1) }], codeMaterials: [{ ...document.codeMaterials![0], versions: [...document.codeMaterials![0].versions, { id: 'new', apiVersion: 4 as const, languageVersion: 4 as const, ...testCodeManifest(source('static', '新滤镜', 'filter'), document) }] }] }
      next.clips[0].effects.push({ id: 'new', name: '效果', enabled: true, amount: 1, code: { definitionId: 'definition', versionId: 'new', parameters: {} } })
      boundary.sources.updateDocument(next)
      await boundary.sources.prepare(next, next.clips, 2, () => true)
      expect(boundary.sources.diagnostics().programs).toBe(32)
    } finally { await boundary.sources.dispose() }
  })
  it('全透明调整层不准备四项效果，九层原范围继续透传且零GPU资源', async () => {
    const document = fixture(source(), 36)
    document.codeMaterials![0].versions.forEach((version, index) => { testSetCodeSource(document, version, source('static', `调整滤镜${index}`, 'filter')); })
    document.clips = Array.from({ length: 9 }, (_, index) => ({ ...document.clips[0], id: `adjustment-${index}`, kind: 'adjustment' as const, code: undefined, track: index + 1, volume: 0, opacity: 0, adjustment: { fromTrack: 0 },
      effects: Array.from({ length: 4 }, (_, effect) => ({ id: `fx-${index}-${effect}`, name: '效果', enabled: true, amount: 1, code: { definitionId: 'definition', versionId: `v${index * 4 + effect}`, parameters: {} } })) }))
    const boundary = boundaries(document)
    try {
      const prepared = await boundary.sources.prepare(document, document.clips, 0, () => true)
      expect(prepared.effects.size).toBe(0); expect(boundary.compiler.bundle).not.toHaveBeenCalled(); expect(boundary.acquire).not.toHaveBeenCalled()
    } finally { await boundary.sources.dispose() }
  })
  it('静态滤镜参数曲线在一小时源入点继续按真实源时钟求值', async () => {
    const document = fixture(source('static', '长原素材效果', 'filter').replace('default:.5,min:0,max:1,step:.01', 'default:.5,min:0,max:1,step:.01,animatable:true'))
    const code = { ...document.clips[0].code!, curves: { amount: [
      { id: 'start', sourceInUs: 3_600_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, value: 0, interpolation: 'linear' as const },
      { id: 'end', sourceInUs: 3_601_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, value: 1, interpolation: 'linear' as const },
    ] } }
    document.clips = [{ ...document.clips[0], kind: 'image', code: undefined, sourceInUs: 3_600_000_000, effects: [{ id: 'fx', name: '效果', enabled: true, amount: 1, code }] }]
    const boundary = boundaries(document)
    try {
      const prepared = await boundary.sources.prepare(document, document.clips, 15, () => true)
      expect(prepared.effects.get('clip')![0]).toMatchObject({ context: { time: 3600.5, localTime: .5 }, parameters: { amount: .5 } })
    } finally { await boundary.sources.dispose() }
  })
  it('32轨关闭或零强度效果不编译、占用程序预算或建立GPU上下文', async () => {
    const document = fixture(source('static', '滤镜', 'filter'), 36)
    document.codeMaterials![0].versions.forEach((version, index) => { testSetCodeSource(document, version, source('static', `滤镜${index}`, 'filter')); })
    document.clips = Array.from({ length: 32 }, (_, index) => ({ ...document.clips[0], id: `clip-${index}`, kind: 'image' as const, code: undefined, track: index,
      effects: [{ id: `effect-${index}`, name: `效果${index}`, enabled: index % 2 === 0, amount: index % 2 === 0 ? 0 : 1, code: { definitionId: 'definition', versionId: `v${index}`, parameters: {} } }] }))
    const boundary = boundaries(document)
    try {
      const prepared = await boundary.sources.prepare(document, document.clips, 0, () => true)
      expect(prepared.effects.size).toBe(0); expect(boundary.compiler.bundle).not.toHaveBeenCalled(); expect(boundary.acquire).not.toHaveBeenCalled()
      expect(boundary.sources.diagnostics().programs).toBe(0)
    } finally { await boundary.sources.dispose() }
  })
  it('结构化图形静态共享与源时钟曲线复用原GPU，不创建compiler，统一保护合成目标', async () => {
    let document = fixture(); const original = document.clips[0]
    const graphic = createVideoEditGraphic('rect', 3840, 2160)
    document = { ...document, clips: [{ ...original, kind: 'graphic', code: undefined, graphic }] }
    const pictures = new Map<string, VideoEditCodePicture>()
    const draw = vi.fn(async (key: string, width: number, height: number) => { const picture = { width, height } as VideoEditCodePicture; pictures.set(key, picture); return picture })
    const releaseUnused = vi.fn((keys: ReadonlySet<string>) => { for (const key of pictures.keys()) if (!keys.has(key)) pictures.delete(key) })
    const compiler = { bundle: vi.fn(async (text: CodeMaterialFiles) => testAuthorBundle(text)), dispose: vi.fn() }
    const sources = new VideoEditCodeSources(document, async () => ({ authorGenerator: vi.fn(), inspectAuthor: vi.fn(), retainAuthorInstances: vi.fn(), observeAuthor: vi.fn(), draw, releaseUnused }), compiler)
    try {
      const reserved = new Set(['composite:clip:clip:0', 'composite:clip:clip:1', 'composite:clip:clip:2'])
      const first = await sources.prepare(document, document.clips, 0, () => true, undefined, { surfaceKeys: reserved })
      const moved = { ...document, clips: [{ ...document.clips[0], x: .5 }] }; sources.updateDocument(moved); document = moved
      const second = await sources.prepare(document, document.clips, 30, () => true, undefined, { surfaceKeys: reserved })
      expect(second.pictures.get('clip')).toBe(first.pictures.get('clip')); expect(second.cacheHits).toBe(1)
      expect(draw).toHaveBeenCalledOnce(); expect(compiler.bundle).not.toHaveBeenCalled()
      expect([...releaseUnused.mock.lastCall![0]]).toEqual(expect.arrayContaining([...reserved]))
      const animated = structuredClone(graphic)
      animated.objects[0].curves = { x: [{ id: 'p0', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: 0, interpolation: 'linear' }, { id: 'p1', sourceInUs: 1_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, value: 300, interpolation: 'linear' }] }
      document = { ...document, clips: [{ ...document.clips[0], graphic: animated }] }; sources.updateDocument(document)
      await sources.prepare(document, document.clips, 15, () => true)
      const command = (draw.mock.lastCall as unknown as [string, number, number, Array<{ command: { x: number } }>])[3][0].command
      expect(command.x).toBe(150); expect(pictures.size).toBe(1)
    } finally { await sources.dispose() }
    expect(pictures.size).toBe(0); expect(compiler.dispose).toHaveBeenCalledOnce()
  })
  it('滤镜与生成器共用固定program缓存，转场保留原局部时钟、真实源参数及同帧保留键', async () => {
    const document = fixture(source('dynamic'))
    const filter = source('static', '附加滤镜', 'filter')
    document.codeMaterials!.push({ id: 'filter', name: '滤镜', defaultVersionId: 'fv', versions: [{ id: 'fv', apiVersion: 4, languageVersion: 4, ...testCodeManifest(filter, document) }] })
    const base = document.clips[0]
    document.clips = [{ ...base, start: 0, duration: 60, sourceInUs: 1_000_000 }, { ...structuredClone(base), id: 'right', start: 60, duration: 60, sourceInUs: 1_000_000 }]
    document.clips[1].effects = [{ id: 'effect', name: '滤镜', enabled: true, amount: .5, code: { definitionId: 'filter', versionId: 'fv', parameters: { amount: .8 } } }]
    const window = videoEditTransitionWindow(document, { id: 'transition', kind: 'cross_dissolve', leftClipId: base.id, rightClipId: 'right', durationFrames: 10 })
    const boundary = boundaries(document)
    try {
      const first = await boundary.sources.prepare(document, document.clips, 55, () => true, undefined, { transitions: [window], surfaceKeys: new Set(['composite:transition:transition']) })
      expect(first.effects.get('right')![0]).toMatchObject({ effect: { id: 'effect' }, parameters: { amount: .8 }, transitionHandles: true, context: { localTime: -5 / 30, time: 1 - 5 / 30, frame: 55 } })
      expect(boundary.compiler.bundle).toHaveBeenCalledTimes(2)
      const effects = first.effects.get('right')![0] as PreparedVideoEditCodeEffect
      expect(Object.isFrozen(effects.program)).toBe(true)
      expect([...boundary.releaseUnused.mock.lastCall![0]]).toContain('composite:transition:transition')
      const second = await boundary.sources.prepare(document, document.clips, 60, () => true, undefined, { transitions: [window] })
      expect((second.effects.get('right')![0] as PreparedVideoEditCodeEffect).context.localTime).toBe(0)
      expect((second.effects.get('right')![0] as PreparedVideoEditCodeEffect).program).toBe(effects.program)
      expect(boundary.compiler.bundle).toHaveBeenCalledTimes(2)
    } finally { await boundary.sources.dispose() }
  })
  it('附加滤镜迟到编译在关闭后不能获取GPU或发布效果', async () => {
    const document = fixture(); document.clips[0].kind = 'text'; delete document.clips[0].code
    testSetCodeSource(document, document.codeMaterials![0].versions[0], source('static', '滤镜', 'filter'))
    document.clips[0].effects = [{ id: 'effect', name: '效果', enabled: true, amount: 1, code: { definitionId: 'definition', versionId: 'v0', parameters: {} } }]
    const boundary = boundaries(document); let finish!: (program: CodeAuthorBundle) => void
    boundary.compiler.bundle.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = boundary.sources.prepare(document, document.clips, 0, () => true)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function')); await boundary.sources.dispose(); finish(testAuthorBundle(testCodeSource(document, document.codeMaterials![0].versions[0]))); await rejected
    expect(boundary.acquire).not.toHaveBeenCalled(); expect(boundary.generator).not.toHaveBeenCalled()
    expect(boundary.sources.diagnostics()).toMatchObject({ programs: 0, staticPictures: 0 })
  })
  it('静态按版本和规范参数共享目标，帧/变换/普通revision变化不重编译或求值', async () => {
    let document = fixture(); const boundary = boundaries(document)
    try {
      const first = await boundary.sources.prepare(document, document.clips, 0, () => true)
      const picture = first.pictures.get('clip')
      const program = boundary.generator.mock.calls[0][2]
      expect(Object.isFrozen(program)).toBe(true); expect(Object.isFrozen(program.bundle)).toBe(true)
      const copy = { ...document.clips[0], id: 'copy', x: .4, code: { ...document.clips[0].code!, parameters: { amount: .5 } } }
      document = { ...document, revision: 7, clips: [{ ...document.clips[0], rotation: 30, opacity: .4 }, copy] }
      boundary.sources.updateDocument(document)
      const second = await boundary.sources.prepare(document, document.clips, 60, () => true)
      expect(second.pictures.get('clip')).toBe(picture); expect(second.pictures.get('copy')).toBe(picture)
      expect(second.cacheHits).toBe(2); expect(boundary.compiler.bundle).toHaveBeenCalledOnce(); expect(boundary.generator).toHaveBeenCalledOnce()
      expect(boundary.releaseUnused.mock.calls.at(-1)![0].size).toBe(1)
      document = { ...document, clips: [{ ...document.clips[0], code: { ...document.clips[0].code!, parameters: { amount: .8 } } }] }
      boundary.sources.updateDocument(document); await boundary.sources.prepare(document, document.clips, 10, () => true)
      expect(boundary.generator).toHaveBeenCalledTimes(2); expect(boundary.generator.mock.calls[1][2]).toBe(program)
      expect(boundary.pictures.size).toBe(1)
    } finally { await boundary.sources.dispose() }
  })
  it('动态使用统一连续源时钟，乱序帧复用program与目标而每次求值', async () => {
    const document = fixture(source('dynamic')); document.frameRate = { numerator: 30000, denominator: 1001 }; document.fps = 30000 / 1001
    document.clips[0] = { ...document.clips[0], sourceInUs: 123456, sourceRemainder: { numerator: 1, denominator: 3 } }
    const boundary = boundaries(document)
    try {
      const times: number[] = []
      for (const frame of [60, 0, 30, 60]) times.push((await boundary.sources.prepare(document, document.clips, frame, () => true)).sourceTimestamps[0])
      expect(times[0]).toBe(times[3]); expect(times[1]).toBeCloseTo(.123456 + 1 / 3e6)
      expect(boundary.compiler.bundle).toHaveBeenCalledOnce(); expect(boundary.generator).toHaveBeenCalledTimes(4)
      expect(new Set(boundary.generator.mock.calls.map(call => call[0])).size).toBe(1)
      expect(new Set(boundary.generator.mock.calls.map(call => call[1])).size).toBe(1)
    } finally { await boundary.sources.dispose() }
  })
  it('不可见版本不编译，离开所有代码片段释放目标，滤镜拒绝生成入口', async () => {
    const document = fixture(); document.codeMaterials![0].versions.push({ id: 'invalid-hidden', apiVersion: 4, languageVersion: 4, ...testCodeManifest('never execute this', document) })
    const boundary = boundaries(document)
    try {
      await boundary.sources.prepare(document, [], 0, () => true); expect(boundary.acquire).not.toHaveBeenCalled(); expect(boundary.compiler.bundle).not.toHaveBeenCalled()
      await boundary.sources.prepare(document, document.clips, 0, () => true)
      await boundary.sources.prepare(document, [], 90, () => true)
      expect(boundary.pictures.size).toBe(0); expect(boundary.sources.diagnostics().staticPictures).toBe(0)
      const filter = { ...document, codeMaterials: [{ ...document.codeMaterials![0], versions: [...document.codeMaterials![0].versions, { id: 'filter', apiVersion: 4 as const, languageVersion: 4 as const, ...testCodeManifest(source('dynamic', '滤镜', 'filter'), document) }] }] }
      boundary.sources.updateDocument(filter)
      await expect(boundary.sources.prepare(filter, changedVersion(filter, 'filter').clips, 0, () => true)).rejects.toThrow('单输入滤镜')
      expect(boundary.generator).toHaveBeenCalledOnce()
    } finally { await boundary.sources.dispose() }
  })
  it('编译失败不替换旧静态目标，恢复旧有效版本不重求值', async () => {
    const document = fixture(); document.codeMaterials![0].versions.push({ id: 'bad', apiVersion: 4, languageVersion: 4, ...testCodeManifest('invalid', document) })
    const boundary = boundaries(document)
    try {
      const old = (await boundary.sources.prepare(document, document.clips, 0, () => true)).pictures.get('clip')
      const bad = changedVersion(document, 'bad'); boundary.sources.updateDocument(bad)
      await expect(boundary.sources.prepare(bad, bad.clips, 0, () => true)).rejects.toThrow()
      boundary.sources.updateDocument(document)
      expect((await boundary.sources.prepare(document, document.clips, 0, () => true)).pictures.get('clip')).toBe(old)
      expect(boundary.generator).toHaveBeenCalledOnce()
    } finally { await boundary.sources.dispose() }
  })
})

describe('按代码版本记录编译', () => {
  it('作者接口版本与内置库版本跟着版本记录进编译输入；v4 且没有库记录的版本缓存键不变', async () => {
    const document = fixture()
    const v4 = document.codeMaterials![0].versions[0]
    document.codeMaterials![0].versions.push({ ...v4, id: 'v5', apiVersion: 5, libraries: { three: '0.186.1' } })
    const boundary = boundaries(document)
    try {
      await boundary.sources.prepare(document, document.clips, 0, () => true)
      const old = boundary.compiler.bundle.mock.calls[0][0] as CodeMaterialFiles
      expect(old).toMatchObject({ apiVersion: 4 }); expect(old).not.toHaveProperty('libraries')
      const { apiVersion: _apiVersion, ...withoutApi } = old
      expect(codeMaterialFilesKey(old)).toBe(codeMaterialFilesKey(withoutApi))
      const next = changedVersion(document, 'v5'); boundary.sources.updateDocument(next)
      await boundary.sources.prepare(next, next.clips, 0, () => true)
      const pinned = boundary.compiler.bundle.mock.calls[1][0] as CodeMaterialFiles
      expect(pinned).toMatchObject({ apiVersion: 5, libraries: { three: '0.186.1' } })
      expect(codeMaterialFilesKey(pinned)).not.toBe(codeMaterialFilesKey(old))
      expect(boundary.generator.mock.lastCall![2]).toMatchObject({ apiVersion: 5 })
    } finally { await boundary.sources.dispose() }
  })
})

describe('失效、身份与资源上限', () => {
  it('动态作者热播放不重复解析库源码，换固定版本才重新准备模块', async () => {
    const expand = vi.spyOn(codeComponents, 'expandPinnedCodeComponents')
    const document = fixture(source('dynamic'))
    const boundary = boundaries(document)
    try {
      await boundary.sources.prepare(document, document.clips, 0, () => true)
      const initialCalls = expand.mock.calls.length
      expect(initialCalls).toBeGreaterThan(0)
      for (let frame = 1; frame < 4; frame++) await boundary.sources.prepare(document, document.clips, frame, () => true)
      expect(expand).toHaveBeenCalledTimes(initialCalls)
      expect(boundary.generator).toHaveBeenCalledTimes(4)
      const next = structuredClone(document)
      next.codeMaterials![0].versions.push({ id: 'v1', apiVersion: 4, languageVersion: 4, ...testCodeManifest(source('dynamic', '新版本'), next) })
      next.clips[0].code!.versionId = 'v1'
      boundary.sources.updateDocument(next)
      await boundary.sources.prepare(next, next.clips, 4, () => true)
      expect(expand.mock.calls.length).toBeGreaterThan(initialCalls)
      expect(boundary.compiler.bundle).toHaveBeenCalledTimes(2)
    } finally { expand.mockRestore(); await boundary.sources.dispose() }
  })
  it('作者模块缓存逐出后可重新加载，仍拒绝固定版本改写', async () => {
    let document = fixture(source(), 33)
    const boundary = boundaries(document)
    try {
      await boundary.sources.prepare(document, document.clips, 0, () => true)
      const before = boundary.generator.mock.calls[0][2]
      for (let index = 1; index < 33; index++) {
        document = changedVersion(document, `v${index}`); boundary.sources.updateDocument(document)
        await boundary.sources.prepare(document, document.clips, 0, () => true)
      }
      expect(boundary.sources.diagnostics()).toMatchObject({ programs: 32, seenVersions: 33 })
      document = changedVersion(document, 'v0'); boundary.sources.updateDocument(document)
      await boundary.sources.prepare(document, document.clips, 0, () => true)
      expect(boundary.generator.mock.lastCall![2]).not.toBe(before)
      expect(boundary.compiler.bundle).toHaveBeenCalledTimes(34)
      const changed = { ...document, codeMaterials: document.codeMaterials!.map(definition => ({ ...definition, versions: definition.versions.map(version => ({ ...version, ...testCodeManifest(source('static', '冒用'), document) })) })) }
      expect(() => boundary.sources.updateDocument(changed)).toThrow('不可变代码版本')
    } finally { await boundary.sources.dispose() }
    expect(boundary.sources.diagnostics()).toMatchObject({ programs: 0, staticPictures: 0, seenVersions: 0 })
  })
  it('图片准备失败或取消同步回收静态索引，恢复原参数不命中已销毁目标', async () => {
    for (const failure of ['reject', 'cancel'] as const) {
      const document = fixture(); const boundary = boundaries(document)
      try {
        const first = await boundary.sources.prepare(document, document.clips, 0, () => true)
        const next = { ...document, revision: 1, clips: document.clips.map(clip => ({ ...clip, code: { ...clip.code!, parameters: { amount: .8 } } })) }
        boundary.sources.updateDocument(next)
        let reject!: (reason: Error) => void
        const images = new Promise<undefined>((_resolve, fail) => { reject = fail })
        const pending = boundary.sources.prepare(next, next.clips, 0, () => true, images)
        const refused = expect(pending).rejects.toThrow()
        await vi.waitFor(() => expect(boundary.sources.diagnostics().staticPictures).toBe(1))
        if (failure === 'cancel') boundary.sources.cancel()
        reject(new Error('图片读取失败')); await refused
        expect(boundary.sources.diagnostics().staticPictures).toBe(0); expect(boundary.pictures.size).toBe(0)
        boundary.sources.updateDocument(document)
        const restored = await boundary.sources.prepare(document, document.clips, 0, () => true)
        expect(restored.cacheHits).toBe(0); expect(restored.pictures.get('clip')).not.toBe(first.pictures.get('clip'))
        expect(boundary.generator).toHaveBeenCalledTimes(2)
      } finally { await boundary.sources.dispose() }
    }
  })
  it('同路径显式资源刷新只失效静态图片结果，标量外的版本变换复用源码', async () => {
    const code = 'export default {name:"图片",mode:"static",width:3840,height:2160,durationSeconds:10,params:[{key:"logo",type:"image",title:"徽标",default:null}],draw(ctx,t,p,w,h,assets){if(assets.logo)ctx.drawImage(assets.logo,0,0,100,100);}}'
    const document = fixture(code)
    document.codeMaterials![0].versions[0].languageVersion = 4
    document.media = [{ id: 'image', path: 'D:/original.png', name: '原图', kind: 'image', width: 100, height: 100, durationSeconds: 0 }]
    document.clips[0].code!.parameters = { logo: { kind: 'image', mediaId: 'image' } }
    const boundary = boundaries(document)
    try {
      const first = await boundary.sources.prepare(document, document.clips, 0, () => true, imageInputs('image'))
      const transformed = { ...document, revision: 1, clips: document.clips.map(clip => ({ ...clip, scale: 2 })) }
      boundary.sources.updateDocument(transformed); expect((await boundary.sources.prepare(transformed, transformed.clips, 1, () => true, imageInputs('image'))).cacheHits).toBe(1)
      const refreshed = { ...transformed, revision: 2, media: transformed.media.map(media => ({ ...media, sourceRevision: 'explicit-relink' })) }
      boundary.sources.updateDocument(refreshed); const fresh = await boundary.sources.prepare(refreshed, refreshed.clips, 1, () => true, imageInputs('image'))
      expect(fresh.cacheHits).toBe(0); expect(fresh.pictures.get('clip')).not.toBe(first.pictures.get('clip')); expect(boundary.compiler.bundle).toHaveBeenCalledOnce()
    } finally { await boundary.sources.dispose() }
  })
  it('晚到GPU生成串行回收，旧批次失败不破坏新批次完整保护集合', async () => {
    const document = fixture(); const boundary = boundaries(document)
    let finishOld!: () => void; let started!: () => void
    const entered = new Promise<void>(done => { started = done })
    boundary.generator.mockImplementationOnce((key, _instance, program) => new Promise(done => {
      finishOld = () => { const picture = { width: program.width, height: program.height } as VideoEditCodePicture; boundary.pictures.set(key, picture); done(picture) }
      started()
    }))
    try {
      const old = boundary.sources.prepare(document, document.clips, 0, () => true)
      const cancelled = expect(old).rejects.toMatchObject({ name: 'AbortError' }); await entered
      const next = { ...document, revision: 1, clips: [{ ...document.clips[0], code: { ...document.clips[0].code!, parameters: { amount: .8 } } }] }
      boundary.sources.updateDocument(next)
      const currentGuard = vi.fn(() => true)
      const current = boundary.sources.prepare(next, next.clips, 0, currentGuard)
      await vi.waitFor(() => expect(currentGuard.mock.calls.length).toBeGreaterThanOrEqual(3))
      expect(boundary.generator).toHaveBeenCalledOnce()
      finishOld(); await cancelled
      const ready = await current
      expect(boundary.generator).toHaveBeenCalledTimes(2); expect(boundary.pictures.size).toBe(1)
      expect(boundary.releaseUnused.mock.calls.at(-1)![0].has(boundary.generator.mock.calls[1][0])).toBe(true)
      expect(ready.pictures.get('clip')).toBe(boundary.pictures.get(boundary.generator.mock.calls[1][0]))
      expect(boundary.sources.diagnostics().staticPictures).toBe(1)
    } finally { await boundary.sources.dispose() }
  })
  it('晚到编译不能生成旧剪辑，取消/更新/关闭清理观察与compiler', async () => {
    const document = fixture(); const boundary = boundaries(document)
    let resolve!: (program: CodeAuthorBundle) => void
    boundary.compiler.bundle.mockImplementationOnce(() => new Promise<CodeAuthorBundle>(done => { resolve = done }))
    const pending = boundary.sources.prepare(document, document.clips, 0, () => true); const failed = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function')); const next = { ...document, revision: 1 }; boundary.sources.updateDocument(next)
    resolve(testAuthorBundle(source())); await failed
    expect(boundary.generator).not.toHaveBeenCalled(); expect(boundary.sources.diagnostics().programs).toBe(0)
    await boundary.sources.prepare(next, next.clips, 0, () => true)
    let late!: (program: CodeAuthorBundle) => void
    const other = { ...next, codeMaterials: [{ ...next.codeMaterials![0], versions: [...next.codeMaterials![0].versions, { id: 'later', apiVersion: 4 as const, languageVersion: 4 as const, ...testCodeManifest(source('static', '晚到'), document) }] }] }
    const changed = changedVersion(other, 'later'); boundary.sources.updateDocument(changed)
    boundary.compiler.bundle.mockImplementationOnce(() => new Promise<CodeAuthorBundle>(done => { late = done }))
    const last = boundary.sources.prepare(changed, changed.clips, 0, () => true); const lastFailed = expect(last).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(late).toBeTypeOf('function')); await boundary.sources.dispose(); late(testAuthorBundle(source('static', '晚到'))); await lastFailed
    expect(boundary.compiler.dispose).toHaveBeenCalledOnce(); expect(boundary.pictures.size).toBe(0)
    expect(boundary.sources.diagnostics()).toMatchObject({ programs: 0, staticPictures: 0, seenVersions: 0 })
  })
  it('逐出编译缓存仍拒绝同ID源码改写，缓存数量与字节均有界', async () => {
    let document = fixture(source(), 36); const boundary = boundaries(document)
    try {
      for (let index = 0; index < 36; index++) { document = changedVersion(document, `v${index}`); boundary.sources.updateDocument(document); await boundary.sources.prepare(document, document.clips, 0, () => true) }
      expect(boundary.sources.diagnostics()).toMatchObject({ programs: 32, seenVersions: 36 })
      expect(boundary.sources.diagnostics().programBytes).toBeLessThanOrEqual(16 * 1024 ** 2)
      const rewritten = { ...document, codeMaterials: [{ ...document.codeMaterials![0], versions: document.codeMaterials![0].versions.map(version => version.id === 'v0' ? { ...version, ...testCodeManifest(source('static', '冒用旧ID'), document) } : version) }] }
      expect(() => boundary.sources.updateDocument(rewritten)).toThrow('不可变代码版本')
      expect(boundary.compiler.bundle).toHaveBeenCalledTimes(36)
    } finally { await boundary.sources.dispose() }
  })
  it('不可变身份历史不限制数量或总源码字节，编译资源仍按缓存预算分配', async () => {
    const atCountLimit = fixture(source(), 4096); const counted = boundaries(atCountLimit)
    const atByteLimit = fixture()
    atByteLimit.codeMaterials![0].versions = Array.from({ length: 128 }, (_, index) => ({ id: `v${index}`, apiVersion: 4, languageVersion: 4, ...testCodeManifest(' '.repeat(65536), atByteLimit) }))
    const sized = boundaries(atByteLimit)
    try {
      expect(counted.sources.diagnostics().seenVersions).toBe(4096)
      const oneNew = fixture(); oneNew.id = atCountLimit.id; oneNew.codeMaterials![0].versions[0].id = 'new'
      expect(() => counted.sources.updateDocument(oneNew)).not.toThrow()
      expect(counted.sources.diagnostics().seenVersions).toBe(4097)
      const manifestBytes = sized.sources.diagnostics().seenManifestBytes
      expect(manifestBytes).toBeGreaterThan(0); expect(manifestBytes).toBeLessThan(8 * 1024 ** 2)
      oneNew.id = atByteLimit.id
      expect(() => sized.sources.updateDocument(oneNew)).not.toThrow()
      expect(sized.sources.diagnostics().seenManifestBytes).toBeGreaterThan(manifestBytes)
      expect(counted.compiler.bundle).not.toHaveBeenCalled(); expect(sized.compiler.bundle).not.toHaveBeenCalled()
      expect(counted.acquire).not.toHaveBeenCalled(); expect(sized.acquire).not.toHaveBeenCalled()
    } finally { await counted.sources.dispose(); await sized.sources.dispose() }
  })
  it('完整帧保护集合保留同帧目标，17个目标不再被固定数量限制', async () => {
    const document = fixture(); const boundary = boundaries(document)
    try {
      const clips = Array.from({ length: 16 }, (_, index) => ({ ...document.clips[0], id: `clip${index}`, code: { ...document.clips[0].code!, parameters: { amount: index / 20 } } }))
      await boundary.sources.prepare(document, clips, 0, () => true)
      const protectedKeys = boundary.releaseUnused.mock.calls.at(-1)![0]
      expect(protectedKeys.size).toBe(16); expect(boundary.pictures.size).toBe(16)
      expect(boundary.generator.mock.calls.every(call => protectedKeys.has(call[0]))).toBe(true)
      const result = await boundary.sources.prepare(document, [...clips, { ...clips[0], id: 'overflow', code: { ...clips[0].code, parameters: { amount: .9 } } }], 0, () => true)
      expect(result.pictures.size).toBe(17)
      expect(boundary.generator).toHaveBeenCalledTimes(17)
    } finally { await boundary.sources.dispose() }
  })
})


it('录制光标用原片源时钟：移位、裁切与两倍速后点击同帧；几何推近和损坏日志沿正式效果准备链路', async () => {
  const log = await recordingCursorFixture()
  const document = fixture()
  document.width = 1920; document.height = 1080; document.frameRate = { numerator: 60, denominator: 1 }
  document.items = [{ id: 'screen', name: '录屏', kind: 'video', mediaId: 'screen' }]
  document.media = [{ id: 'screen', name: '录屏', kind: 'video', path: '/screen.mp4', durationSeconds: 4, width: 1920, height: 1080, recordingCursor: log.source }]
  const clip: VideoEditClip = { ...document.clips[0], kind: 'video', itemId: 'screen', code: undefined, start: 90, sourceInUs: 500000, speed: { numerator: 2, denominator: 1 },
    effects: [{ id: 'cursor', name: '光标', enabled: true, amount: 1, builtin: { id: 'recording_cursor', params: { smoothing: 0 } } }] }
  document.clips = [clip]
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(Uint8Array.from(log.bytes.get(String(input))!)))
  const boundary = boundaries(document)
  try {
    // 60 fps timeline: 90 + 15 frames at 2x, source 0.5 + 0.5 seconds.
    const prepared = await boundary.sources.prepare(document, [clip], 105, () => true)
    const draws = prepared.effects.get(clip.id)![0].builtin!.cursorDraws!
    expect(draws).toHaveLength(2)
    expect(draws[0].shape).toBe(-1)
    expect(draws[1].point[0]).toBeCloseTo(200 / 1920, 6)
    expect(draws[1].point[1]).toBeCloseTo(300 / 1080, 6)
    const zoom = { ...clip, scale: 2, x: 0.25 }
    const zoomed = (await boundary.sources.prepare(document, [zoom], 105, () => true)).effects.get(clip.id)![0].builtin!.cursorDraws!
    expect(zoomed[1].size).toBeCloseTo(draws[1].size * 2)
    expect(zoomed[1].point[0]).toBeCloseTo(0.5 + 0.25 + (200 / 1920 - 0.5) * 2)
    expect(boundary.compiler.bundle).not.toHaveBeenCalled()
    const changed = { ...document, revision: document.revision + 1 }; boundary.sources.updateDocument(changed)
    fetcher.mockResolvedValue(new Response('{}'))
    await expect(boundary.sources.prepare(changed, [clip], 105, () => true)).rejects.toThrow('校验')
  } finally { fetcher.mockRestore(); await boundary.sources.dispose() }
})

it('自动缩放沿原片源时钟求值：跟随区间按块读取指针日志、定位顺序不影响结果，固定焦点不读日志', async () => {
  const log = await recordingCursorFixture()
  const document = fixture()
  document.width = 1920; document.height = 1080; document.frameRate = { numerator: 60, denominator: 1 }
  document.items = [{ id: 'screen', name: '录屏', kind: 'video', mediaId: 'screen' }]
  document.media = [{ id: 'screen', name: '录屏', kind: 'video', path: '/screen.mp4', durationSeconds: 4, width: 1920, height: 1080, recordingCursor: log.source }]
  const zoomEffect = (focus: 'cursor' | { x: number; y: number }) => ({ id: 'zoom', name: '自动缩放', enabled: true, amount: 1, builtin: { id: 'recording_zoom', params: {}, regions: [{ id: 'a', startUs: 1_000_000, endUs: 3_000_000, depth: 6, focus, origin: 'manual' as const }] } })
  const clip: VideoEditClip = { ...document.clips[0], kind: 'video', itemId: 'screen', code: undefined, start: 90, sourceInUs: 500000, speed: { numerator: 2, denominator: 1 }, effects: [zoomEffect('cursor')] }
  document.clips = [clip]
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(Uint8Array.from(log.bytes.get(String(input))!)))
  const boundary = boundaries(document)
  const center = (draw: { sample: number[] }): number => draw.sample[0] * 0.5 + draw.sample[1] * 0.5 + draw.sample[4]
  try {
    // 90 + 45 帧：源时间 2 秒，已在区间内放大到位（5 倍）；指针在 x≈200px，视野夹在画面左侧。
    const zoom = (await boundary.sources.prepare(document, [clip], 135, () => true)).effects.get(clip.id)![0].builtin!.zoom!
    expect(zoom).toBeDefined()
    // The camera has started following the pointer to the left (it eases in, so it is not there yet).
    expect(center(zoom)).toBeGreaterThanOrEqual(0.1 - 1e-6); expect(center(zoom)).toBeLessThan(0.45)
    expect(fetcher).toHaveBeenCalled()
    await boundary.sources.prepare(document, [clip], 140, () => true)
    const again = (await boundary.sources.prepare(document, [clip], 135, () => true)).effects.get(clip.id)![0].builtin!.zoom!
    expect(again.sample.map(value => value.toFixed(9))).toEqual(zoom.sample.map(value => value.toFixed(9)))
    // 源时间 1.4 秒：区间开头的放大过渡还在进行，视野比放大到位时宽
    const ramp = (await boundary.sources.prepare(document, [clip], 117, () => true)).effects.get(clip.id)![0].builtin!.zoom!
    expect(Math.abs(ramp.sample[0])).toBeGreaterThan(Math.abs(zoom.sample[0]))
  } finally { fetcher.mockRestore(); await boundary.sources.dispose() }
  const fixed = { ...clip, effects: [zoomEffect({ x: 0.5, y: 0.5 })] }
  const quiet = vi.spyOn(globalThis, 'fetch')
  const fixedDocument = { ...document, clips: [fixed] }; const second = boundaries(fixedDocument)
  try {
    const zoom = (await second.sources.prepare(fixedDocument, [fixed], 135, () => true)).effects.get(clip.id)![0].builtin!.zoom!
    expect(center(zoom)).toBeCloseTo(0.5)
    expect(quiet).not.toHaveBeenCalled()
  } finally { quiet.mockRestore(); await second.sources.dispose() }
})

it('纹理预算容量2时LRU溢出为位图，同帧结果仍有效；下一帧重建并关闭旧位图', async () => {
  const document = fixture(); const boundary = boundaries(document)
  const runtime = await boundary.acquire(); const bitmaps: ImageBitmap[] = []
  Object.assign(runtime, { generatorTargetCapacity: () => 2, spillGeneratorTarget: vi.fn(async (key: string) => {
    boundary.pictures.delete(key)
    const bitmap = { width: 3840, height: 2160, close: vi.fn() } as unknown as ImageBitmap
    bitmaps.push(bitmap); return bitmap
  }) })
  const clips = Array.from({ length: 4 }, (_, index) => ({ ...document.clips[0], id: `budget${index}`, code: { ...document.clips[0].code!, parameters: { amount: index / 10 } } }))
  try {
    const first = await boundary.sources.prepare(document, clips, 0, () => true)
    expect(first.pictures.size).toBe(4); expect(boundary.pictures.size).toBe(2)
    expect(first.pictures.get('budget0')).toBe(bitmaps[0]); expect(first.pictures.get('budget1')).toBe(bitmaps[1])
    const old = [...bitmaps]
    await boundary.sources.prepare(document, clips, 1, () => true)
    old.forEach(bitmap => expect(bitmap.close).toHaveBeenCalledOnce())
    expect(boundary.generator).toHaveBeenCalledTimes(8); expect(boundary.pictures.size).toBe(2)
  } finally { await boundary.sources.dispose() }
  bitmaps.forEach(bitmap => expect(bitmap.close).toHaveBeenCalledOnce())
})

it('离屏租约允许同名版本属于不同候选，清理旧画面并按源码重编译', async () => {
  const first = fixture(source('static', 'A')); const second = fixture(source('static', 'B'))
  second.id = first.id; second.revision = 0
  const boundary = boundaries(first)
  try {
    await boundary.sources.prepare(first, first.clips, 0, () => true)
    await boundary.sources.replaceContent(second); boundary.sources.updateDocument(second)
    await boundary.sources.prepare(second, second.clips, 0, () => true)
    expect(boundary.generator.mock.calls.map(call => call[2].name)).toEqual(['A', 'B'])
    expect(boundary.compiler.bundle).toHaveBeenCalledTimes(2)
    await boundary.sources.replaceContent(second); boundary.sources.updateDocument(second)
    await boundary.sources.prepare(second, second.clips, 0, () => true)
    expect(boundary.compiler.bundle).toHaveBeenCalledTimes(2)
  } finally { await boundary.sources.dispose() }
})
