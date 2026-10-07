import { createVideoEditTestDocument as createVideoEditDocument } from '../../../core/videoEdit/testFixtures'
import { describe, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { videoEditComposition, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { VideoEditCodeSources, type PreparedVideoEditCodeEffect } from './videoEditCodeSources'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import type { VideoEditCodePicture } from './videoEditCodeGpu'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { createVideoEditGraphic } from '@/core/videoEdit/graphics'
import { videoEditTransitionWindow } from '@/core/videoEdit/transitions'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn() }) }))
function source(mode: 'static' | 'dynamic' = 'static', name = '新图形', kind = 'generator'): string {
  return `export default {apiVersion:1,name:"${name}",kind:"${kind}",mode:"${mode}",width:3840,height:2160,durationSeconds:10,seed:42,parameters:{amount:{type:"number",title:"强度",default:.5,min:0,max:1,step:.01}},render(ctx){return ${kind === 'filter' ? 'sample(ctx.u,ctx.v)' : `[rect({x:${mode === 'dynamic' ? 'ctx.time*20+' : ''}ctx.params.amount*100,y:0,width:200,height:100,fill:[1,0,0,.5]})]`};}}`
}
function fixture(code = source(), count = 1): VideoEditComposition {
  const document = createVideoEditDocument('代码源生命周期')
  document.codeMaterials = [{ id: 'definition', name: '图形', defaultVersionId: 'v0', versions: Array.from({ length: count }, (_, index) => ({ id: `v${index}`, apiVersion: 1, languageVersion: 1, source: count === 1 ? code : source('static', `版本${index}`) })) }]
  document.items = [{ id: 'item', name: '代码', kind: 'code', code: { definitionId: 'definition', versionId: 'v0', parameters: {} } }]
  const clip: VideoEditClip = { id: 'clip', itemId: 'item', name: '代码', kind: 'code', code: { definitionId: 'definition', versionId: 'v0', parameters: {} }, track: 1, start: 0, duration: 90, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
  document.sequences[0].clips = [clip]
  return videoEditComposition(document, document.sequences[0].id)
}
function boundaries(document: VideoEditComposition) {
  const pictures = new Map<string, VideoEditCodePicture>()
  const generator = vi.fn(async (key: string, program: CodeMaterialProgram) => {
    let picture = pictures.get(key)
    if (!picture) { picture = { width: program.width, height: program.height } as VideoEditCodePicture; pictures.set(key, picture) }
    return picture
  })
  const releaseUnused = vi.fn((keys: ReadonlySet<string>) => { for (const key of pictures.keys()) if (!keys.has(key)) pictures.delete(key) })
  const runtime: Pick<VideoEditCodeGpu, 'generator' | 'releaseUnused'> = { generator, releaseUnused }
  const acquire = vi.fn(async () => runtime)
  const compiler = { compile: vi.fn(async (code: string, _signal?: AbortSignal) => compileCodeMaterial(code)), dispose: vi.fn() }
  return { sources: new VideoEditCodeSources(document, acquire, compiler), compiler, acquire, generator, releaseUnused, pictures }
}
function changedVersion(document: VideoEditComposition, id: string): VideoEditComposition {
  return { ...document, revision: document.revision + 1, clips: document.clips.map(clip => ({ ...clip, code: { ...clip.code!, versionId: id } })) }
}

describe('可见代码源与固定内容复用', () => {
  it('滤镜编译失败可跳过并报告，保留后续内置效果；未声明兜底的检查路径仍失败', async () => {
    const document = fixture(source('static', '坏滤镜', 'filter'))
    document.clips = [{ ...document.clips[0], kind: 'image', code: undefined, effects: [
      { id: 'bad', name: '坏滤镜', enabled: true, amount: 1, code: { definitionId: 'definition', versionId: 'v0', parameters: {} } },
      { id: 'good', name: '锐化', enabled: true, amount: 1, builtin: { id: 'sharpen', params: {} } },
    ] }]
    const boundary = boundaries(document)
    boundary.compiler.compile.mockRejectedValue(new Error('编译失败'))
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
    document.codeMaterials![0].versions.forEach((version, index) => { version.source = source('static', `滤镜${index}`, 'filter') })
    document.clips = [{ ...document.clips[0], kind: 'image', code: undefined,
      effects: Array.from({ length: 40 }, (_, index) => ({ id: `fx-${index}`, name: '效果', enabled: true, amount: 1, code: { definitionId: 'definition', versionId: `v${index}`, parameters: {} } })) }]
    const boundary = boundaries(document)
    try {
      for (const frame of [0, 1]) {
        const prepared = await boundary.sources.prepare(document, document.clips, frame, () => true)
        expect(prepared.effects.get('clip')).toHaveLength(40)
      }
      expect(boundary.compiler.compile).toHaveBeenCalledTimes(40)
      expect(boundary.sources.diagnostics().programs).toBe(40)
      const next = { ...document, clips: [{ ...document.clips[0], effects: document.clips[0].effects!.slice(0, 1) }], codeMaterials: [{ ...document.codeMaterials![0], versions: [...document.codeMaterials![0].versions, { id: 'new', apiVersion: 1 as const, languageVersion: 1 as const, source: source('static', '新滤镜', 'filter') }] }] }
      next.clips[0].effects.push({ id: 'new', name: '效果', enabled: true, amount: 1, code: { definitionId: 'definition', versionId: 'new', parameters: {} } })
      boundary.sources.updateDocument(next)
      await boundary.sources.prepare(next, next.clips, 2, () => true)
      expect(boundary.sources.diagnostics().programs).toBe(32)
    } finally { await boundary.sources.dispose() }
  })
  it('全透明调整层不准备四项效果，九层原范围继续透传且零GPU资源', async () => {
    const document = fixture(source(), 36)
    document.codeMaterials![0].versions.forEach((version, index) => { version.source = source('static', `调整滤镜${index}`, 'filter') })
    document.clips = Array.from({ length: 9 }, (_, index) => ({ ...document.clips[0], id: `adjustment-${index}`, kind: 'adjustment' as const, code: undefined, track: index + 1, volume: 0, opacity: 0, adjustment: { fromTrack: 0 },
      effects: Array.from({ length: 4 }, (_, effect) => ({ id: `fx-${index}-${effect}`, name: '效果', enabled: true, amount: 1, code: { definitionId: 'definition', versionId: `v${index * 4 + effect}`, parameters: {} } })) }))
    const boundary = boundaries(document)
    try {
      const prepared = await boundary.sources.prepare(document, document.clips, 0, () => true)
      expect(prepared.effects.size).toBe(0); expect(boundary.compiler.compile).not.toHaveBeenCalled(); expect(boundary.acquire).not.toHaveBeenCalled()
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
    document.codeMaterials![0].versions.forEach((version, index) => { version.source = source('static', `滤镜${index}`, 'filter') })
    document.clips = Array.from({ length: 32 }, (_, index) => ({ ...document.clips[0], id: `clip-${index}`, kind: 'image' as const, code: undefined, track: index,
      effects: [{ id: `effect-${index}`, name: `效果${index}`, enabled: index % 2 === 0, amount: index % 2 === 0 ? 0 : 1, code: { definitionId: 'definition', versionId: `v${index}`, parameters: {} } }] }))
    const boundary = boundaries(document)
    try {
      const prepared = await boundary.sources.prepare(document, document.clips, 0, () => true)
      expect(prepared.effects.size).toBe(0); expect(boundary.compiler.compile).not.toHaveBeenCalled(); expect(boundary.acquire).not.toHaveBeenCalled()
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
    const compiler = { compile: vi.fn(async (text: string) => compileCodeMaterial(text)), dispose: vi.fn() }
    const sources = new VideoEditCodeSources(document, async () => ({ generator: vi.fn(), draw, releaseUnused }), compiler)
    try {
      const reserved = new Set(['composite:clip:clip:0', 'composite:clip:clip:1', 'composite:clip:clip:2'])
      const first = await sources.prepare(document, document.clips, 0, () => true, undefined, { surfaceKeys: reserved })
      const moved = { ...document, clips: [{ ...document.clips[0], x: .5 }] }; sources.updateDocument(moved); document = moved
      const second = await sources.prepare(document, document.clips, 30, () => true, undefined, { surfaceKeys: reserved })
      expect(second.pictures.get('clip')).toBe(first.pictures.get('clip')); expect(second.cacheHits).toBe(1)
      expect(draw).toHaveBeenCalledOnce(); expect(compiler.compile).not.toHaveBeenCalled()
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
    document.codeMaterials!.push({ id: 'filter', name: '滤镜', defaultVersionId: 'fv', versions: [{ id: 'fv', apiVersion: 1, languageVersion: 1, source: filter }] })
    const base = document.clips[0]
    document.clips = [{ ...base, start: 0, duration: 60, sourceInUs: 1_000_000 }, { ...structuredClone(base), id: 'right', start: 60, duration: 60, sourceInUs: 1_000_000 }]
    document.clips[1].effects = [{ id: 'effect', name: '滤镜', enabled: true, amount: .5, code: { definitionId: 'filter', versionId: 'fv', parameters: { amount: .8 } } }]
    const window = videoEditTransitionWindow(document, { id: 'transition', kind: 'cross_dissolve', leftClipId: base.id, rightClipId: 'right', durationFrames: 10 })
    const boundary = boundaries(document)
    try {
      const first = await boundary.sources.prepare(document, document.clips, 55, () => true, undefined, { transitions: [window], surfaceKeys: new Set(['composite:transition:transition']) })
      expect(first.effects.get('right')![0]).toMatchObject({ effect: { id: 'effect' }, parameters: { amount: .8 }, transitionHandles: true, context: { localTime: -5 / 30, time: 1 - 5 / 30, frame: 55 } })
      expect(boundary.compiler.compile).toHaveBeenCalledTimes(2)
      const effects = first.effects.get('right')![0] as PreparedVideoEditCodeEffect
      expect(Object.isFrozen(effects.program)).toBe(true)
      expect([...boundary.releaseUnused.mock.lastCall![0]]).toContain('composite:transition:transition')
      const second = await boundary.sources.prepare(document, document.clips, 60, () => true, undefined, { transitions: [window] })
      expect((second.effects.get('right')![0] as PreparedVideoEditCodeEffect).context.localTime).toBe(0)
      expect((second.effects.get('right')![0] as PreparedVideoEditCodeEffect).program).toBe(effects.program)
      expect(boundary.compiler.compile).toHaveBeenCalledTimes(2)
    } finally { await boundary.sources.dispose() }
  })
  it('附加滤镜迟到编译在关闭后不能获取GPU或发布效果', async () => {
    const document = fixture(); document.clips[0].kind = 'text'; delete document.clips[0].code
    document.codeMaterials![0].versions[0].source = source('static', '滤镜', 'filter')
    document.clips[0].effects = [{ id: 'effect', name: '效果', enabled: true, amount: 1, code: { definitionId: 'definition', versionId: 'v0', parameters: {} } }]
    const boundary = boundaries(document); let finish!: (program: CodeMaterialProgram) => void
    boundary.compiler.compile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = boundary.sources.prepare(document, document.clips, 0, () => true)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await boundary.sources.dispose(); finish(compileCodeMaterial(document.codeMaterials![0].versions[0].source)); await rejected
    expect(boundary.acquire).not.toHaveBeenCalled(); expect(boundary.generator).not.toHaveBeenCalled()
    expect(boundary.sources.diagnostics()).toMatchObject({ programs: 0, staticPictures: 0 })
  })
  it('静态按版本和规范参数共享目标，帧/变换/普通revision变化不重编译或求值', async () => {
    let document = fixture(); const boundary = boundaries(document)
    try {
      const first = await boundary.sources.prepare(document, document.clips, 0, () => true)
      const picture = first.pictures.get('clip')
      const program = boundary.generator.mock.calls[0][1]
      expect(Object.isFrozen(program)).toBe(true); expect(Object.isFrozen(program.result)).toBe(true)
      const copy = { ...document.clips[0], id: 'copy', x: .4, code: { ...document.clips[0].code!, parameters: { amount: .5 } } }
      document = { ...document, revision: 7, clips: [{ ...document.clips[0], rotation: 30, opacity: .4 }, copy] }
      boundary.sources.updateDocument(document)
      const second = await boundary.sources.prepare(document, document.clips, 60, () => true)
      expect(second.pictures.get('clip')).toBe(picture); expect(second.pictures.get('copy')).toBe(picture)
      expect(second.cacheHits).toBe(2); expect(boundary.compiler.compile).toHaveBeenCalledOnce(); expect(boundary.generator).toHaveBeenCalledOnce()
      expect(boundary.releaseUnused.mock.calls.at(-1)![0].size).toBe(1)
      document = { ...document, clips: [{ ...document.clips[0], code: { ...document.clips[0].code!, parameters: { amount: .8 } } }] }
      boundary.sources.updateDocument(document); await boundary.sources.prepare(document, document.clips, 10, () => true)
      expect(boundary.generator).toHaveBeenCalledTimes(2); expect(boundary.generator.mock.calls[1][1]).toBe(program)
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
      expect(boundary.compiler.compile).toHaveBeenCalledOnce(); expect(boundary.generator).toHaveBeenCalledTimes(4)
      expect(new Set(boundary.generator.mock.calls.map(call => call[0])).size).toBe(1)
      expect(new Set(boundary.generator.mock.calls.map(call => call[1])).size).toBe(1)
    } finally { await boundary.sources.dispose() }
  })
  it('不可见版本不编译，离开所有代码片段释放目标，滤镜拒绝生成入口', async () => {
    const document = fixture(); document.codeMaterials![0].versions.push({ id: 'invalid-hidden', apiVersion: 1, languageVersion: 1, source: 'never execute this' })
    const boundary = boundaries(document)
    try {
      await boundary.sources.prepare(document, [], 0, () => true); expect(boundary.acquire).not.toHaveBeenCalled(); expect(boundary.compiler.compile).not.toHaveBeenCalled()
      await boundary.sources.prepare(document, document.clips, 0, () => true)
      await boundary.sources.prepare(document, [], 90, () => true)
      expect(boundary.pictures.size).toBe(0); expect(boundary.sources.diagnostics().staticPictures).toBe(0)
      const filter = { ...document, codeMaterials: [{ ...document.codeMaterials![0], versions: [...document.codeMaterials![0].versions, { id: 'filter', apiVersion: 1 as const, languageVersion: 1 as const, source: source('dynamic', '滤镜', 'filter') }] }] }
      boundary.sources.updateDocument(filter)
      await expect(boundary.sources.prepare(filter, changedVersion(filter, 'filter').clips, 0, () => true)).rejects.toThrow('单输入滤镜')
      expect(boundary.generator).toHaveBeenCalledOnce()
    } finally { await boundary.sources.dispose() }
  })
  it('编译失败不替换旧静态目标，恢复旧有效版本不重求值', async () => {
    const document = fixture(); document.codeMaterials![0].versions.push({ id: 'bad', apiVersion: 1, languageVersion: 1, source: 'invalid' })
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

describe('失效、身份与资源上限', () => {
  it('IR缓存逐出同步GPU滤镜管线，返回未改写旧版本可重新编译渲染', async () => {
    let document = fixture(source(), 33)
    document.codeMaterials!.push({ id: 'filter', name: '滤镜', defaultVersionId: 'fv', versions: [{ id: 'fv', apiVersion: 1, languageVersion: 1, source: source('static', '旧滤镜', 'filter') }] })
    const original = document.clips[0]
    const filterClip: VideoEditClip = { ...original, kind: 'image', code: undefined, effects: [{ id: 'fx', name: '滤镜', enabled: true, amount: 1, code: { definitionId: 'filter', versionId: 'fv', parameters: {} } }] }
    document = { ...document, clips: [filterClip] }
    const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() }
    const layouts = { createBindGroupLayout: vi.fn(), createPipelineLayout: vi.fn() }
    const device: GpuDevice & typeof layouts = {
      ...layouts,
      queue: { copyExternalImageToTexture: vi.fn(), writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: async () => {} }, lost: new Promise(() => {}),
      createShaderModule: vi.fn(), createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createSampler: vi.fn(),
      createTexture: () => ({ createView: () => ({}), destroy: vi.fn() }), createBuffer: () => ({ destroy: vi.fn() }), createBindGroup: vi.fn(),
      createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }), pushErrorScope: vi.fn(), popErrorScope: async () => null, destroy: vi.fn(),
    }
    const runtime = new VideoEditCodeGpu(device)
    const compiler = { compile: vi.fn(async (text: string) => compileCodeMaterial(text)), dispose: vi.fn() }
    const sources = new VideoEditCodeSources(document, async () => runtime, compiler)
    const prepareFilter = async () => {
      const prepared = await sources.prepare(document, document.clips, 0, () => true, undefined, { surfaceKeys: new Set(['input', 'effect']) })
      const effect = prepared.effects.get('clip')![0] as PreparedVideoEditCodeEffect; const input = await runtime.target('input', 3840, 2160)
      await runtime.filter('effect', effect.version, effect.program, effect.context, effect.parameters, input)
      return effect.program
    }
    try {
      const before = await prepareFilter()
      for (let index = 0; index < 32; index++) {
        document = { ...document, clips: [{ ...original, code: { ...original.code!, versionId: `v${index}` } }] }; sources.updateDocument(document)
        await sources.prepare(document, document.clips, 0, () => true)
      }
      expect(sources.diagnostics()).toMatchObject({ programs: 32, seenVersions: 34 })
      document = { ...document, clips: [filterClip] }; sources.updateDocument(document)
      const after = await prepareFilter()
      expect(after).not.toBe(before); expect(runtime.diagnostics().filterFrames).toBe(2)
      expect(compiler.compile).toHaveBeenCalledTimes(34)
      const changed = { ...document, codeMaterials: document.codeMaterials!.map(definition => definition.id === 'filter' ? { ...definition, versions: definition.versions.map(version => ({ ...version, source: source('static', '冒用', 'filter') })) } : definition) }
      expect(() => sources.updateDocument(changed)).toThrow('不可变代码版本')
    } finally { await sources.dispose(); await runtime.dispose() }
    expect(runtime.diagnostics()).toMatchObject({ surfaces: 0, residentBytes: 0, pipelines: 0 })
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
    const code = 'export default {apiVersion:1,name:"图片",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:10,seed:1,parameters:{logo:{type:"image",title:"徽标",default:null}},render(ctx){return [image({source:ctx.params.logo,x:0,y:0,width:100,height:100})];}}'
    const document = fixture(code)
    document.codeMaterials![0].versions[0].languageVersion = 2
    document.media = [{ id: 'image', path: 'D:/original.png', name: '原图', kind: 'image', width: 100, height: 100, durationSeconds: 0 }]
    document.clips[0].code!.parameters = { logo: { kind: 'image', mediaId: 'image' } }
    const boundary = boundaries(document)
    try {
      const first = await boundary.sources.prepare(document, document.clips, 0, () => true)
      const transformed = { ...document, revision: 1, clips: document.clips.map(clip => ({ ...clip, scale: 2 })) }
      boundary.sources.updateDocument(transformed); expect((await boundary.sources.prepare(transformed, transformed.clips, 1, () => true)).cacheHits).toBe(1)
      const refreshed = { ...transformed, revision: 2, media: transformed.media.map(media => ({ ...media, sourceRevision: 'explicit-relink' })) }
      boundary.sources.updateDocument(refreshed); const fresh = await boundary.sources.prepare(refreshed, refreshed.clips, 1, () => true)
      expect(fresh.cacheHits).toBe(0); expect(fresh.pictures.get('clip')).not.toBe(first.pictures.get('clip')); expect(boundary.compiler.compile).toHaveBeenCalledOnce()
    } finally { await boundary.sources.dispose() }
  })
  it('晚到GPU生成串行回收，旧批次失败不破坏新批次完整保护集合', async () => {
    const document = fixture(); const boundary = boundaries(document)
    let finishOld!: () => void; let started!: () => void
    const entered = new Promise<void>(done => { started = done })
    boundary.generator.mockImplementationOnce((key, program) => new Promise(done => {
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
    let resolve!: (program: CodeMaterialProgram) => void
    boundary.compiler.compile.mockImplementationOnce(() => new Promise<CodeMaterialProgram>(done => { resolve = done }))
    const pending = boundary.sources.prepare(document, document.clips, 0, () => true); const failed = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const next = { ...document, revision: 1 }; boundary.sources.updateDocument(next)
    resolve(compileCodeMaterial(source())); await failed
    expect(boundary.generator).not.toHaveBeenCalled(); expect(boundary.sources.diagnostics().programs).toBe(0)
    await boundary.sources.prepare(next, next.clips, 0, () => true)
    let late!: (program: CodeMaterialProgram) => void
    const other = { ...next, codeMaterials: [{ ...next.codeMaterials![0], versions: [...next.codeMaterials![0].versions, { id: 'later', apiVersion: 1 as const, languageVersion: 1 as const, source: source('static', '晚到') }] }] }
    const changed = changedVersion(other, 'later'); boundary.sources.updateDocument(changed)
    boundary.compiler.compile.mockImplementationOnce(() => new Promise<CodeMaterialProgram>(done => { late = done }))
    const last = boundary.sources.prepare(changed, changed.clips, 0, () => true); const lastFailed = expect(last).rejects.toMatchObject({ name: 'AbortError' })
    await boundary.sources.dispose(); late(compileCodeMaterial(source('static', '晚到'))); await lastFailed
    expect(boundary.compiler.dispose).toHaveBeenCalledOnce(); expect(boundary.pictures.size).toBe(0)
    expect(boundary.sources.diagnostics()).toMatchObject({ programs: 0, staticPictures: 0, seenVersions: 0 })
  })
  it('逐出编译缓存仍拒绝同ID源码改写，缓存数量与字节均有界', async () => {
    let document = fixture(source(), 36); const boundary = boundaries(document)
    try {
      for (let index = 0; index < 36; index++) { document = changedVersion(document, `v${index}`); boundary.sources.updateDocument(document); await boundary.sources.prepare(document, document.clips, 0, () => true) }
      expect(boundary.sources.diagnostics()).toMatchObject({ programs: 32, seenVersions: 36 })
      expect(boundary.sources.diagnostics().programBytes).toBeLessThanOrEqual(16 * 1024 ** 2)
      const rewritten = { ...document, codeMaterials: [{ ...document.codeMaterials![0], versions: document.codeMaterials![0].versions.map(version => version.id === 'v0' ? { ...version, source: source('static', '冒用旧ID') } : version) }] }
      expect(() => boundary.sources.updateDocument(rewritten)).toThrow('不可变代码版本')
      expect(boundary.compiler.compile).toHaveBeenCalledTimes(36)
    } finally { await boundary.sources.dispose() }
  })
  it('不可变身份历史不限制数量或总源码字节，编译资源仍按缓存预算分配', async () => {
    const atCountLimit = fixture(source(), 4096); const counted = boundaries(atCountLimit)
    const atByteLimit = fixture()
    atByteLimit.codeMaterials![0].versions = Array.from({ length: 128 }, (_, index) => ({ id: `v${index}`, apiVersion: 1, languageVersion: 1, source: ' '.repeat(65536) }))
    const sized = boundaries(atByteLimit)
    try {
      expect(counted.sources.diagnostics().seenVersions).toBe(4096)
      const oneNew = fixture(); oneNew.id = atCountLimit.id; oneNew.codeMaterials![0].versions[0].id = 'new'
      expect(() => counted.sources.updateDocument(oneNew)).not.toThrow()
      expect(counted.sources.diagnostics().seenVersions).toBe(4097)
      expect(sized.sources.diagnostics().seenSourceBytes).toBe(8 * 1024 ** 2)
      oneNew.id = atByteLimit.id
      expect(() => sized.sources.updateDocument(oneNew)).not.toThrow()
      expect(sized.sources.diagnostics().seenSourceBytes).toBeGreaterThan(8 * 1024 ** 2)
      expect(counted.compiler.compile).not.toHaveBeenCalled(); expect(sized.compiler.compile).not.toHaveBeenCalled()
      expect(counted.acquire).not.toHaveBeenCalled(); expect(sized.acquire).not.toHaveBeenCalled()
    } finally { await counted.sources.dispose(); await sized.sources.dispose() }
  })
  it('完整帧保护集合不逐出同帧其他目标，第17个目标先于GPU分配拒绝', async () => {
    const document = fixture(); const boundary = boundaries(document)
    try {
      const clips = Array.from({ length: 16 }, (_, index) => ({ ...document.clips[0], id: `clip${index}`, code: { ...document.clips[0].code!, parameters: { amount: index / 20 } } }))
      await boundary.sources.prepare(document, clips, 0, () => true)
      const protectedKeys = boundary.releaseUnused.mock.calls.at(-1)![0]
      expect(protectedKeys.size).toBe(16); expect(boundary.pictures.size).toBe(16)
      expect(boundary.generator.mock.calls.every(call => protectedKeys.has(call[0]))).toBe(true)
      await expect(boundary.sources.prepare(document, [...clips, { ...clips[0], id: 'overflow', code: { ...clips[0].code, parameters: { amount: .9 } } }], 0, () => true)).rejects.toThrow('16个')
      expect(boundary.generator).toHaveBeenCalledTimes(16)
    } finally { await boundary.sources.dispose() }
  })
})
