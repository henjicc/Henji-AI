// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { createVideoEditProject, closeVideoEditProject, listVideoEditInstances, openVideoEditProject, saveVideoEdit, undoVideoEdit, editVideoProject, getActiveVideoEditSequence } from './videoEditService'
import { createVideoEditCodeItems } from './videoEditCodeService'
import { appendVideoEditItems } from './videoEditProjectItems'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { VideoEditCollectionExecutor } from './videoEditExecutors'

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
const source = `export default {apiVersion:1,name:"原创移动圆",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:4,seed:7,parameters:{amount:{type:"number",title:"透明度",default:.5,min:0,max:1,step:.01}},render(ctx){return [ellipse({x:100+ctx.time*20,y:100,width:500,height:500,fill:[0,1,1,ctx.params.amount]})];}}`
const files = new Map<string, string>()
beforeEach(() => {
  installHarnessNativeStorage(); files.clear()
  Object.assign(boundary, { compileGate: undefined, trialGate: undefined, compileCalls: 0, trialCalls: 0, failTrial: false, activeRenderers: 0, disposedCompilers: 0, dimensions: [] })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/code-project.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, value) => { files.set(path, value) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
})
afterEach(async () => { for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

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
