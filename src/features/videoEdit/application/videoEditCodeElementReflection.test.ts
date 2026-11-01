// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import { CODE_AUTHOR_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { resolveAuthorElementEffects } from '@/core/videoEdit/authorEffects'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession, listApplicationCapabilities } from '@/features/application-control/applicationCapabilityService'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { testAuthorBundle, testAuthorProgram } from '../engine/videoEditAuthorTestFixtures'
import { closeAllVideoEdits, createVideoEditTestProject } from './videoEditDocumentTestKit'
import { editVideoProject, getActiveVideoEditSequence, undoVideoEdit } from './videoEditService'
import { readVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from './videoEditCodeState'
import { videoEditCodeParameterWriter } from './videoEditCodeParameters'
import { videoEditCodeElementOverrideSummary, videoEditCodeElementWriter } from './videoEditCodeElementEditing'
import { installVideoEditCodeElements, selectVideoEditCodeElement, videoEditCodeElementRef, videoEditSelectedCodeElementContext } from './videoEditCodeElements'
import { createVideoEditCodeElementRegistration } from './videoEditCodeElementReflection'

afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

const source = 'export default {name:"元素",kind:"generator",mode:"dynamic",width:640,height:360,durationSeconds:10,params:[{key:"tint",type:"color",title:"颜色",default:[1,1,1,1],layer:"title"},{key:"amount",type:"number",title:"强度",default:5,min:0,max:10,step:1,animatable:true}],layers:p=>[{id:"title",bounds:[0,0,100,50],effects:()=>[{id:"glow",key:"light",params:{strength:10}},{id:"blur",params:{amount:20}}],draw(ctx){ctx.fillRect(0,0,100,50)}}]}'
async function setup(code = source) {
  installHarnessNativeStorage()
  const owner = await createVideoEditTestProject()
  const program = testAuthorProgram(testAuthorBundle({ apiVersion: CODE_AUTHOR_API_VERSION, entry: 'main.ts', files: { 'main.ts': code } }))
  const version = { id: 'v', ...testCodeManifest(code, owner.document), apiVersion: program.apiVersion, languageVersion: program.languageVersion }
  rememberVideoEditCodeMetadata(owner, 'd', version, program)
  editVideoProject(owner.document.id, document => {
    document = structuredClone(document)
    document.codeMaterials = [{ id: 'd', name: program.name, defaultVersionId: 'v', versions: [version] }]
    document.items.push({ id: 'i', name: program.name, kind: 'code', code: { definitionId: 'd', versionId: 'v', parameters: validateCodeMaterialParameters(program) } })
    document.sequences[0].clips.push(makeVideoEditItemClip(document, 'i', document.sequences[0].id, { frame: 0 }, readVideoEditCodeMetadata(owner, document)))
    return document
  })
  const sequence = getActiveVideoEditSequence(owner), clip = sequence.clips.find(clip => clip.kind === 'code')!
  // 取帧观察的产物：作者运行时按同一叠加函数报出代码值。
  const effects = resolveAuthorElementEffects([{ id: 'glow', key: 'light', params: { strength: 10 } }, { id: 'blur', params: { amount: 20 } }], undefined)
  installVideoEditCodeElements(owner, { sequenceId: sequence.id, revision: owner.document.revision, frame: owner.frame, clips: [{ clipId: clip.id, versionId: 'v', width: 640, height: 360, elements: [{
    id: 'title', name: '标题', bounds: [0, 0, 100, 50], matrix: [1, 0, 0, 1, 0, 0], baseMatrix: [1, 0, 0, 1, 0, 0], baseOpacity: 1, opacity: 1, corners: [[0, 0], [100, 0], [100, 50], [0, 50]],
    parameterKeys: ['tint'], textParameterKeys: [], effects: effects.effects, effectStates: effects.states, effectsTime: 0 }] }] })
  const target = { projectId: owner.document.id, sequenceId: sequence.id, clipId: clip.id, versionId: 'v', elementId: 'title' }
  const current = () => getActiveVideoEditSequence(owner).clips.find(value => value.id === clip.id)!
  return { owner, target, current, ref: videoEditCodeElementRef(target) }
}

it('界面写入记为用户、一个手势一步撤销；重置删除记录，源码不动', async () => {
  const { owner, target, current } = await setup()
  const user = videoEditCodeElementWriter('user'), history = owner.past.length, versions = structuredClone(owner.document.codeMaterials)
  user.updateVideoEditCodeElementEffect(target, 'light', { values: { strength: 40 } })
  expect(current().elementOverrides).toEqual({ title: { effects: { light: { values: { strength: 40 } } } } })
  expect(current().edits).toEqual({ 'element:title:effect:light:strength': { by: 'user', at: expect.any(Number) } })
  expect(owner.past).toHaveLength(history + 1)
  expect(user.addVideoEditCodeElementEffect(target, { id: 'glow', params: { strength: 30 } })).toBe('glow+1')
  user.updateVideoEditCodeElementEffect(target, 'blur', { enabled: false })
  expect(Object.keys(current().edits!).sort()).toEqual(['element:title:added:glow+1', 'element:title:effect:blur:enabled', 'element:title:effect:light:strength'])
  user.updateVideoEditCodeElementEffect(target, 'glow+1', { values: { strength: 50 } })
  expect(current().elementOverrides!.title.addedEffects).toEqual([{ key: 'glow+1', id: 'glow', params: { strength: 50 } }])
  expect(() => user.updateVideoEditCodeElementEffect(target, 'glow+1', { enabled: false })).toThrow(/移除/)
  // 开关动画：按当前实际值建第一帧，之后改值落在当前素材时刻，收回时留下当前值。
  user.toggleVideoEditCodeElementEffectKeyframe(target, 'light', 'strength')
  expect(current().elementOverrides!.title.effects!.light.curves!.strength).toEqual([expect.objectContaining({ value: 40, interpolation: 'linear' })])
  user.updateVideoEditCodeElementEffect(target, 'light', { values: { strength: 45 } })
  expect(current().elementOverrides!.title.effects!.light).toEqual({ values: { strength: 40 }, curves: { strength: [expect.objectContaining({ value: 45 })] } })
  user.toggleVideoEditCodeElementEffectKeyframe(target, 'light', 'strength')
  expect(current().elementOverrides!.title.effects!.light).toEqual({ values: { strength: 45 } })
  expect(() => user.updateVideoEditCodeElementEffect(target, 'light', { values: { strength: 400 } })).toThrow(/strength/)
  expect(() => user.addVideoEditCodeElementEffect(target, { key: 'light', id: 'blur', params: {} })).toThrow(/重名/)
  user.resetVideoEditCodeElementEffect(target, 'glow+1')
  user.resetVideoEditCodeElementEffect(target, 'light')
  expect(current().elementOverrides).toEqual({ title: { effects: { blur: { enabled: false } } } })
  expect(Object.keys(current().edits!)).toEqual(['element:title:effect:blur:enabled'])
  const params = videoEditCodeParameterWriter('user')
  params.setVideoEditCodeParameter(target, 'tint', [1, 0, 0, 1])
  expect(current().edits!['param:tint']).toMatchObject({ by: 'user' })
  params.resetVideoEditCodeParameter(target, 'tint')
  expect(current().edits!['param:tint']).toBeUndefined()
  undoVideoEdit(owner.document.id)
  expect(current().edits!['param:tint']).toMatchObject({ by: 'user' })
  expect(owner.document.codeMaterials).toEqual(versions)
})

it('单项重置：变换只去掉这一项，效果参数回到代码值或效果默认值，记录随之删除', async () => {
  const { target, current } = await setup()
  const user = videoEditCodeElementWriter('user')
  user.updateVideoEditCodeElement(target, { dx: 12, rotation: 30 })
  user.resetVideoEditCodeElementField(target, 'dx')
  expect(current().elementOverrides!.title).toEqual({ rotation: 30 })
  expect(Object.keys(current().edits!)).toEqual(['element:title:rotation'])
  user.resetVideoEditCodeElementField(target, 'rotation')
  expect(current().elementOverrides).toBeUndefined()
  user.updateVideoEditCodeElementEffect(target, 'light', { values: { strength: 40 } }); user.updateVideoEditCodeElementEffect(target, 'blur', { enabled: false })
  user.resetVideoEditCodeElementEffectParams(target, 'light', ['strength'])
  expect(current().elementOverrides).toEqual({ title: { effects: { blur: { enabled: false } } } })
  const key = user.addVideoEditCodeElementEffect(target, { id: 'glow', params: { strength: 30 } })
  user.resetVideoEditCodeElementEffectParams(target, key, ['strength'])
  expect(current().elementOverrides!.title.addedEffects![0].params.strength).not.toBe(30)
})
it('助手经通用动词读改元素三组属性，记为助手；越界整组拒绝，一次修改一步撤销', async () => {
  const { owner, target, current, ref } = await setup()
  selectVideoEditCodeElement(owner, target.clipId, 'title')
  expect(videoEditSelectedCodeElementContext(owner)?.elementRef).toEqual(ref)
  const app = createApplicationHarness()
  const properties = async (...ids: string[]) => (await app.read(ref, ids) as { properties: Record<string, unknown> }).properties
  try {
    const read = { properties: await properties('video_edit.code_element.observation', 'video_edit.code_element.effects') }
    expect(read.properties['video_edit.code_element.observation']).toMatchObject({ kind: 'layer', parameterKeys: ['tint'], effectStates: [{ key: 'light', id: 'glow', codeValues: { strength: 10 } }, { key: 'blur', id: 'blur' }] })
    expect(read.properties['video_edit.code_element.effects']).toEqual({})
    const before = owner.document
    expect((await app.change(ref, { 'video_edit.code_element.effects': { effects: { light: { values: { strength: 400 } } } } })).ok).toBe(false)
    expect((await app.change(ref, { 'video_edit.code_element.properties': { values: { amount: 1 } } })).ok).toBe(false)
    expect(owner.document).toBe(before)
    const history = owner.past.length
    const changed = await app.change(ref, {
      'video_edit.code_element.transform': { dx: 12, opacity: .5 },
      'video_edit.code_element.properties': { values: { tint: [0, 1, 0, 1] } },
      'video_edit.code_element.effects': { effects: { blur: { enabled: false } }, addedEffects: [{ key: 'mono', id: 'color_grade', params: { exposure: .5 } }] },
    })
    expect(changed.ok).toBe(true)
    expect(owner.past).toHaveLength(history + 1)
    expect(current().elementOverrides).toEqual({ title: { dx: 12, opacity: .5, effects: { blur: { enabled: false } }, addedEffects: [{ key: 'mono', id: 'color_grade', params: { exposure: .5 } }] } })
    expect(current().code!.parameters.tint).toEqual([0, 1, 0, 1])
    expect(Object.fromEntries(Object.entries(current().edits!).map(([key, value]) => [key, value.by]))).toEqual({ 'element:title:dx': 'assistant', 'element:title:opacity': 'assistant', 'param:tint': 'assistant', 'element:title:effect:blur:enabled': 'assistant', 'element:title:added:mono': 'assistant' })
    // 作者参数变了，上一帧的观察不再代表画面，等下一次渲染。
    expect((await properties('video_edit.code_element.observation'))['video_edit.code_element.observation']).toMatchObject({ visible: false, effectStates: [] })
    undoVideoEdit(owner.document.id)
    expect(current().elementOverrides).toBeUndefined()
    expect(current().edits).toBeUndefined()
    expect(current().code!.parameters.tint).toEqual([1, 1, 1, 1])
    // 只改覆盖时，上一帧观察按新覆盖即时读回，渲染完成前也能接着改。
    expect((await app.change(ref, { 'video_edit.code_element.effects': { effects: { blur: { enabled: false } }, addedEffects: [{ key: 'mono', id: 'color_grade', params: { exposure: .5 } }] } })).ok).toBe(true)
    const observed = (await properties('video_edit.code_element.observation'))['video_edit.code_element.observation'] as { effectStates: unknown[]; edits: Record<string, unknown> }
    expect(observed.effectStates).toEqual([expect.objectContaining({ key: 'light', enabled: true }), expect.objectContaining({ key: 'blur', enabled: false }), expect.objectContaining({ key: 'mono', added: true, values: expect.objectContaining({ exposure: .5 }) })])
    expect(Object.keys(observed.edits).sort()).toEqual(['element:title:added:mono', 'element:title:effect:blur:enabled'])
    expect((await app.change(ref, { 'video_edit.code_element.effects': {} })).ok).toBe(true)
    expect(current().elementOverrides).toBeUndefined()
    expect(current().edits).toBeUndefined()
    // 片段整体覆盖走同一校验与记录。
    expect((await app.change({ kind: 'video_edit.clip', id: `${owner.document.id}:${target.clipId}` }, { 'video_edit.clip.element_overrides': { title: { addedEffects: [{ key: 'light', id: 'blur', params: {} }] } } })).ok).toBe(false)
    expect((await app.change({ kind: 'video_edit.clip', id: `${owner.document.id}:${target.clipId}` }, { 'video_edit.clip.element_overrides': { title: { effects: { light: { enabled: false } } } } })).ok).toBe(true)
    expect(current().edits).toEqual({ 'element:title:effect:light:enabled': { by: 'assistant', at: expect.any(Number) } })
    // 源码图层 id 全是字面量时，不在源码里的元素覆盖原样保留并标为 missing。
    expect((await app.change({ kind: 'video_edit.clip', id: `${owner.document.id}:${target.clipId}` }, { 'video_edit.clip.element_overrides': { title: { effects: { light: { enabled: false } } }, ghost: { opacity: .5 } } })).ok).toBe(true)
    expect(videoEditCodeElementOverrideSummary(owner.document.id, target.sequenceId, target.clipId).map(value => [value.elementId, value.missing])).toEqual([['title', false], ['ghost', true]])
    expect((await app.read(videoEditCodeElementRef({ ...target, elementId: 'ghost' }), ['video_edit.code_element.observation']) as { properties: Record<string, unknown> }).properties['video_edit.code_element.observation']).toMatchObject({ missing: true, visible: false })
    // 隐藏后元素不在观察里：源码静态声明了它是普通图层，改几何不必先回到可见；只改 opacity/hidden 也能写回可见。
    expect((await app.change(ref, { 'video_edit.code_element.transform': { dx: 12, hidden: true } })).ok).toBe(true)
    expect((await app.change(ref, { 'video_edit.code_element.transform': { dx: 20, hidden: true } })).ok).toBe(true)
    expect((await app.change(ref, { 'video_edit.code_element.transform': { dx: 12 } })).ok).toBe(true)
    expect(current().elementOverrides!.title).toEqual({ dx: 12, effects: { light: { enabled: false } } })
    expect((await app.change(ref, { 'video_edit.code_element.transform': { dx: 12, hidden: true } })).ok).toBe(true)
    expect((await app.change(ref, { 'video_edit.code_element.transform': {} })).ok).toBe(true)
    expect(current().elementOverrides!.title).toEqual({ effects: { light: { enabled: false } } })
  } finally { app.dispose() }
})

it('修改记录的来源取自可信宿主注入的操作来源，参数不能冒充', async () => {
  const { current, ref } = await setup()
  const definition = listApplicationCapabilities().find(item => item.id === 'change_application_entities')!
  const change = (actor: 'user' | 'embedded', dx: number) => createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: crypto.randomUUID(), operationOrigin: { at: Date.now(), actor } })).execute({ id: definition.id, version: definition.version, input: { summary: '验证修改来源', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'video_edit.code_element.transform': { dx } } }] } }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  expect((await change('user', 3)).ok).toBe(true)
  expect(current().edits!['element:title:dx'].by).toBe('user')
  expect((await change('embedded', 4)).ok).toBe(true)
  expect(current().edits!['element:title:dx'].by).toBe('assistant')
})

it('源码后来用了追加项的 key：写入按换过的 key 区分两项，落盘新 key 并保留原修改记录', async () => {
  const { owner, target, current } = await setup()
  editVideoProject(owner.document.id, document => {
    document = structuredClone(document)
    const clip = document.sequences[0].clips.find(clip => clip.id === target.clipId)!
    clip.elementOverrides = { title: { addedEffects: [{ key: 'blur', id: 'glow', params: { strength: 20 } }] } }
    clip.edits = { 'element:title:added:blur': { by: 'user', at: 1 } }
    return document
  })
  const assistant = videoEditCodeElementWriter('assistant')
  // 新追加的效果不能借原 key 绕过重名检查。
  expect(() => assistant.writeVideoEditCodeElementGroups(target, { effects: { addedEffects: [{ key: 'glow+1', id: 'glow', params: { strength: 20 } }, { key: 'blur', id: 'blur', params: {} }] } })).toThrow(/重名/)
  // 片段整体写入按读回的新 key 原样写回：key 落盘，修改记录跟着改名、作者不变。
  const app = createApplicationHarness()
  try {
    expect((await app.change({ kind: 'video_edit.clip', id: `${owner.document.id}:${target.clipId}` }, { 'video_edit.clip.element_overrides': { title: { addedEffects: [{ key: 'glow+1', id: 'glow', params: { strength: 20 } }] } } })).ok).toBe(true)
  } finally { app.dispose() }
  expect(current().edits).toEqual({ 'element:title:added:glow+1': { by: 'user', at: 1 } })
  assistant.updateVideoEditCodeElementEffect(target, 'blur', { enabled: false })
  expect(current().elementOverrides).toEqual({ title: { effects: { blur: { enabled: false } }, addedEffects: [{ key: 'glow+1', id: 'glow', params: { strength: 20 } }] } })
  expect(current().edits).toEqual({ 'element:title:added:glow+1': { by: 'user', at: 1 }, 'element:title:effect:blur:enabled': { by: 'assistant', at: expect.any(Number) } })
  assistant.updateVideoEditCodeElementEffect(target, 'glow+1', { values: { strength: 30 } })
  expect(current().elementOverrides!.title.addedEffects).toEqual([{ key: 'glow+1', id: 'glow', params: { strength: 30 } }])
  expect(current().edits!['element:title:added:glow+1'].by).toBe('assistant')
})

it('调整层当前帧没有观察时，可写性与写入都按源码声明判断', async () => {
  const { target, current } = await setup(source.replace('layers:p=>[', 'layers:p=>[{id:"tone",adjust:()=>[]},'))
  const ref = videoEditCodeElementRef({ ...target, elementId: 'tone' })
  const availability = await createVideoEditCodeElementRegistration().provider!.getPropertyAvailability!(ref, ['video_edit.code_element.properties', 'video_edit.code_element.transform'])
  expect(availability.map(value => [value.propertyId, value.writable, value.reasons])).toEqual([['video_edit.code_element.properties', false, ['调整层只能修改效果参数与 opacity。']], ['video_edit.code_element.transform', true, []]])
  const app = createApplicationHarness()
  try {
    const moved = await app.change(ref, { 'video_edit.code_element.transform': { dx: 5 } })
    expect(moved.ok).toBe(false)
    expect(JSON.stringify(moved)).toMatch(/调整层没有画面范围/)
    expect((await app.change(ref, { 'video_edit.code_element.transform': { opacity: .5 } })).ok).toBe(true)
    expect(current().elementOverrides).toEqual({ tone: { opacity: .5 } })
  } finally { app.dispose() }
})

it('素材项的元素覆盖：通用写入与放进时间线都按整组严格校验', async () => {
  const { owner } = await setup()
  const bad = { title: { addedEffects: [{ key: 'grade', id: 'color_grade', params: { hsl_saturation_start: 90, hsl_saturation_end: 10 } }] } }
  const app = createApplicationHarness()
  try {
    const itemRef = { kind: 'video_edit.item', id: `${owner.document.id}:i` }
    expect((await app.change(itemRef, { 'video_edit.item.element_overrides': bad })).ok).toBe(false)
    expect(owner.document.items.find(item => item.id === 'i')!.elementOverrides).toBeUndefined()
    expect((await app.change(itemRef, { 'video_edit.item.element_overrides': { title: { addedEffects: [{ key: 'grade', id: 'color_grade', params: { hsl_saturation_start: 10, hsl_saturation_end: 90 } }] } } })).ok).toBe(true)
  } finally { app.dispose() }
  // 绕过写入口存进素材项的非法组合，放进时间线时同样拒绝。
  editVideoProject(owner.document.id, document => { document = structuredClone(document); document.items.find(item => item.id === 'i')!.elementOverrides = bad; return document })
  expect(() => makeVideoEditItemClip(owner.document, 'i', owner.document.sequences[0].id, { frame: 0 }, readVideoEditCodeMetadata(owner, owner.document))).toThrow(/初始元素覆盖无效.*不得大于/)
})
