// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { appendVideoEditSequence, beginVideoEditGesture, closeVideoEditProject, createVideoEditProject, editVideoProject, finishVideoEditGesture, getActiveVideoEditSequence, listVideoEditInstances, saveVideoEdit, setVideoEditView, switchVideoEditSequence, undoVideoEdit } from './videoEditService'
import { rememberVideoEditCodeMetadata, readVideoEditCodeMetadata } from './videoEditCodeState'
import { addVideoEditCodeKeyframe, deleteVideoEditCodeKeyframe, readVideoEditCodeEditor, resetVideoEditCodeParameter, setVideoEditCodeParameter, updateVideoEditCodeKeyframe } from './videoEditCodeParameters'

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
  await saveVideoEdit(target.projectId); expect(JSON.parse(files.get(owner.path)!).sequences[0].clips[0].code.curves.amount).toHaveLength(2)
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
