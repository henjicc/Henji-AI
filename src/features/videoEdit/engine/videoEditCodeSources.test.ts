import { describe, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { createVideoEditDocument, videoEditComposition, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { VideoEditCodeSources } from './videoEditCodeSources'
import type { VideoEditCodeGpu, VideoEditCodePicture } from './videoEditCodeGpu'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn() }) }))
function source(mode: 'static' | 'dynamic' = 'static', name = '新图形', kind = 'generator'): string {
  return `export default {apiVersion:1,name:"${name}",kind:"${kind}",mode:"${mode}",width:3840,height:2160,durationSeconds:10,seed:42,parameters:{amount:{type:"number",title:"强度",default:.5,min:0,max:1,step:.01}},render(ctx){return ${kind === 'filter' ? 'sample(ctx.u,ctx.v)' : `[rect({x:${mode === 'dynamic' ? 'ctx.time*20+' : ''}ctx.params.amount*100,y:0,width:200,height:100,fill:[1,0,0,.5]})]`};}}`
}
function fixture(code = source(), count = 1): VideoEditComposition {
  const document = createVideoEditDocument('代码源生命周期')
  document.codeMaterials = [{ id: 'definition', name: '图形', defaultVersionId: 'v0', versions: Array.from({ length: count }, (_, index) => ({ id: `v${index}`, apiVersion: 1, languageVersion: 1, source: count === 1 ? code : source('static', `版本${index}`) })) }]
  document.items = [{ id: 'item', name: '代码', kind: 'code', code: { definitionId: 'definition', versionId: 'v0', parameters: {} } }]
  const clip: VideoEditClip = { id: 'clip', itemId: 'item', name: '代码', kind: 'code', code: { definitionId: 'definition', versionId: 'v0', parameters: {} }, track: 1, start: 0, duration: 90, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }
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
  it('晚到编译不能生成旧工程，取消/更新/关闭清理观察与compiler', async () => {
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
  it('不可变身份历史达到数量或源码字节上限后明确拒绝，移出工程也不绕过历史', async () => {
    const atCountLimit = fixture(source(), 4096); const counted = boundaries(atCountLimit)
    const atByteLimit = fixture()
    atByteLimit.codeMaterials![0].versions = Array.from({ length: 128 }, (_, index) => ({ id: `v${index}`, apiVersion: 1, languageVersion: 1, source: ' '.repeat(65536) }))
    const sized = boundaries(atByteLimit)
    try {
      expect(counted.sources.diagnostics().seenVersions).toBe(4096)
      const oneNew = fixture(); oneNew.id = atCountLimit.id; oneNew.codeMaterials![0].versions[0].id = 'new'
      expect(() => counted.sources.updateDocument(oneNew)).toThrow('重新加载预览')
      expect(sized.sources.diagnostics().seenSourceBytes).toBe(8 * 1024 ** 2)
      oneNew.id = atByteLimit.id
      expect(() => sized.sources.updateDocument(oneNew)).toThrow('重新加载预览')
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
