// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { createVideoEditProject, closeVideoEditProject, listVideoEditInstances, openVideoEditProject, saveVideoEdit, undoVideoEdit, editVideoProject, getActiveVideoEditSequence, appendVideoEditMedia } from './videoEditService'
import { createVideoEditCodeItems, createVideoEditCodeVersions } from './videoEditCodeService'
import { appendVideoEditItems } from './videoEditProjectItems'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { VideoEditCollectionExecutor } from './videoEditExecutors'
import { prepareVideoEditCodeCandidate, commitVideoEditCodeCandidate, disposeVideoEditCodeCandidate } from './videoEditCodeCandidates'
import { bindVideoEditCodeImage, chooseVideoEditCodeImage } from './videoEditCodeImages'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { videoEditComposition } from '@/core/videoEdit/document'

const boundary = vi.hoisted(() => ({ compileGate: undefined as Promise<void> | undefined, trialGate: undefined as Promise<void> | undefined, compileCalls: 0, trialCalls: 0, failTrial: false, activeRenderers: 0, disposedCompilers: 0, dimensions: [] as number[][] }))
// Only thread/pixel boundaries are replaced. AST language checks, domain
// validation, public tool registry, transactions and save/reopen are real.
vi.mock('../engine/videoEditCodeCompiler', async () => {
  const { compileCodeMaterial } = await import('@/core/videoEdit/codeMaterial/compiler')
  return { VideoEditCodeCompiler: class {
    async compile(source: string) { boundary.compileCalls++; await boundary.compileGate; return compileCodeMaterial(source) }
    dispose() { boundary.disposedCompilers++ }
  } }
})
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor(document: { width: number; height: number }) { boundary.activeRenderers++; boundary.dimensions.push([document.width, document.height]) }
  async updateDocument() {}
  async present() { boundary.trialCalls++; await boundary.trialGate; if (boundary.failTrial) throw new Error('GPU trial rejected'); return { presented: true, bitmap: { close() {} } } }
  async dispose() { boundary.activeRenderers-- }
} }))
const source = `export default {apiVersion:1,name:"原创移动圆",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:4,seed:7,parameters:{amount:{type:"number",title:"透明度",default:.5,min:0,max:1,step:.01,animatable:true}},render(ctx){return [ellipse({x:100+ctx.time*20,y:100,width:500,height:500,fill:[0,1,1,ctx.params.amount]})];}}`
const files = new Map<string, string>()
beforeEach(() => {
  installHarnessNativeStorage(); files.clear()
  Object.assign(boundary, { compileGate: undefined, trialGate: undefined, compileCalls: 0, trialCalls: 0, failTrial: false, activeRenderers: 0, disposedCompilers: 0, dimensions: [] })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/code-project.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, value) => { files.set(path, value) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
})
afterEach(async () => { for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('候选返回前渲染器释放失败时仍关闭候选画面并释放试渲染队列', async () => {
  const owner = (await createVideoEditProject())!; const close = vi.fn()
  vi.spyOn(VideoEditRenderSession.prototype, 'present').mockResolvedValueOnce({ id: 1, presented: true, bitmap: { width: 1, height: 1, close } })
  vi.spyOn(VideoEditRenderSession.prototype, 'dispose').mockRejectedValueOnce(new Error('释放失败'))
  const input = [{ document: videoEditComposition(owner.document, owner.activeSequenceId), frame: 0 }]
  await expect(trialVideoEditCodeFrames(input, new AbortController().signal, true)).rejects.toThrow('释放失败')
  expect(close).toHaveBeenCalledOnce(); expect(boundary.activeRenderers).toBe(0)
  await expect(trialVideoEditCodeFrames(input, new AbortController().signal)).resolves.toBeUndefined()
  expect(boundary.activeRenderers).toBe(0)
})

it('公共集合提交新源码、实例参数独立、保存重开只保存源码版本，手动与工具共用撤销', async () => {
  const instance = (await createVideoEditProject())!; const id = instance.document.id; const app = createApplicationHarness()
  try {
    const parent = { kind: 'video_edit.project', id }; const baseline = await app.read(parent)
    const created = await app.call('change_application_entities', { summary: '创作新的透明动态图形', changes: [{ kind: 'create_items', entityType: 'video_edit.code_material', parent, items: [{ properties: { 'video_edit.code_material.source': source } }] }] }, baseline.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    expect(instance.past).toHaveLength(1); expect(boundary.dimensions).toEqual([[3840, 2160]]); expect(boundary.activeRenderers).toBe(0)
    const definition = instance.document.codeMaterials![0]; const item = instance.document.items[0]
    const materialRef = { kind: 'video_edit.code_material', id: `${id}:${definition.id}` }
    expect((await app.read(materialRef, ['video_edit.code_material.source'])).properties).toEqual({ 'video_edit.code_material.source': source })
    expect((await app.change(materialRef, { 'video_edit.code_material.source': source.replace('seed:7', 'seed:8') })).ok).toBe(false)
    const sequenceRef = { kind: 'video_edit.sequence', id: `${id}:${instance.activeSequenceId}` }
    const collectionBaseline = await app.read(sequenceRef)
    const inserted = await app.call('change_application_entities', { summary: '创建独立代码片段参数', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: { 'video_edit.clip.item_id': item.id, 'video_edit.clip.name': item.name, 'video_edit.clip.kind': 'code', 'video_edit.clip.code_parameters': { amount: .6 } } }] }] }, collectionBaseline.revisions as Record<string, number>)
    expect(inserted, JSON.stringify(inserted)).toMatchObject({ ok: true })
    appendVideoEditItems(id, [item.id], instance.activeSequenceId, { frame: 0, track: 2 })
    const clips = getActiveVideoEditSequence(instance).clips
    const ref = { kind: 'video_edit.clip', id: `${id}:${clips[0].id}` }
    const compileCount = boundary.compileCalls
    const updated = await app.change(ref, { 'video_edit.clip.code_parameters': { amount: .8 } })
    expect(updated, JSON.stringify(updated)).toMatchObject({ ok: true }); expect(boundary.compileCalls).toBe(compileCount)
    expect(getActiveVideoEditSequence(instance).clips.map(clip => clip.code!.parameters.amount)).toEqual([.8, .5]); expect(instance.document.items[0].code!.parameters.amount).toBe(.5)
    const before = instance.document
    expect((await app.change(ref, { 'video_edit.clip.code_parameters': { amount: 2 } })).ok).toBe(false); expect(instance.document).toBe(before)
    undoVideoEdit(id); expect(getActiveVideoEditSequence(instance).clips[0].code!.parameters.amount).toBe(.6)
    undoVideoEdit(id, true); await saveVideoEdit(id)
    const saved = files.get(instance.path)!
    expect(saved).not.toMatch(/"(instructions|program|metadata|shader|draws)"/)
    await closeVideoEditProject(id); const reopened = (await openVideoEditProject(instance.path))!
    expect(reopened.document.codeMaterials).toEqual(instance.document.codeMaterials)
    expect(getActiveVideoEditSequence(reopened).clips[0].code!.parameters.amount).toBe(.8)
    expect(readVideoEditCodeMetadata(reopened, reopened.document)(reopened.document.items[0].code!).mode).toBe('dynamic')
    expect(boundary.activeRenderers).toBe(0); expect(boundary.disposedCompilers).toBeGreaterThan(0)
  } finally { app.dispose() }
})

it('非法源码与试渲染失败均不入库，不留下历史或像素资源，成功重试仍是一笔编辑', async () => {
  const instance = (await createVideoEditProject())!; const id = instance.document.id; const before = instance.document
  await expect(createVideoEditCodeItems(id, [{ source: source.replace('return [ellipse', 'while(true){} return [ellipse') }])).rejects.toThrow()
  boundary.failTrial = true
  await expect(createVideoEditCodeItems(id, [{ source }])).rejects.toThrow('GPU trial rejected')
  expect(instance.document).toBe(before); expect(instance.past).toHaveLength(0); expect(boundary.activeRenderers).toBe(0)
  expect(JSON.parse(files.get(instance.path)!).items).toEqual([])
  boundary.failTrial = false; await createVideoEditCodeItems(id, [{ source }])
  expect(instance.document.items).toHaveLength(1); expect(instance.past).toHaveLength(1)
  const good = instance.document
  await expect(createVideoEditCodeItems(id, [{ source, binId: 'missing' }])).rejects.toThrow('素材箱')
  expect(instance.document).toBe(good); expect(boundary.activeRenderers).toBe(0)
})

it('试渲染晚到不能覆盖期间的手动修改，旧会话编译不能写入重开的同ID工程', async () => {
  const instance = (await createVideoEditProject())!; const id = instance.document.id
  let release!: () => void
  boundary.trialGate = new Promise<void>(resolve => { release = resolve })
  const creating = createVideoEditCodeItems(id, [{ source }])
  await vi.waitFor(() => expect(boundary.trialCalls).toBe(1))
  editVideoProject(id, document => ({ ...document, name: '检查期间的手动编辑' }))
  release(); await expect(creating).rejects.toThrow('工程已修改')
  expect(instance.document.name).toBe('检查期间的手动编辑'); expect(instance.document.items).toEqual([]); expect(instance.past).toHaveLength(1)
  boundary.trialGate = undefined
  boundary.compileGate = new Promise<void>(resolve => { release = resolve })
  const count = boundary.compileCalls; const pending = createVideoEditCodeItems(id, [{ source }])
  await vi.waitFor(() => expect(boundary.compileCalls).toBe(count + 1))
  await closeVideoEditProject(id); const reopened = (await openVideoEditProject(instance.path))!
  release(); await expect(pending).rejects.toThrow('原工程已关闭')
  expect(reopened.document.items).toEqual([]); expect(reopened.past).toHaveLength(0); expect(boundary.activeRenderers).toBe(0)
})

it('磁盘替换固定版本或未检查引用不能进入工程，失败打开释放源码线程并保留原文件', async () => {
  const instance = (await createVideoEditProject())!; const id = instance.document.id
  await createVideoEditCodeItems(id, [{ source }]); const original = instance.document
  expect(() => editVideoProject(id, document => { document.codeMaterials![0].versions[0].source = source.replace('seed:7', 'seed:8'); return document })).toThrow('被替换')
  expect(instance.document).toBe(original)
  editVideoProject(id, document => ({ ...document, items: [] }))
  expect(() => editVideoProject(id, document => { document.codeMaterials![0].versions[0].source = source.replace('seed:7', 'seed:8'); return document })).toThrow('被替换')
  await closeVideoEditProject(id)
  const raw = JSON.parse(files.get(instance.path)!); raw.codeMaterials[0].versions[0].source = 'export default {render(){while(true){}}}'
  const invalid = JSON.stringify(raw); files.set(instance.path, invalid)
  const disposed = boundary.disposedCompilers
  await expect(openVideoEditProject(instance.path)).rejects.toThrow()
  expect(listVideoEditInstances()).toEqual([]); expect(files.get(instance.path)).toBe(invalid); expect(boundary.disposedCompilers).toBeGreaterThan(disposed)
})

it('试渲染无回执在期限内释放队列和资源，随后候选可正常创建', async () => {
  const instance = (await createVideoEditProject())!
  vi.useFakeTimers()
  try {
    boundary.trialGate = new Promise(() => {})
    const rejected = expect(createVideoEditCodeItems(instance.document.id, [{ source }])).rejects.toThrow('超过30秒')
    await vi.waitFor(() => expect(boundary.trialCalls).toBe(1))
    await vi.advanceTimersByTimeAsync(30_001); await rejected
    expect(boundary.activeRenderers).toBe(0); expect(instance.document.items).toEqual([]); expect(instance.past).toHaveLength(0)
    boundary.trialGate = undefined
    await createVideoEditCodeItems(instance.document.id, [{ source }]); expect(instance.document.items).toHaveLength(1); expect(boundary.activeRenderers).toBe(0)
  } finally { vi.useRealTimers() }
})

it('公共集合的显式请求取消进入同一候选流程，不提交晚到画面', async () => {
  const instance = (await createVideoEditProject())!; const controller = new AbortController()
  let release!: () => void
  boundary.trialGate = new Promise<void>(resolve => { release = resolve })
  const executor = new VideoEditCollectionExecutor('video_edit.code_material')
  const rejected = expect(executor.apply({ kind: 'collection', entityType: executor.entityType, parent: { kind: 'video_edit.project', id: instance.document.id }, expectedRevisions: {}, operation: { kind: 'create', items: [{ properties: { 'video_edit.code_material.source': source } }] } }, { requestId: 'cancel-create', exposure: 'assistant', permissions: new Set(['video_edit:read', 'video_edit:write']), acceptedDataClasses: new Set(['C1']), signal: controller.signal })).rejects.toThrow('请求取消')
  await vi.waitFor(() => expect(boundary.trialCalls).toBe(1)); controller.abort(new Error('请求取消')); await rejected
  expect(instance.document.items).toEqual([]); expect(instance.past).toHaveLength(0); expect(boundary.activeRenderers).toBe(0)
  release()
})

it('候选显示迁移影响，确认后只绑定原片段一次撤销，明确批量更新同原版本片段', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  const [item] = await createVideoEditCodeItems(id, [{ source }])
  appendVideoEditItems(id, [item, item], owner.activeSequenceId, { frame: 0 })
  const first = getActiveVideoEditSequence(owner).clips[0]
  editVideoProject(id, document => { document.sequences[0].clips[0].code!.curves = { amount: [{ id: 'curve', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: .7, interpolation: 'linear' }] }; return document })
  const target = { projectId: id, sequenceId: owner.activeSequenceId, clipId: first.id, versionId: first.code!.versionId }
  const baseline = owner.document; const history = owner.past.length
  const candidate = await prepareVideoEditCodeCandidate(target, source.replaceAll('amount', 'opacity'))
  expect(candidate.clipCount).toBe(1); expect(candidate.impacts).toEqual([expect.objectContaining({ key: 'amount', resetValue: true, removeCurve: true })])
  expect(owner.document).toBe(baseline); expect(boundary.activeRenderers).toBe(0)
  expect(() => commitVideoEditCodeCandidate(candidate)).toThrow('确认')
  expect(() => commitVideoEditCodeCandidate({ ...candidate }, true)).toThrow('失效')
  const version = commitVideoEditCodeCandidate(candidate, true)
  expect(owner.past).toHaveLength(history + 1); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.code!.versionId)).toEqual([version, target.versionId])
  expect(getActiveVideoEditSequence(owner).clips[0].code).toMatchObject({ parameters: { opacity: .5 } })
  expect(getActiveVideoEditSequence(owner).clips[0].code).not.toHaveProperty('curves')
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].code!.curves!.amount).toHaveLength(1)
  const bulk = await prepareVideoEditCodeCandidate(target, source.replace('seed:7', 'seed:8'), 'matching')
  expect(bulk.clipCount).toBe(2); commitVideoEditCodeCandidate(bulk)
  expect(new Set(getActiveVideoEditSequence(owner).clips.map(clip => clip.code!.versionId))).toEqual(new Set([bulk.versionId]))
  expect(getActiveVideoEditSequence(owner).clips[0].code!.curves!.amount).toHaveLength(1)
})

it('取消或工程变化释放候选，非法源码和GPU失败保留最后有效源码与历史', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  const [item] = await createVideoEditCodeItems(id, [{ source }]); appendVideoEditItems(id, [item], owner.activeSequenceId)
  const clip = getActiveVideoEditSequence(owner).clips[0]
  const target = { projectId: id, sequenceId: owner.activeSequenceId, clipId: clip.id, versionId: clip.code!.versionId }
  const baseline = owner.document; const history = owner.past.length
  await expect(prepareVideoEditCodeCandidate(target, source.replace('return [', 'while(true){}return ['))).rejects.toThrow()
  boundary.failTrial = true; await expect(prepareVideoEditCodeCandidate(target, source.replace('seed:7', 'seed:9'))).rejects.toThrow('GPU trial rejected'); boundary.failTrial = false
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
  const candidate = await prepareVideoEditCodeCandidate(target, source.replace('seed:7', 'seed:9'))
  disposeVideoEditCodeCandidate(candidate); expect(() => commitVideoEditCodeCandidate(candidate)).toThrow('失效')
  let release!: () => void; boundary.trialGate = new Promise<void>(resolve => { release = resolve })
  const trialCount = boundary.trialCalls
  const pending = prepareVideoEditCodeCandidate(target, source.replace('seed:7', 'seed:10'))
  await vi.waitFor(() => expect(boundary.trialCalls).toBe(trialCount + 1))
  editVideoProject(id, document => ({ ...document, name: '期间编辑' })); release()
  await expect(pending).rejects.toThrow('内容已改变'); expect(owner.document.name).toBe('期间编辑'); expect(boundary.activeRenderers).toBe(0)
})

it('MCP只追加检查后的不可变版本，显式版本/参数/曲线事务共用手动保存与撤销', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const app = createApplicationHarness()
  try {
    const [item] = await createVideoEditCodeItems(id, [{ source }]); appendVideoEditItems(id, [item], owner.activeSequenceId)
    const definition = owner.document.codeMaterials![0]; const clip = getActiveVideoEditSequence(owner).clips[0]
    const ref = { kind: 'video_edit.clip', id: `${id}:${clip.id}` }; const parent = { kind: 'video_edit.project', id }
    const read = await app.read(parent)
    const created = await app.call('change_application_entities', { summary: '检查并保存新源码版本', changes: [{ kind: 'create_items', entityType: 'video_edit.code_version', parent, items: [{ properties: { 'video_edit.code_version.source': source.replace('max:1', 'max:2'), 'video_edit.code_version.definition_id': definition.id } }] }] }, read.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const version = owner.document.codeMaterials![0].versions[1].id
    expect(owner.document.codeMaterials![0].defaultVersionId).toBe(definition.defaultVersionId); expect(getActiveVideoEditSequence(owner).clips[0].code!.versionId).toBe(clip.code!.versionId)
    const curves = { amount: [{ id: 'public-curve', sourceInUs: 1001, sourceRemainder: { numerator: 1, denominator: 3 }, value: 1.5, interpolation: 'ease' }] }
    const changed = await app.change(ref, { 'video_edit.clip.code_version_id': version, 'video_edit.clip.code_parameters': { amount: 1.2 }, 'video_edit.clip.code_curves': curves })
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect((await app.read(ref, ['video_edit.clip.code_version_id', 'video_edit.clip.code_curves'])).properties).toEqual({ 'video_edit.clip.code_version_id': version, 'video_edit.clip.code_curves': curves })
    const before = owner.document
    expect((await app.change(ref, { 'video_edit.clip.code_curves': { amount: [{ ...curves.amount[0], value: 3 }] } })).ok).toBe(false); expect(owner.document).toBe(before)
    expect((await app.change({ kind: 'video_edit.code_version', id: `${id}:${version}` }, { 'video_edit.code_version.source': source })).ok).toBe(false)
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].code!.versionId).toBe(clip.code!.versionId)
    undoVideoEdit(id, true); await saveVideoEdit(id); await closeVideoEditProject(id)
    const reopened = (await openVideoEditProject(owner.path))!
    expect(getActiveVideoEditSequence(reopened).clips[0].code).toMatchObject({ versionId: version, parameters: { amount: 1.2 }, curves })
  } finally { app.dispose() }
})

it('图片参数引用原媒体，经同一候选检查后写入；失败无半导入，MCP回读与手动一致', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const app = createApplicationHarness()
  const imageSource = 'export default {apiVersion:1,name:"透明图片",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:4,seed:1,parameters:{logo:{type:"image",title:"徽标",default:null,animatable:false}},render(ctx){return [image({source:ctx.params.logo,x:0,y:0,width:100,height:100})];}}'
  try {
    const [item] = await createVideoEditCodeItems(id, [{ source: imageSource }]); appendVideoEditItems(id, [item], owner.activeSequenceId)
    const clip = getActiveVideoEditSequence(owner).clips[0]
    const target = { projectId: id, sequenceId: owner.activeSequenceId, clipId: clip.id, versionId: clip.code!.versionId }
    let select!: (path: string) => void
    vi.spyOn(getPlatform().system.dialog, 'open').mockImplementationOnce(() => new Promise<string>(resolve => { select = resolve }))
    const trialsBeforeDialog = boundary.trialCalls
    const selecting = chooseVideoEditCodeImage(target, 'logo')
    editVideoProject(id, document => ({ ...document, name: '图片选择期间的修改' })); const dialogBaseline = owner.document
    select('D:/picked.png'); await expect(selecting).rejects.toThrow('内容已改变')
    expect(owner.document).toBe(dialogBaseline); expect(boundary.trialCalls).toBe(trialsBeforeDialog)
    appendVideoEditMedia(id, { id: 'image', kind: 'image', path: 'D:/original.png', name: '原图', width: 3840, height: 2160, durationSeconds: 0, assetId: 'original-asset' })
    const before = owner.document; const history = owner.past.length
    boundary.failTrial = true; await expect(bindVideoEditCodeImage(target, 'logo', { kind: 'media', mediaId: 'image' })).rejects.toThrow('GPU trial rejected'); boundary.failTrial = false
    expect(owner.document).toBe(before)
    await bindVideoEditCodeImage(target, 'logo', { kind: 'media', mediaId: 'image' })
    expect(owner.past).toHaveLength(history + 1)
    const ref = { kind: 'video_edit.clip', id: `${id}:${clip.id}` }
    expect((await app.read(ref, ['video_edit.clip.code_parameters'])).properties).toEqual({ 'video_edit.clip.code_parameters': { logo: { kind: 'image', mediaId: 'image' } } })
    expect((await app.change(ref, { 'video_edit.clip.code_parameters': { logo: { kind: 'image', mediaId: 'foreign' } } })).ok).toBe(false)
    const collectionBefore = owner.document; const collectionHistory = owner.past.length
    for (const [entityType, properties] of [
      ['video_edit.item', { 'video_edit.item.name': '伪造代码项', 'video_edit.item.kind': 'code', 'video_edit.item.code': { ...clip.code!, parameters: { logo: { kind: 'image', mediaId: 'image' } } } }],
      ['video_edit.sequence', { 'video_edit.sequence.name': '隐藏片段', 'video_edit.sequence.clips': [getActiveVideoEditSequence(owner).clips[0]] }],
    ] as const) {
      const parent = { kind: 'video_edit.project', id }
      expect(await app.call('change_application_entities', { summary: '检查集合边界', changes: [{ kind: 'create_items', entityType, parent, items: [{ properties }] }] }, (await app.read(parent)).revisions as Record<string, number>)).toMatchObject({ ok: false })
      expect(owner.document).toBe(collectionBefore); expect(owner.past).toHaveLength(collectionHistory)
    }
    const parent = { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }
    const creating = { summary: '创建引用图片的代码实例', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent, items: [{ properties: { 'video_edit.clip.item_id': item, 'video_edit.clip.kind': 'code', 'video_edit.clip.name': '图片实例', 'video_edit.clip.code_parameters': { logo: { kind: 'image', mediaId: 'image' } } } }] }] }
    boundary.failTrial = true
    expect(await app.call('change_application_entities', creating, (await app.read(parent)).revisions as Record<string, number>)).toMatchObject({ ok: false })
    expect(owner.document).toBe(collectionBefore); expect(owner.past).toHaveLength(collectionHistory)
    boundary.failTrial = false
    expect(await app.call('change_application_entities', creating, (await app.read(parent)).revisions as Record<string, number>)).toMatchObject({ ok: true })
    expect(owner.past).toHaveLength(collectionHistory + 1); undoVideoEdit(id)
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].code!.parameters.logo).toBeNull()
    vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
    vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue('D:/')
    vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }))
    const close = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3840, height: 2160, close }))
    const original = owner.document; boundary.failTrial = true
    await expect(bindVideoEditCodeImage(target, 'logo', { kind: 'file', path: 'D:/new-original.png' })).rejects.toThrow('GPU trial rejected')
    expect(owner.document).toBe(original); expect(owner.document.media).toHaveLength(1)
    boundary.failTrial = false; const historyBefore = owner.past.length
    await bindVideoEditCodeImage(target, 'logo', { kind: 'file', path: 'D:/new-original.png' })
    expect(owner.past).toHaveLength(historyBefore + 1); expect(owner.document.media.at(-1)!.path).toBe('D:/new-original.png'); expect(close).toHaveBeenCalledTimes(2)
    const mediaId = owner.document.media.at(-1)!.id
    expect(getActiveVideoEditSequence(owner).clips[0].code!.parameters.logo).toEqual({ kind: 'image', mediaId })
    await saveVideoEdit(id); await closeVideoEditProject(id); const reopened = (await openVideoEditProject(owner.path))!
    expect(getActiveVideoEditSequence(reopened).clips[0].code!.parameters.logo).toEqual({ kind: 'image', mediaId })
    expect(reopened.document.media.at(-1)!.path).toBe('D:/new-original.png')
  } finally { app.dispose(); vi.unstubAllGlobals() }
})

it('批量候选绑定已有源码版本只检查选定原版本集合，不重复检查已使用新版本的其他片段', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  const [item] = await createVideoEditCodeItems(id, [{ source }]); appendVideoEditItems(id, [item, item], owner.activeSequenceId)
  const definition = owner.document.codeMaterials![0]; const nextSource = source.replace('seed:7', 'seed:12')
  const [newVersion] = await createVideoEditCodeVersions(id, [{ definitionId: definition.id, source: nextSource }])
  const first = getActiveVideoEditSequence(owner).clips[0]
  editVideoProject(id, document => {
    document.sequences[0].clips.push(...Array.from({ length: 33 }, (_, index) => ({ ...first, id: `already-new-${index}`, start: (index + 2) * first.duration, code: { ...first.code!, versionId: newVersion } })))
    return document
  })
  const count = boundary.trialCalls
  const candidate = await prepareVideoEditCodeCandidate({ projectId: id, sequenceId: owner.activeSequenceId, clipId: first.id, versionId: first.code!.versionId }, nextSource, 'matching')
  expect(candidate.clipCount).toBe(2); expect(candidate.versionId).toBe(newVersion); expect(boundary.trialCalls - count).toBe(2)
  disposeVideoEditCodeCandidate(candidate)
})
