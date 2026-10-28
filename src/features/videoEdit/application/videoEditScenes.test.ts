// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { GOLDEN_SCENE_DECLARATION, goldenScene } from '@/core/videoEdit/scene/sceneTestFixtures'
import { parseCodeSceneSchema } from '@/core/videoEdit/scene/sceneDeclaration'
import type { VideoEditSceneRecord } from '@/core/videoEdit/scene/sceneSchema'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { useNavigationStore } from '@/stores/navigationStore'
import { testAuthorBundle, testAuthorProgram } from '../engine/videoEditAuthorTestFixtures'
import { readVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from './videoEditCodeState'
import { createVideoEditTestProject, reopenVideoEdit } from './videoEditDocumentTestKit'
import { applyVideoEditSceneChanges, mergeVideoEditSceneRegeneration, videoEditSceneDeclarationState, writeVideoEditScene } from './videoEditScenes'
import { closeVideoEditProject, editVideoProject, listVideoEditInstances, saveVideoEdit, subscribeVideoEditCommandFacts, undoVideoEdit, type VideoEditInstance } from './videoEditService'
import { beginVideoEditGesture } from './videoEditService'

vi.mock('./videoEditAuthorInspection', () => ({ inspectVideoEditAuthor: async (bundle: ReturnType<typeof testAuthorBundle>) => testAuthorProgram(bundle) }))

beforeEach(() => { installHarnessNativeStorage(); useNavigationStore.getState().setActiveWorkspace('videoEdit') })
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

const source = `export default {name:"片子",kind:"generator",mode:"dynamic",width:1920,height:1080,durationSeconds:10,params:[{key:"scene",type:"scene",title:"片子数据",schema:${JSON.stringify(GOLDEN_SCENE_DECLARATION)}}],draw(ctx,t,p){}}`
const TARGET = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }

/** 一份引用黄金片子数据的代码片段，外加一份没有代码引用的片子数据。 */
async function setup() {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  const program = testAuthorProgram(testAuthorBundle({ entry: 'main.ts', files: { 'main.ts': source }, apiVersion: 5 }))
  const version = { id: 'v', ...testCodeManifest(source, owner.document), apiVersion: 5 as const, languageVersion: program.languageVersion }
  rememberVideoEditCodeMetadata(owner, 'd', version, program)
  editVideoProject(id, document => { document = structuredClone(document);
    document.media.push({ id: 'screen', name: '录屏', path: 'D:/screen.mp4', kind: 'video', durationSeconds: 20, width: 1920, height: 1080 })
    document.codeMaterials = [{ id: 'd', name: '片子', defaultVersionId: 'v', versions: [version] }]
    document.scenes = [goldenScene('screen'), { id: 'loose', name: '未引用', schema: { id: GOLDEN_SCENE_DECLARATION.id, version: 1 }, records: [] }]
    document.items.push({ id: 'i', name: '片子', kind: 'code', code: { definitionId: 'd', versionId: 'v', parameters: { ...validateCodeMaterialParameters(program), scene: { kind: 'scene', sceneId: 'golden-scene' } } } })
    document.sequences[0].clips.push(makeVideoEditItemClip(document, 'i', document.sequences[0].id, { frame: 0 }, readVideoEditCodeMetadata(owner, document)))
    return document
  })
  return { owner, id, app: createApplicationHarness() }
}
const sceneRef = (id: string, sceneId = 'golden-scene') => ({ kind: 'video_edit.scene', id: `${id}:${sceneId}` })
const recordRef = (id: string, recordId: string) => ({ kind: 'video_edit.scene_record', id: `${id}:golden-scene/${recordId}` })
const record = (owner: VideoEditInstance, recordId: string) => owner.document.scenes!.find(scene => scene.id === 'golden-scene')!.records.find(item => item.id === recordId)
const P = (key: string) => `video_edit.scene_record.${key}`
const RECORD_PROPERTIES = ['values', 'tuned', 'start', 'end', 'dropped', 'issues'].map(P)

it('片子名称手势提交采用规范化结果，后续编辑、撤销重做和保存不保留草稿空格', async () => {
  const { owner, id, app } = await setup()
  try {
    const before = owner.document
    const gesture = beginVideoEditGesture(id)
    const result = await writeVideoEditScene(id, 'loose', [{ kind: 'rename', name: '  未修剪  ' }], { gesture })
    expect(result.scene.name).toBe('未修剪')
    expect(owner.document.media).toBe(before.media)
    editVideoProject(id, document => ({ ...document, posterFrame: { sequenceId: owner.activeSequenceId, frame: 3 } }))
    expect(owner.document.scenes!.find(scene => scene.id === 'loose')!.name).toBe('未修剪')
    undoVideoEdit(id); undoVideoEdit(id)
    expect(owner.document.scenes!.find(scene => scene.id === 'loose')!.name).toBe('未引用')
    undoVideoEdit(id, true)
    await saveVideoEdit(id)
    const reopened = await reopenVideoEdit(id)
    expect(reopened.document.scenes!.find(scene => scene.id === 'loose')!.name).toBe('未修剪')
  } finally { app.dispose() }
})

it('通过通用修改改一个框的留白：读回变化、改到的字段自动记手调、一步撤销、保存重开还在', async () => {
  const { owner, id, app } = await setup()
  try {
    const ref = recordRef(id, 'fk-1')
    const before = (await app.read(ref, RECORD_PROPERTIES)).properties as Record<string, unknown>
    // 按录屏 0.8 秒锚定：窗口第一项从 0 秒放录屏，剪后时刻就是 0.8，时长 0.5
    expect(before).toMatchObject({ [P('start')]: 0.8, [P('tuned')]: ['target'], [P('dropped')]: false, [P('issues')]: [] })
    expect(before[P('end')]).toBeCloseTo(1.3)
    const past = owner.past.length
    expect(await app.change(ref, { [P('values')]: { ...before[P('values')] as object, pad: 0.5 } })).toMatchObject({ ok: true })
    expect(record(owner, 'fk-1')).toMatchObject({ values: { pad: 0.5, target: TARGET }, tuned: ['target', 'pad'] })
    expect((await app.read(ref, [P('tuned')])).properties).toEqual({ [P('tuned')]: ['target', 'pad'] })
    expect(owner.past).toHaveLength(past + 1)
    undoVideoEdit(id)
    expect(record(owner, 'fk-1')).toMatchObject({ values: { pad: 0.3 }, tuned: ['target'] })
    undoVideoEdit(id, true)
    await saveVideoEdit(id)
    const reopened = await reopenVideoEdit(id)
    expect(reopened.document.scenes![0].records.find(item => item.id === 'fk-1')).toMatchObject({ values: { pad: 0.5 }, tuned: ['target', 'pad'] })
  } finally { app.dispose() }
})

it('整份写 records 推近一个镜头：一次提交一步撤销、读回剪后时刻；整份写与逐条写的拒绝出自同一份校验', async () => {
  const { owner, id, app } = await setup(); let commits = 0
  const stop = subscribeVideoEditCommandFacts((_owner, fact) => { if (fact.phase === 'committed') commits++ })
  try {
    const records = structuredClone(((await app.read(sceneRef(id), ['video_edit.scene.records'])).properties as Record<string, unknown>)['video_edit.scene.records']) as VideoEditSceneRecord[]
    const push = { x: 0.15, y: 0.22, width: 0.12, height: 0.04 }
    Object.assign(records.find(item => item.id === 'fk-1')!.values, { target: push, dur: 0.8 })
    const past = owner.past.length
    expect(await app.change(sceneRef(id), { 'video_edit.scene.records': records })).toMatchObject({ ok: true })
    expect(commits).toBe(1); expect(owner.past).toHaveLength(past + 1)
    const read = (await app.read(recordRef(id, 'fk-1'), RECORD_PROPERTIES)).properties as Record<string, unknown>
    // 整份写的 tuned 按写入原样保存
    expect(read).toMatchObject({ [P('values')]: { target: push, dur: 0.8 }, [P('tuned')]: ['target'], [P('start')]: 0.8 })
    expect(read[P('end')]).toBeCloseTo(1.6)
    const document = owner.document
    records.find(item => item.id === 'fk-1')!.values.pad = 2
    const whole = await app.change(sceneRef(id), { 'video_edit.scene.records': records })
    const single = await app.change(recordRef(id, 'fk-1'), { [P('values')]: { ...read[P('values')] as object, pad: 2 } })
    for (const result of [whole, single]) {
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).toContain('片子数据“黄金片子”未写入：记录 fk-1 的 values.pad')
    }
    expect(owner.document).toBe(document)
    undoVideoEdit(id)
    expect(record(owner, 'fk-1')!.values).toMatchObject({ target: TARGET, dur: 0.5 })
  } finally { stop(); app.dispose() }
})

it('通过通用集合新建一条镜头落点并删除：读回按剪切换算的时刻，删除后记录不在，撤销回来', async () => {
  const { owner, id, app } = await setup()
  try {
    const baseline = (await app.read(sceneRef(id), [])).revisions as Record<string, number>
    const created = await app.call('change_application_entities', { summary: '加一个镜头落点', changes: [{ kind: 'create_items', entityType: 'video_edit.scene_record', parent: sceneRef(id), items: [{ properties: {
      [P('record_id')]: 'fk-2', [P('kind')]: 'focusKey', [P('parent')]: 'fo-1', [P('values')]: { at: 3, dur: 0.4, win: 'win-demo', target: TARGET },
    } }] }] }, baseline)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    expect(record(owner, 'fk-2')).toMatchObject({ kind: 'focusKey', parent: 'fo-1', values: { at: 3 } })
    expect(record(owner, 'fk-2')!.tuned).toBeUndefined()
    // 2.6–2.8 剪掉了 0.2 秒，3 秒处的落点前移到 2.8
    const read = (await app.read(recordRef(id, 'fk-2'), [P('start'), P('end')])).properties as Record<string, number>
    expect(read[P('start')]).toBeCloseTo(2.8); expect(read[P('end')]).toBeCloseTo(3.2)
    const removed = await app.call('change_application_entities', { summary: '删掉镜头落点', changes: [{ kind: 'remove_items', entityType: 'video_edit.scene_record', parent: sceneRef(id), targets: [recordRef(id, 'fk-2')] }] }, (await app.read(sceneRef(id), [])).revisions as Record<string, number>)
    expect(removed, JSON.stringify(removed)).toMatchObject({ ok: true })
    expect(record(owner, 'fk-2')).toBeUndefined()
    undoVideoEdit(id)
    expect(record(owner, 'fk-2')).toBeDefined()
  } finally { app.dispose() }
})

it('通过通用集合新建片子数据并在同一事务里让片段引用它、一步撤销；还被引用的删除被拒并点名引用，没引用的可以删', async () => {
  const { owner, id, app } = await setup()
  try {
    const documentRef = { kind: 'video_edit.document', id }
    const revisions = async () => (await app.read(documentRef, [])).revisions as Record<string, number>
    const clip = owner.document.sequences[0].clips[0]
    const created = await app.call('change_application_entities', { summary: '新建片子数据并接到片段上', changes: [
      { kind: 'create_items', entityType: 'video_edit.scene', parent: documentRef, items: [{ properties: {
        'video_edit.scene.scene_id': 'copy', 'video_edit.scene.name': '副本', 'video_edit.scene.declaration_source': { versionId: 'v', parameterKey: 'scene' },
        'video_edit.scene.records': [{ id: 'seg', kind: 'segment', values: { name: '开场', start: 0, end: 2 } }],
      } }] },
      { kind: 'set_properties', entityType: 'video_edit.clip', target: { kind: 'video_edit.clip', id: `${id}:${clip.id}` }, properties: { 'video_edit.clip.code_parameters': { ...clip.code!.parameters, scene: { kind: 'scene', sceneId: 'copy' } } } },
    ] }, await revisions())
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const copy = () => owner.document.scenes!.find(scene => scene.id === 'copy')
    expect(copy()).toMatchObject({ name: '副本', schema: { id: GOLDEN_SCENE_DECLARATION.id, version: 1 }, records: [{ id: 'seg' }] })
    expect((await app.read(sceneRef(id, 'copy'), ['video_edit.scene.declaration_source'])).properties).toEqual({ 'video_edit.scene.declaration_source': { versionId: 'v', parameterKey: 'scene' } })
    // 一次事务一步撤销：片子数据与片段参数一起回去
    undoVideoEdit(id)
    expect(copy()).toBeUndefined(); expect(owner.document.sequences[0].clips[0].code!.parameters.scene).toEqual({ kind: 'scene', sceneId: 'golden-scene' })
    const wrong = await app.call('change_application_entities', { summary: '新建片子数据', changes: [{ kind: 'create_items', entityType: 'video_edit.scene', parent: documentRef, items: [{ properties: { 'video_edit.scene.name': '错', 'video_edit.scene.declaration_source': { versionId: 'v', parameterKey: 'title' } } }] }] }, await revisions())
    expect(wrong.ok).toBe(false); expect(JSON.stringify(wrong)).toContain('没有叫 title 的片子数据参数；这个版本的片子数据参数：scene')
    const referenced = await app.call('change_application_entities', { summary: '删片子数据', changes: [{ kind: 'remove_items', entityType: 'video_edit.scene', parent: documentRef, targets: [sceneRef(id)] }] }, await revisions())
    expect(referenced.ok).toBe(false)
    expect(JSON.stringify(referenced)).toContain('还被代码参数引用，没有删除'); expect(JSON.stringify(referenced)).toContain(`video_edit.item ${id}:i`); expect(JSON.stringify(referenced)).toContain(`video_edit.clip ${id}:${clip.id}`)
    const loose = await app.call('change_application_entities', { summary: '删片子数据', changes: [{ kind: 'remove_items', entityType: 'video_edit.scene', parent: documentRef, targets: [sceneRef(id, 'loose')] }] }, await revisions())
    expect(loose, JSON.stringify(loose)).toMatchObject({ ok: true })
    expect(owner.document.scenes!.map(scene => scene.id)).toEqual(['golden-scene'])
    undoVideoEdit(id)
    expect(owner.document.scenes!.map(scene => scene.id)).toEqual(['golden-scene', 'loose'])
  } finally { app.dispose() }
})

it('违反声明的写入被拒并点名字段、剪辑不变；没有代码引用的片子数据只能改名', async () => {
  const { owner, id, app } = await setup()
  try {
    const document = owner.document
    const values = ((await app.read(recordRef(id, 'fk-1'), [P('values')])).properties as Record<string, unknown>)[P('values')] as object
    const undeclared = await app.change(recordRef(id, 'fk-1'), { [P('values')]: { ...values, glow: 1 } })
    expect(undeclared.ok).toBe(false); expect(JSON.stringify(undeclared)).toContain('values.glow'); expect(JSON.stringify(undeclared)).toContain('没有声明这个字段')
    const outOfRange = await app.call('change_application_entities', { summary: '加一个落点', changes: [{ kind: 'create_items', entityType: 'video_edit.scene_record', parent: sceneRef(id), items: [{ properties: { [P('kind')]: 'focusKey', [P('parent')]: 'fo-1', [P('values')]: { at: 1, dur: 20, win: 'win-demo', target: TARGET } } }] }] }, (await app.read(sceneRef(id), [])).revisions as Record<string, number>)
    expect(outOfRange.ok).toBe(false); expect(JSON.stringify(outOfRange)).toContain('values.dur')
    expect(owner.document).toBe(document)
    const loose = await app.change(sceneRef(id, 'loose'), { 'video_edit.scene.records': [{ id: 'a', kind: 'focus', values: {} }] })
    expect(loose.ok).toBe(false); expect(JSON.stringify(loose)).toContain('没有代码片段引用这份片子数据')
    expect((await app.read(sceneRef(id, 'loose'), ['video_edit.scene.schema'])).properties).toEqual({ 'video_edit.scene.schema': null })
    expect(await app.change(sceneRef(id, 'loose'), { 'video_edit.scene.name': '备用' })).toMatchObject({ ok: true })
    expect(owner.document.scenes!.find(scene => scene.id === 'loose')!.name).toBe('备用')
  } finally { app.dispose() }
})

it('按剪后时刻改位置经写回换算：起止不倒序、时间点避开会被剪掉的区间，改到的字段记手调；恢复自动只清标记', async () => {
  const { owner, id, app } = await setup()
  try {
    // 段落拖到剪后 1–3 秒：结束落在剪切（2.6–2.8）之后，写回未剪的 3.2
    await writeVideoEditScene(id, 'golden-scene', [{ kind: 'retime', recordId: 'seg-switch', start: 1, end: 3 }])
    const segment = record(owner, 'seg-switch')!
    expect(segment.values).toMatchObject({ start: 1 }); expect(segment.values.end).toBeCloseTo(3.2)
    expect(segment.tuned).toEqual(['start', 'end'])
    const read = (await app.read(recordRef(id, 'seg-switch'), [P('start'), P('end')])).properties as Record<string, number>
    expect(read[P('start')]).toBeCloseTo(1); expect(read[P('end')]).toBeCloseTo(3)
    // 剪后 2.65 秒的未剪来源 2.65 落在剪切口前会被丢掉的区间，改取剪切后面的 2.85
    await writeVideoEditScene(id, 'golden-scene', [{ kind: 'retime', recordId: 'sh-2', start: 2.65 }])
    expect(record(owner, 'sh-2')!.values.at).toBeCloseTo(2.85)
    expect((await app.read(recordRef(id, 'sh-2'), [P('start'), P('dropped')])).properties).toMatchObject({ [P('dropped')]: false })
    await expect(writeVideoEditScene(id, 'golden-scene', [{ kind: 'retime', recordId: 'seg-switch', start: 2, end: 1 }])).rejects.toThrow('结束不能早于开始')
    await writeVideoEditScene(id, 'golden-scene', [{ kind: 'restore_automatic', recordId: 'seg-switch' }])
    expect(record(owner, 'seg-switch')!.tuned).toBeUndefined(); expect(record(owner, 'seg-switch')!.values.start).toBe(1)
  } finally { app.dispose() }
})

it('助手用 start_cut/end_cut 按剪后时刻改镜头落点：时长按未剪时间轴存，跨剪切时比剪后长度多出剪掉的那段', async () => {
  const { owner, id, app } = await setup()
  try {
    const ref = recordRef(id, 'fk-1')
    // 只改结束：开始按录屏秒锚定的 {src} 原样保留、不记手调，只重算时长
    expect(await app.change(ref, { [P('end_cut')]: 1.5 })).toMatchObject({ ok: true })
    expect(record(owner, 'fk-1')!.values.at).toEqual({ src: 0.8 }); expect(record(owner, 'fk-1')!.values.dur).toBeCloseTo(0.7)
    expect(record(owner, 'fk-1')!.tuned).toEqual(['target', 'dur'])
    // 不跨剪切：未剪长度与剪后长度相同
    expect(await app.change(ref, { [P('start_cut')]: 0.5, [P('end_cut')]: 1 })).toMatchObject({ ok: true })
    expect(record(owner, 'fk-1')!.values).toMatchObject({ at: 0.5, dur: 0.5 })
    // 跨 2.6–2.8 的剪切：剪后 2–3 秒存成未剪 2–3.2，时长 1.2
    expect(await app.change(ref, { [P('start_cut')]: 2, [P('end_cut')]: 3 })).toMatchObject({ ok: true })
    expect(record(owner, 'fk-1')!.values.at).toBe(2); expect(record(owner, 'fk-1')!.values.dur).toBeCloseTo(1.2)
    const read = (await app.read(ref, [P('start'), P('end'), P('tuned')])).properties as Record<string, unknown>
    expect(read[P('start')]).toBeCloseTo(2); expect(read[P('end')]).toBeCloseTo(3)
    expect(read[P('tuned')]).toEqual(['target', 'dur', 'at'])
    const values = (await app.read(ref, [P('values')])).properties as Record<string, unknown>
    const both = await app.change(ref, { [P('values')]: values[P('values')], [P('start_cut')]: 1 })
    expect(both.ok).toBe(false); expect(JSON.stringify(both)).toContain('同一次修改不能既写 values 又写 start_cut/end_cut')
    // 段落只写开始：结束不动，只把开始记成手调
    expect(await app.change(recordRef(id, 'seg-switch'), { [P('start_cut')]: 1 })).toMatchObject({ ok: true })
    expect(record(owner, 'seg-switch')).toMatchObject({ values: { start: 1, end: 2.5 }, tuned: ['start'] })
    // 窗口内容改开始：写回避开剪切口前会被丢掉的那一小段，读回与写入一致
    expect(await app.change(recordRef(id, 'sh-2'), { [P('start_cut')]: 2.65 })).toMatchObject({ ok: true })
    expect(((await app.read(recordRef(id, 'sh-2'), [P('start')])).properties as Record<string, number>)[P('start')]).toBeCloseTo(2.65)
    // 整条落进剪切会被剪掉：拒绝并说明
    const dropped = await app.change(ref, { [P('start_cut')]: 2.62, [P('end_cut')]: 2.65 })
    expect(dropped.ok).toBe(false); expect(JSON.stringify(dropped)).toContain('会落在剪切里被剪掉')
    const point = await app.call('describe_application_entities', { refs: [recordRef(id, 'fo-1')] })
    expect(JSON.stringify(point)).toContain('focus 记录没有声明时刻（at），没有位置可改')
  } finally { app.dispose() }
})

it('手调自动记入按规范化取值比较；tuned 要单独一次修改，之后按读回核对', async () => {
  const { owner, id, app } = await setup()
  try {
    // 换键序、把默认值显式写出来不算手调
    expect(await app.change(recordRef(id, 'sh-1'), { [P('values')]: { src: 0, rate: 1, media: 'screen', at: 0 } })).toMatchObject({ ok: true })
    expect(record(owner, 'sh-1')!.tuned).toBeUndefined()
    const ref = recordRef(id, 'fk-1')
    const values = ((await app.read(ref, [P('values')])).properties as Record<string, unknown>)[P('values')] as object
    const call = async (changes: unknown[]) => app.call('change_application_entities', { summary: '改留白并整理手调', changes }, (await app.read(ref, [])).revisions as Record<string, number>)
    const together = await call([{ kind: 'mutate_properties', entityType: 'video_edit.scene_record', target: ref, mutations: [
      { propertyId: P('values'), operation: 'set', value: { ...values, pad: 0.6 } }, { propertyId: P('tuned'), operation: 'remove', value: 'target' },
    ] }])
    expect(together.ok).toBe(false); expect(JSON.stringify(together)).toContain('tuned 要单独一次修改')
    expect(record(owner, 'fk-1')!.values).not.toMatchObject({ pad: 0.6 })
    // 先提交取值，再另起一次修改去掉一条手调：按读回核对通过
    expect(await call([{ kind: 'set_properties', entityType: 'video_edit.scene_record', target: ref, properties: { [P('values')]: { ...values, pad: 0.6 } } }])).toMatchObject({ ok: true })
    expect(record(owner, 'fk-1')!.tuned).toEqual(['target', 'pad'])
    const removed = await call([{ kind: 'mutate_properties', entityType: 'video_edit.scene_record', target: ref, mutations: [{ propertyId: P('tuned'), operation: 'remove', value: 'target' }] }])
    expect(removed, JSON.stringify(removed)).toMatchObject({ ok: true })
    expect(record(owner, 'fk-1')).toMatchObject({ values: { pad: 0.6, target: TARGET }, tuned: ['pad'] })
  } finally { app.dispose() }
})

it('写入前就有的问题不挡改别处，同一字段换成另一个不合法值仍被拒；新建的 ID 与剪辑里别的标识冲突时点名', async () => {
  const { owner, id, app } = await setup()
  try {
    editVideoProject(id, document => { document = structuredClone(document); document.scenes![0].records.find(item => item.id === 'fk-1')!.values.pad = 5; return document })
    const values = ((await app.read(recordRef(id, 'fk-1'), [P('values')])).properties as Record<string, unknown>)[P('values')] as Record<string, unknown>
    expect(await app.change(recordRef(id, 'fk-1'), { [P('values')]: { ...values, dur: 0.7 } })).toMatchObject({ ok: true })
    const document = owner.document
    const worse = await app.change(recordRef(id, 'fk-1'), { [P('values')]: { ...values, dur: 0.7, pad: 6 } })
    expect(worse.ok).toBe(false); expect(JSON.stringify(worse)).toContain('values.pad'); expect(owner.document).toBe(document)
    const clash = await app.call('change_application_entities', { summary: '新建片子数据', changes: [{ kind: 'create_items', entityType: 'video_edit.scene', parent: { kind: 'video_edit.document', id }, items: [{ properties: { 'video_edit.scene.scene_id': 'screen', 'video_edit.scene.name': '撞名', 'video_edit.scene.declaration_source': { versionId: 'v', parameterKey: 'scene' } } }] }] }, (await app.read({ kind: 'video_edit.document', id }, [])).revisions as Record<string, number>)
    expect(clash.ok).toBe(false); expect(JSON.stringify(clash)).toContain('scene_id：ID screen 已被剪辑里的素材“录屏”占用')
  } finally { app.dispose() }
})

it('没有引用的片子数据：同一次事务里先让片段引用它，再写记录，按状态阻断延迟复核后写入', async () => {
  const { owner, id, app } = await setup()
  try {
    const clip = owner.document.sequences[0].clips[0]
    const result = await app.call('change_application_entities', { summary: '接上片子数据再写记录', changes: [
      { kind: 'set_properties', entityType: 'video_edit.clip', target: { kind: 'video_edit.clip', id: `${id}:${clip.id}` }, properties: { 'video_edit.clip.code_parameters': { ...clip.code!.parameters, scene: { kind: 'scene', sceneId: 'loose' } } } },
      { kind: 'set_properties', entityType: 'video_edit.scene', target: sceneRef(id, 'loose'), properties: { 'video_edit.scene.records': [{ id: 'f', kind: 'focus', values: { name: '标题' } }] } },
    ] }, (await app.read({ kind: 'video_edit.document', id }, [])).revisions as Record<string, number>)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    expect(owner.document.scenes!.find(scene => scene.id === 'loose')!.records).toEqual([{ id: 'f', kind: 'focus', values: { name: '标题' } }])
  } finally { app.dispose() }
})

it('声明状态：只要有一处引用的结构与片子数据不一致就只能改名并点名那一处；代码版本读不到时如实说读不到', () => {
  const schema = (version: number) => ({ ...parseCodeSceneSchema(GOLDEN_SCENE_DECLARATION), version })
  const scene = { schema: { id: GOLDEN_SCENE_DECLARATION.id, version: 1 } }
  const mixed = videoEditSceneDeclarationState(scene, [{ schema: schema(1), versionId: 'v1', parameterKey: 'scene' }, { schema: schema(2), versionId: 'v2', parameterKey: 'scene' }], [])
  expect(mixed.declaration?.versionId).toBe('v1')
  expect(mixed.block).toContain('版本 v2 的参数 scene 声明的是 golden.film@2'); expect(mixed.block).toContain('新建一份片子数据')
  expect(videoEditSceneDeclarationState(scene, [], ['v3']).block).toContain('引用它的代码版本暂时读不到（v3）')
  const partly = videoEditSceneDeclarationState(scene, [{ schema: schema(1), versionId: 'v1', parameterKey: 'scene' }], ['v3'])
  expect(partly.block).toBeUndefined(); expect(partly.notes[0].message).toContain('暂时读不到（v3）')
})

it('只拒绝新引入的问题：列表删掉前面的项不让后面原有的问题变新，同一项换成另一个不合法值才拒', () => {
  const schema = parseCodeSceneSchema({ id: 'list.film', version: 1, kinds: { path: { fields: { points: { type: 'list', of: { type: 'number', min: 0, max: 1 } } } } } })
  const scene = { id: 's', name: '列表', schema: { id: 'list.film', version: 1 }, records: [{ id: 'p', kind: 'path', values: { points: [0.5, 2, 3] } }] }
  const context = { schema, media: new Map() }
  expect(applyVideoEditSceneChanges(scene, [{ kind: 'update', recordId: 'p', values: { points: [2, 3] } }], context).records[0].values.points).toEqual([2, 3])
  expect(() => applyVideoEditSceneChanges(scene, [{ kind: 'update', recordId: 'p', values: { points: [0.5, 4, 3] } }], context)).toThrow('values.points.1')
})

it('重新生成并回：手调字段保留原值，手调过却没再生成的记录连同父记录链保留，没手调的按生成结果去留', () => {
  const current: VideoEditSceneRecord[] = [
    { id: 'a', kind: 'focusKey', values: { at: 1, target: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, pad: 0.3 }, tuned: ['target.x'] },
    { id: 'q', kind: 'segment', values: { start: 0, end: 9 } },
    { id: 'p', kind: 'focus', parent: 'q', values: {} },
    { id: 'b', kind: 'focusKey', parent: 'p', values: { at: 2 }, tuned: ['at'] },
    { id: 'c', kind: 'focusKey', values: { at: 3 } },
  ]
  const merged = mergeVideoEditSceneRegeneration(current, [{ id: 'a', kind: 'focusKey', values: { at: 1.2, target: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 }, pad: 0.1 } }])
  expect(merged).toEqual([
    { id: 'a', kind: 'focusKey', values: { at: 1.2, target: { x: 0.1, y: 0.5, width: 0.2, height: 0.2 }, pad: 0.1 }, tuned: ['target.x'] },
    current[2], current[1], current[3],
  ])
})
