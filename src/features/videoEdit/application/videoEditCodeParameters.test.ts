import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { appendVideoEditSequence, beginVideoEditGesture, closeVideoEditProject, editVideoProject, finishVideoEditGesture, getActiveVideoEditSequence, listVideoEditInstances, saveVideoEdit, setVideoEditView, switchVideoEditSequence, undoVideoEdit } from './videoEditService'
import { rememberVideoEditCodeMetadata, readVideoEditCodeMetadata } from './videoEditCodeState'
import { addVideoEditCodeKeyframe, deleteVideoEditCodeKeyframe, readVideoEditCodeEditor, readVideoEditGraphicEditor, resetVideoEditCodeParameter, setVideoEditCodeParameter, updateVideoEditCodeKeyframe } from './videoEditCodeParameters'
import { createVideoEditGraphicItem, appendVideoEditItems } from './videoEditProjectItems'
import { createVideoEditGraphicObject, deleteVideoEditGraphicObjects, renameVideoEditGraphicObject, reorderVideoEditGraphicObjects } from './videoEditGraphics'
import { savedVideoEdit } from './videoEditDocumentTestKit'

const source = `export default {apiVersion:1,name:"参数",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:1,parameters:{amount:{type:"number",title:"强度",default:5,min:0,max:10,step:1,animatable:true},other:{type:"boolean",title:"开关",default:false}},render(ctx){return [rect({x:ctx.params.amount,y:0,width:100,height:100,fill:[1,0,0,1]})];}}`
const files = new Map<string, string>()
beforeEach(() => {
  installHarnessNativeStorage(); files.clear()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/parameters.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, value) => { files.set(path, value) })
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function setup() {
  const owner = (await createVideoEditProject())!; const program = compileCodeMaterial(source); const version = { id: 'v', source, apiVersion: 1 as const, languageVersion: 1 as const }
  rememberVideoEditCodeMetadata(owner, 'd', version, program)
  editVideoProject(owner.document.id, document => {
    document.codeMaterials = [{ id: 'd', name: program.name, defaultVersionId: 'v', versions: [version] }]
    document.items.push({ id: 'i', name: program.name, kind: 'code', code: { definitionId: 'd', versionId: 'v', parameters: { amount: 5, other: false } } })
    document.sequences[0].clips.push(makeVideoEditItemClip(document, 'i', document.sequences[0].id, { frame: 0 }, readVideoEditCodeMetadata(owner, document)))
    return document
  })
  return { owner, target: readVideoEditCodeEditor(owner.document.id, owner.activeSequenceId, getActiveVideoEditSequence(owner).clips[0].id).target }
}
const time = (sourceInUs: number) => ({ sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 } })
it('对象树的增删命名排序同源持久，稳定引用不跟随顺序并拒绝越界或锁定', async () => {
  const owner = (await createVideoEditProject())!; const projectId = owner.document.id; const sequenceId = owner.activeSequenceId
  const [clipId] = appendVideoEditItems(projectId, [createVideoEditGraphicItem(projectId, { kind: 'rect' })], sequenceId)
  const target = { projectId, sequenceId, clipId }; const firstId = getActiveVideoEditSequence(owner).clips[0].graphic!.objects[0].id
  const secondId = createVideoEditGraphicObject(target, { kind: 'ellipse', name: '装饰圆' })
  reorderVideoEditGraphicObjects(target, [secondId, firstId]); renameVideoEditGraphicObject({ ...target, objectId: firstId }, '背景矩形')
  setVideoEditCodeParameter({ ...target, objectId: firstId }, 'width', 100)
  expect(getActiveVideoEditSequence(owner).clips[0].graphic!.objects.map(object => [object.id, object.name])).toEqual([[secondId, '装饰圆'], [firstId, '背景矩形']])
  const baseline = owner.document; const history = owner.past.length
  expect(() => reorderVideoEditGraphicObjects(target, [firstId, firstId])).toThrow('顺序')
  expect(() => renameVideoEditGraphicObject({ ...target, objectId: firstId }, '')).toThrow()
  expect(() => deleteVideoEditGraphicObjects(target, ['missing'])).toThrow('已移除')
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
  deleteVideoEditGraphicObjects(target, [firstId]); expect(() => setVideoEditCodeParameter({ ...target, objectId: firstId }, 'width', 20)).toThrow('已改变')
  undoVideoEdit(projectId); expect(readVideoEditGraphicEditor(projectId, sequenceId, clipId, firstId).parameters.width).toBe(100)
  editVideoProject(projectId, document => { document.sequences[0].tracks.find(track => track.index === 1)!.locked = true; return document })
  expect(() => createVideoEditGraphicObject(target, { kind: 'text' })).toThrow('锁定')
})

it('命名图形对象复用参数曲线和单笔手势，不伪造代码版本并保持素材项独立', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const sequenceId = owner.activeSequenceId
  const itemId = createVideoEditGraphicItem(id, { kind: 'rect' }); const [clipId] = appendVideoEditItems(id, [itemId], sequenceId)
  const objectId = getActiveVideoEditSequence(owner).clips[0].graphic!.objects[0].id
  const target = readVideoEditGraphicEditor(id, sequenceId, clipId, objectId).target
  expect(target).not.toHaveProperty('versionId')
  const history = owner.past.length; const gesture = beginVideoEditGesture(id)
  setVideoEditCodeParameter(target, 'width', 100, { gesture }); setVideoEditCodeParameter(target, 'width', 200, { gesture }); finishVideoEditGesture(gesture)
  expect(owner.past).toHaveLength(history + 1); expect(readVideoEditGraphicEditor(id, sequenceId, clipId, objectId).parameters.width).toBe(200)
  expect(owner.document.items.find(item => item.id === itemId)!.graphic!.objects[0].parameters.width).toBe(960)
  addVideoEditCodeKeyframe(target, 'width', time(0)); addVideoEditCodeKeyframe(target, 'width', time(1e6))
  let editor = readVideoEditGraphicEditor(id, sequenceId, clipId, objectId)
  updateVideoEditCodeKeyframe(target, 'width', editor.curves.width[1].id, { value: 400 })
  setVideoEditView(id, { frame: 15 }); editor = readVideoEditGraphicEditor(id, sequenceId, clipId, objectId)
  expect(editor.parameters.width).toBe(300)
  setVideoEditCodeParameter(target, 'width', 350, { time: editor.sourceTime })
  expect(readVideoEditGraphicEditor(id, sequenceId, clipId, objectId).curves.width).toHaveLength(3)
  expect(() => setVideoEditCodeParameter({ ...target, objectId: 'missing' }, 'width', 1)).toThrow('图形对象')
  expect(() => setVideoEditCodeParameter(target, 'versionId', 'fake')).toThrow('没有声明')
  await saveVideoEdit(id); expect(savedVideoEdit(owner).sequences[0].clips[0].graphic!.objects[0].curves!.width).toHaveLength(3)
})
it('同片段多个效果按稳定id分别调参、动画和撤销，静态效果保留长源入点', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const sequenceId = owner.activeSequenceId
  const text = 'export default {apiVersion:1,name:"滤镜",kind:"filter",mode:"static",width:1920,height:1080,durationSeconds:10,seed:1,parameters:{gain:{type:"number",title:"强度",default:.5,min:0,max:1,step:.01,animatable:true}},render(ctx){const c=sample(ctx.u,ctx.v);return rgba(c.r*ctx.params.gain,c.g,c.b,c.a);}}'
  const program = compileCodeMaterial(text); const version = { id: 'filter-v', source: text, apiVersion: 1 as const, languageVersion: 1 as const }
  rememberVideoEditCodeMetadata(owner, 'filter-d', version, program)
  const itemId = createVideoEditGraphicItem(id, { kind: 'solid' }); const [clipId] = appendVideoEditItems(id, [itemId], sequenceId)
  editVideoProject(id, document => {
    document.codeMaterials = [{ id: 'filter-d', name: '滤镜', defaultVersionId: 'filter-v', versions: [version] }]
    const clip = document.sequences[0].clips[0]; clip.sourceInUs = 3_600_000_000
    clip.effects = ['first', 'second'].map(id => ({ id, name: id, enabled: true, amount: 1, code: { definitionId: 'filter-d', versionId: 'filter-v', parameters: {} } })); return document
  })
  const target = readVideoEditCodeEditor(id, sequenceId, clipId, 'second').target
  expect(readVideoEditCodeEditor(id, sequenceId, clipId, 'second').sourceTime).toEqual(time(3_600_000_000))
  const history = owner.past.length; const gesture = beginVideoEditGesture(id)
  setVideoEditCodeParameter(target, 'gain', .7, { gesture }); setVideoEditCodeParameter(target, 'gain', .8, { gesture }); finishVideoEditGesture(gesture)
  expect(owner.past).toHaveLength(history + 1); expect(readVideoEditCodeEditor(id, sequenceId, clipId, 'first').parameters.gain).toBe(.5)
  expect(readVideoEditCodeEditor(id, sequenceId, clipId, 'second').parameters.gain).toBe(.8)
  undoVideoEdit(id); expect(readVideoEditCodeEditor(id, sequenceId, clipId, 'second').parameters.gain).toBe(.5)
  addVideoEditCodeKeyframe(target, 'gain', time(3_600_000_000)); addVideoEditCodeKeyframe(target, 'gain', time(3_601_000_000))
  const editor = readVideoEditCodeEditor(id, sequenceId, clipId, 'second')
  updateVideoEditCodeKeyframe(target, 'gain', editor.curves.gain[1].id, { value: 1 })
  setVideoEditView(id, { frame: 15 }); expect(readVideoEditCodeEditor(id, sequenceId, clipId, 'second').parameters.gain).toBe(.75)
  expect(() => setVideoEditCodeParameter({ ...target, effectId: 'missing' }, 'gain', 1)).toThrow('已改变')
})
it('转场中的对象编辑沿实际序列帧和原源时钟，切点前不钳制到片段入点', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const sequenceId = owner.activeSequenceId
  const itemId = createVideoEditGraphicItem(id, { kind: 'rect' }); const [leftId, rightId] = appendVideoEditItems(id, [itemId, itemId], sequenceId, { frame: 0 })
  editVideoProject(id, document => {
    const sequence = document.sequences[0]; sequence.clips[0].duration = 30; sequence.clips[1].start = 30; sequence.clips[1].sourceInUs = 1e6
    sequence.transitions = [{ id: 'dissolve', kind: 'cross_dissolve', leftClipId: leftId, rightClipId: rightId, durationFrames: 10 }]; return document
  })
  const objectId = getActiveVideoEditSequence(owner).clips[1].graphic!.objects[0].id
  setVideoEditView(id, { frame: 25 })
  const editor = readVideoEditGraphicEditor(id, sequenceId, rightId, objectId)
  expect(editor.frame).toBe(25); expect(editor.sourceTime).toEqual({ sourceInUs: 833333, sourceRemainder: { numerator: 1, denominator: 3 } })
  setVideoEditView(id, { frame: 24 }); expect(readVideoEditGraphicEditor(id, sequenceId, rightId, objectId).frame).toBe(30)
})

it('参数按原对象合并，连续手势一笔撤销，默认实例和无关参数保持独立', async () => {
  const { owner, target } = await setup(); const history = owner.past.length
  const gesture = beginVideoEditGesture(target.projectId)
  setVideoEditCodeParameter(target, 'amount', 6, { gesture }); setVideoEditCodeParameter(target, 'amount', 8, { gesture }); finishVideoEditGesture(gesture)
  expect(owner.past).toHaveLength(history + 1); expect(readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId).parameters).toEqual({ amount: 8, other: false })
  expect(owner.document.items[0].code!.parameters.amount).toBe(5)
  undoVideoEdit(target.projectId); expect(readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId).parameters.amount).toBe(5)
  expect(() => setVideoEditCodeParameter(target, 'amount', 11)).toThrow('范围')
})

it('关键帧添加/移动/删除与当前时刻修改共用求值，重置一次恢复默认及移除该曲线', async () => {
  const { owner, target } = await setup()
  addVideoEditCodeKeyframe(target, 'amount', time(0)); addVideoEditCodeKeyframe(target, 'amount', time(2e6))
  let editor = readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId)
  updateVideoEditCodeKeyframe(target, 'amount', editor.curves.amount[1].id, { value: 9 })
  setVideoEditView(target.projectId, { frame: 30 })
  expect(readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId).parameters.amount).toBe(7)
  setVideoEditCodeParameter(target, 'amount', 8, { time: time(1e6) })
  editor = readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId)
  expect(editor.parameters.amount).toBe(8); expect(editor.curves.amount).toHaveLength(3); expect(editor.code.parameters.amount).toBe(5)
  const middle = editor.curves.amount.find(point => point.sourceInUs === 1e6)!
  updateVideoEditCodeKeyframe(target, 'amount', middle.id, { sourceInUs: 1500000, interpolation: 'ease' })
  expect(() => updateVideoEditCodeKeyframe(target, 'amount', middle.id, { sourceInUs: 2e6 })).toThrow('重复关键帧')
  deleteVideoEditCodeKeyframe(target, 'amount', middle.id); expect(readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId).curves.amount).toHaveLength(2)
  const history = owner.past.length; resetVideoEditCodeParameter(target, 'amount')
  expect(owner.past).toHaveLength(history + 1); expect(readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId).curves).toEqual({})
  undoVideoEdit(target.projectId); expect(readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId).curves.amount).toHaveLength(2)
  await saveVideoEdit(target.projectId); expect(savedVideoEdit(owner).sequences[0].clips[0].code!.curves!.amount).toHaveLength(2)
})

it('显式原目标不跟随活动序列，版本切换和旧选区手势失效后拒绝迟到写入', async () => {
  const { owner, target } = await setup(); const other = appendVideoEditSequence(target.projectId)
  setVideoEditView(target.projectId, { selection: target.clipId }); const gesture = beginVideoEditGesture(target.projectId)
  setVideoEditCodeParameter(target, 'amount', 8, { gesture }); setVideoEditView(target.projectId, { selection: null })
  expect(() => setVideoEditCodeParameter(target, 'amount', 1, { gesture })).toThrow('原参数调整已结束')
  expect(() => setVideoEditCodeParameter({ ...target, versionId: 'stale' }, 'amount', 1)).toThrow('原代码片段或源码版本已改变')
  switchVideoEditSequence(target.projectId, other); setVideoEditCodeParameter(target, 'other', true)
  expect(owner.document.sequences.find(sequence => sequence.id === target.sequenceId)!.clips[0].code!.parameters).toEqual({ amount: 5, other: true })
  expect(owner.document.sequences.find(sequence => sequence.id === other)!.clips).toEqual([])
  expect(() => addVideoEditCodeKeyframe(target, 'other', time(0))).toThrow('不支持关键帧')
})
