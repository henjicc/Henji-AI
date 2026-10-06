// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { addVideoEditCodeKeyframe, readVideoEditCodeEditor, updateVideoEditCodeKeyframe } from '../application/videoEditCodeParameters'
import { readVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from '../application/videoEditCodeState'
import { appendVideoEditSequence, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, saveVideoEdit, setVideoEditView, subscribeVideoEdit, switchVideoEditSequence, undoVideoEdit, videoEditGestureActive, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditEffectsPanel } from './VideoEditEffectsPanel'
import { appendVideoEditItems, createVideoEditGraphicItem, createVideoEditAdjustmentItem } from '../application/videoEditProjectItems'
import { createVideoEditGraphicObject } from '../application/videoEditGraphics'
import { createLegacyTrackVideoEditProject } from '../application/videoEditDocumentTestKit'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/ui/textMeasurement', () => ({ measureElementTextWidth: () => 30 }))
const source = `export default {apiVersion:1,name:"标量",kind:"generator",mode:"dynamic",width:64,height:64,durationSeconds:10,seed:1,parameters:{amount:{type:"number",title:"强度",description:"绘制强度",default:5,min:0,max:10,step:0.25,unit:"倍",animatable:true},ink:{type:"color",title:"颜色",default:[0.1,0.2,0.3,0.4],animatable:true},flag:{type:"boolean",title:"开关",default:false,animatable:true},style:{type:"choice",title:"样式",default:"A",options:["A","B"]},caption:{type:"text",title:"文字",default:"旧",maxLength:12,animatable:true}},render(ctx){return [rect({x:ctx.params.amount,y:0,width:10,height:10,fill:ctx.params.ink})];}}`
const alternate = `export default {apiVersion:1,name:"尺寸素材",kind:"generator",mode:"static",width:64,height:64,durationSeconds:10,seed:1,parameters:{size:{type:"number",title:"尺寸",default:20,min:1,max:100,step:1}},render(ctx){return [rect({x:0,y:0,width:ctx.params.size,height:10,fill:[1,0,0,1]})];}}`
let owner: VideoEditInstance
let onError: ReturnType<typeof vi.fn>
let sequenceId: string
let clipIds: string[]
function View({ visible = true }: { visible?: boolean }): React.ReactElement { useSyncExternalStore(subscribeVideoEdit, videoEditRevision); return <VideoEditEffectsPanel instance={owner} onError={onError} visible={visible} /> }
const editor = (index = 0) => readVideoEditCodeEditor(owner.document.id, sequenceId, clipIds[index])
const time = (sourceInUs: number) => ({ sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 } })

it('原生对象切换取消参数草稿，层序与删除空态消费同一对象树，NTSC关键帧保留余数', () => {
  const id = owner.document.id; const item = createVideoEditGraphicItem(id, { kind: 'rect' }); const [clipId] = appendVideoEditItems(id, [item], sequenceId, { frame: 0 })
  const first = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === clipId)!.graphic!.objects[0].id
  const second = createVideoEditGraphicObject({ projectId: id, sequenceId, clipId }, { kind: 'ellipse', name: '顶层圆' })
  editVideoProject(id, document => { document.sequences[0].frameRate = { numerator: 30000, denominator: 1001 }; return document })
  setVideoEditView(id, { selection: clipId, frame: 1 })
  const view = render(<View />); const clip = () => getActiveVideoEditSequence(owner).clips.find(clip => clip.id === clipId)!
  const number = within(view.container.querySelector('[data-video-edit-code-parameter="x"]') as HTMLElement).getByRole('spinbutton', { name: '水平位置' })
  const baseline = clip().graphic!.objects[1].parameters.x; const history = owner.past.length
  fireEvent.focus(number); fireEvent.change(number, { target: { value: '777' } })
  fireEvent.click(view.getByRole('button', { name: '选择图形对象矩形' }))
  expect(clip().graphic!.objects.find(object => object.id === second)!.parameters.x).toBe(baseline); expect(owner.past).toHaveLength(history)
  fireEvent.blur(number); expect(clip().graphic!.objects[0].parameters.x).toBe(baseline)
  fireEvent.click(view.getByRole('button', { name: '为水平位置添加关键帧' }))
  expect(clip().graphic!.objects.find(object => object.id === first)!.curves!.x[0]).toMatchObject({ sourceInUs: 33366, sourceRemainder: { numerator: 2, denominator: 3 } })
  fireEvent.click(view.getByRole('button', { name: '上移图形对象' })); expect(clip().graphic!.objects.map(object => object.id)).toEqual([second, first])
  expect([...view.container.querySelectorAll('[data-video-edit-graphic-object]')].map(row => row.getAttribute('data-video-edit-graphic-object'))).toEqual([first, second])
  fireEvent.click(view.getByRole('button', { name: '删除图形对象' })); fireEvent.click(view.getByRole('button', { name: '删除图形对象' }))
  expect(clip().graphic!.objects).toEqual([]); expect(view.getByText('此图形暂无对象')).toBeTruthy(); expect(view.queryByRole('button', { name: '为水平位置添加关键帧' })).toBeNull(); expect(onError).not.toHaveBeenCalled()
})
it('原生参数隐藏时回滚草稿，调整图层只呈现合法画面属性', () => {
  const id = owner.document.id; const item = createVideoEditGraphicItem(id, { kind: 'text' }); const [clipId] = appendVideoEditItems(id, [item], sequenceId, { frame: 0 }); setVideoEditView(id, { selection: clipId })
  const view = render(<View />); const number = within(view.container.querySelector('[data-video-edit-code-parameter="fontSize"]') as HTMLElement).getByRole('spinbutton', { name: '字号' })
  const original = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === clipId)!.graphic!.objects[0].parameters.fontSize
  const history = owner.past.length; fireEvent.focus(number); fireEvent.change(number, { target: { value: '200' } }); view.rerender(<View visible={false} />); fireEvent.blur(number)
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === clipId)!.graphic!.objects[0].parameters.fontSize).toBe(original); expect(owner.past).toHaveLength(history)
  const adjustment = createVideoEditAdjustmentItem(id); const [adjustmentClip] = appendVideoEditItems(id, [adjustment], sequenceId, { frame: 0, track: 2 })
  act(() => setVideoEditView(id, { selection: adjustmentClip })); view.rerender(<View />)
  for (const label of ['水平位置', '垂直位置', '缩放', '旋转', '亮度效果', '音量']) expect(view.queryByRole('spinbutton', { name: label })).toBeNull()
  expect(view.getByRole('spinbutton', { name: '不透明度' })).toBeTruthy(); expect(onError).not.toHaveBeenCalled()
})

beforeEach(async () => {
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { const width = text.length * Number.parseFloat(this.font); return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width } } } } })
  installHarnessNativeStorage(); onError = vi.fn()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/code-controls.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  owner = (await createLegacyTrackVideoEditProject())
  const programs = [source, alternate].map(compileCodeMaterial)
  for (const [index, program] of programs.entries()) rememberVideoEditCodeMetadata(owner, `d${index}`, { id: `v${index}`, source: [source, alternate][index], apiVersion: 1, languageVersion: 1 }, program)
  editVideoProject(owner.document.id, document => {
    document.codeMaterials = programs.map((program, index) => ({ id: `d${index}`, name: program.name, defaultVersionId: `v${index}`, versions: [{ id: `v${index}`, source: [source, alternate][index], apiVersion: 1, languageVersion: 1 }] }))
    for (const [index, program] of programs.entries()) {
      document.items.push({ id: `i${index}`, name: program.name, kind: 'code', code: { definitionId: `d${index}`, versionId: `v${index}`, parameters: Object.fromEntries(program.parameters.map(parameter => [parameter.key, parameter.default])) } })
      document.sequences[0].clips.push(makeVideoEditItemClip(document, `i${index}`, document.sequences[0].id, { frame: 0 }, readVideoEditCodeMetadata(owner, document)))
    }
    return document
  })
  sequenceId = owner.activeSequenceId; clipIds = getActiveVideoEditSequence(owner).clips.map(clip => clip.id)
  setVideoEditView(owner.document.id, { selection: clipIds[0] })
})
afterEach(async () => { cleanup(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

it('五种标量控件消费源码声明，并按原实例写入、重置，保留通用片段属性', () => {
  const view = render(<View />)
  const number = view.getByRole('spinbutton', { name: '强度' })
  expect(number.getAttribute('min')).toBe('0'); expect(number.getAttribute('max')).toBe('10'); expect(number.getAttribute('step')).toBe('0.25')
  expect(view.getByRole('textbox', { name: '文字' }).getAttribute('maxlength')).toBe('12')
  const history = owner.past.length
  fireEvent.focus(number); fireEvent.change(number, { target: { value: '6.75' } }); fireEvent.blur(number)
  expect(editor().parameters.amount).toBe(6.75); expect(owner.past).toHaveLength(history + 1)
  fireEvent.click(view.getByRole('switch', { name: '开关' })); expect(editor().parameters.flag).toBe(true)
  fireEvent.click(view.getByRole('button', { name: '样式' })); fireEvent.click(view.getByText('B')); expect(editor().parameters.style).toBe('B')
  const text = view.getByRole('textbox', { name: '文字' })
  fireEvent.focus(text); fireEvent.change(text, { target: { value: '新文字' } }); fireEvent.blur(text)
  expect(editor().parameters.caption).toBe('新文字')
  const color = view.getByLabelText('颜色颜色')
  fireEvent.focus(color); fireEvent.change(color, { target: { value: `#${[32, 64, 96].map(channel => channel.toString(16).padStart(2, '0')).join('')}` } }); fireEvent.blur(color)
  expect(editor().parameters.ink).toEqual([32 / 255, 64 / 255, 96 / 255, 0.4])
  fireEvent.click(view.getByRole('button', { name: '重置强度' })); expect(editor().parameters.amount).toBe(5)
  expect(owner.document.items[0].code!.parameters.amount).toBe(5)
  fireEvent.change(view.getByRole('textbox', { name: '片段名称' }), { target: { value: '我的片段' } }); expect(editor().name).toBe('我的片段')
  expect(onError).not.toHaveBeenCalled()
})

it('切换不同声明的素材只显示对应参数，不复用上一对象的输入草稿', () => {
  const view = render(<View />)
  const number = view.getByRole('spinbutton', { name: '强度' })
  fireEvent.focus(number); fireEvent.change(number, { target: { value: '8' } })
  act(() => setVideoEditView(owner.document.id, { selection: clipIds[1] }))
  expect(editor().parameters.amount).toBe(5)
  expect(view.queryByRole('spinbutton', { name: '强度' })).toBeNull()
  expect((view.getByRole('spinbutton', { name: '尺寸' }) as HTMLInputElement).value).toBe('20')
  fireEvent.blur(number); fireEvent.change(number, { target: { value: '9' } })
  expect(editor(1).parameters.size).toBe(20); expect(onError).not.toHaveBeenCalled()
})

it('数值提交后聚焦未改动的滑杆、颜色及关键帧时间不会阻塞自动保存', async () => {
  const view = render(<View />); const number = view.getByRole('spinbutton', { name: '强度' })
  fireEvent.focus(number); expect(videoEditGestureActive(owner.document.id)).toBe(false)
  fireEvent.change(number, { target: { value: '8' } }); expect(videoEditGestureActive(owner.document.id)).toBe(true)
  const range = view.getByRole('slider', { name: '强度滑杆' })
  fireEvent.blur(number, { relatedTarget: range }); fireEvent.focus(range)
  expect(videoEditGestureActive(owner.document.id)).toBe(false)
  await saveVideoEdit(owner.document.id); expect(owner.dirty).toBe(false)
  fireEvent.blur(range); const color = view.getByLabelText('颜色颜色'); fireEvent.focus(color)
  expect(videoEditGestureActive(owner.document.id)).toBe(false); fireEvent.blur(color)
  fireEvent.click(view.getByRole('button', { name: '为强度添加关键帧' }))
  const pointTime = view.getByRole('spinbutton', { name: '强度关键帧1时间（秒）' }); fireEvent.focus(pointTime)
  expect(videoEditGestureActive(owner.document.id)).toBe(false)
  await saveVideoEdit(owner.document.id); expect(owner.dirty).toBe(false); fireEvent.blur(pointTime)
  const text = view.getByRole('textbox', { name: '文字' }); fireEvent.focus(text)
  expect(videoEditGestureActive(owner.document.id)).toBe(false); fireEvent.blur(text)
  fireEvent.pointerDown(range); expect(videoEditGestureActive(owner.document.id)).toBe(false); fireEvent.pointerUp(range)
  fireEvent.pointerDown(color); expect(videoEditGestureActive(owner.document.id)).toBe(false); fireEvent.blur(color)
  await saveVideoEdit(owner.document.id); expect(owner.dirty).toBe(false); expect(onError).not.toHaveBeenCalled()
})

it('连续滑杆调整只产生一次历史，撤销恢复正确实例', () => {
  const view = render(<View />); const range = view.getByRole('slider', { name: '强度滑杆' }); const history = owner.past.length
  fireEvent.pointerDown(range); fireEvent.change(range, { target: { value: '6' } }); fireEvent.change(range, { target: { value: '8' } }); fireEvent.change(range, { target: { value: '9' } })
  expect(editor().parameters.amount).toBe(9); expect(owner.past).toHaveLength(history)
  fireEvent.pointerUp(range); expect(owner.past).toHaveLength(history + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(editor().parameters.amount).toBe(5)
  expect(onError).not.toHaveBeenCalled()
})

it('Escape、指针取消、隐藏与卸载全部回滚草稿，迟到事件不重新提交', () => {
  const view = render(<View />); const history = owner.past.length
  let range = view.getByRole('slider', { name: '强度滑杆' })
  fireEvent.pointerDown(range); fireEvent.change(range, { target: { value: '8' } }); fireEvent.keyDown(range, { key: 'Escape' }); fireEvent.blur(range)
  expect(editor().parameters.amount).toBe(5); expect(owner.past).toHaveLength(history)
  range = view.getByRole('slider', { name: '强度滑杆' }); fireEvent.pointerDown(range); fireEvent.change(range, { target: { value: '7' } }); fireEvent.pointerCancel(range)
  expect(editor().parameters.amount).toBe(5)
  range = view.getByRole('slider', { name: '强度滑杆' }); fireEvent.pointerDown(range); fireEvent.change(range, { target: { value: '9' } }); view.rerender(<View visible={false} />)
  fireEvent.pointerUp(range); expect(editor().parameters.amount).toBe(5); expect(view.queryByRole('slider', { name: '强度滑杆' })).toBeNull()
  view.rerender(<View />); range = view.getByRole('slider', { name: '强度滑杆' }); fireEvent.pointerDown(range); fireEvent.change(range, { target: { value: '6' } }); view.unmount()
  expect(editor().parameters.amount).toBe(5); expect(owner.past).toHaveLength(history); expect(onError).not.toHaveBeenCalled()
})

it('序列切换取消调整，原控件的失焦不能修改空序列或原片段', () => {
  const nextSequence = appendVideoEditSequence(owner.document.id)
  const view = render(<View />); const number = view.getByRole('spinbutton', { name: '强度' })
  fireEvent.focus(number); fireEvent.change(number, { target: { value: '8' } })
  act(() => switchVideoEditSequence(owner.document.id, nextSequence))
  fireEvent.blur(number)
  expect(editor().parameters.amount).toBe(5); expect(getActiveVideoEditSequence(owner).clips).toEqual([])
  expect(view.queryByRole('spinbutton', { name: '强度' })).toBeNull(); expect(onError).not.toHaveBeenCalled()
})

it('关键帧使用精确源时刻，未编辑 NTSC 余量不变，移动/值/插值/删除与重置真实写入', () => {
  editVideoProject(owner.document.id, document => { document.sequences[0].frameRate = { numerator: 30000, denominator: 1001 }; return document })
  setVideoEditView(owner.document.id, { frame: 1 })
  const expected = editor().sourceTime; const view = render(<View />)
  fireEvent.click(view.getByRole('button', { name: '为强度添加关键帧' }))
  expect(editor().curves.amount[0]).toMatchObject(expected)
  const history = owner.past.length; let timeInput = view.getByRole('spinbutton', { name: '强度关键帧1时间（秒）' })
  fireEvent.focus(timeInput); fireEvent.blur(timeInput)
  expect(editor().curves.amount[0]).toMatchObject(expected); expect(owner.past).toHaveLength(history)
  timeInput = view.getByRole('spinbutton', { name: '强度关键帧1时间（秒）' })
  fireEvent.focus(timeInput); fireEvent.change(timeInput, { target: { value: '2.5' } }); fireEvent.blur(timeInput)
  expect(editor().curves.amount[0]).toMatchObject(time(2500000))
  const pointValue = view.getByRole('spinbutton', { name: '强度关键帧1值' }); fireEvent.focus(pointValue); fireEvent.change(pointValue, { target: { value: '8.5' } }); fireEvent.blur(pointValue)
  expect(editor().curves.amount[0].value).toBe(8.5); expect(editor().code.parameters.amount).toBe(5)
  fireEvent.click(view.getByRole('button', { name: '强度关键帧1插值' })); fireEvent.click(view.getByText('缓动'))
  expect(editor().curves.amount[0].interpolation).toBe('ease')
  fireEvent.click(view.getByRole('button', { name: '删除强度关键帧1' })); expect(editor().curves.amount).toBeUndefined()
  fireEvent.click(view.getByRole('button', { name: '为强度添加关键帧' })); const beforeReset = owner.past.length
  fireEvent.click(view.getByRole('button', { name: '重置强度' })); expect(editor().curves.amount).toBeUndefined(); expect(owner.past).toHaveLength(beforeReset + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(editor().curves.amount).toHaveLength(1)
  expect(onError).not.toHaveBeenCalled()
})

it('已有动画的滑杆写当前源时刻，拖动期间播放位置改变不会创建额外时刻点', () => {
  const target = editor().target
  addVideoEditCodeKeyframe(target, 'amount', time(0)); addVideoEditCodeKeyframe(target, 'amount', time(2000000))
  updateVideoEditCodeKeyframe(target, 'amount', editor().curves.amount[1].id, { value: 9 })
  setVideoEditView(owner.document.id, { frame: 30 }); const view = render(<View />); const range = view.getByRole('slider', { name: '强度滑杆' }); const history = owner.past.length
  expect((view.getByRole('spinbutton', { name: '强度' }) as HTMLInputElement).value).toBe('7')
  fireEvent.pointerDown(range); fireEvent.change(range, { target: { value: '8' } })
  act(() => setVideoEditView(owner.document.id, { frame: 45 })); fireEvent.change(range, { target: { value: '6' } }); fireEvent.pointerUp(range)
  expect(editor().curves.amount.map(point => point.sourceInUs)).toEqual([0, 1000000, 2000000])
  expect(editor().curves.amount[1].value).toBe(6); expect(owner.past).toHaveLength(history + 1); expect(editor().code.parameters.amount).toBe(5)
  expect(onError).not.toHaveBeenCalled()
})

it('离散关键帧只提供保持，布尔与文字值共用参数控件', () => {
  const view = render(<View />)
  fireEvent.click(view.getByRole('button', { name: '为开关添加关键帧' })); fireEvent.click(view.getByRole('switch', { name: '开关关键帧1值' }))
  expect(editor().curves.flag[0]).toMatchObject({ value: true, interpolation: 'hold' })
  expect(view.queryByRole('button', { name: '开关关键帧1插值' })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: '为文字添加关键帧' }))
  const value = view.getByRole('textbox', { name: '文字关键帧1值' }); fireEvent.focus(value); fireEvent.change(value, { target: { value: '关键帧文字' } }); fireEvent.blur(value)
  expect(editor().curves.caption[0]).toMatchObject({ value: '关键帧文字', interpolation: 'hold' }); expect(onError).not.toHaveBeenCalled()
})

it('已有关键帧按需展开，取消后未聚焦的数值步进仍可开始新编辑', () => {
  addVideoEditCodeKeyframe(editor().target, 'amount', time(0)); addVideoEditCodeKeyframe(editor().target, 'amount', time(1000000))
  const view = render(<View />)
  expect(view.queryByRole('spinbutton', { name: '强度关键帧1时间（秒）' })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: '展开强度关键帧' }))
  expect(view.getByRole('spinbutton', { name: '强度关键帧2时间（秒）' })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '收起强度关键帧' }))
  const range = view.getByRole('slider', { name: '强度滑杆' }); fireEvent.pointerDown(range); fireEvent.change(range, { target: { value: '8' } }); fireEvent.keyDown(range, { key: 'Escape' })
  const number = view.getByRole('spinbutton', { name: '强度' }); const history = owner.past.length
  const increase = number.closest('[data-ui-field-control]')!.querySelector('[aria-label="增加数值"]')!
  fireEvent.click(increase)
  expect(editor().parameters.amount).toBe(5.25); expect(owner.past).toHaveLength(history + 1); expect(onError).not.toHaveBeenCalled()
})
