import { createVideoEditTestProject as createVideoEditProject } from '../application/videoEditDocumentTestKit'
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { appendVideoEditClip, appendVideoEditMedia, beginVideoEditGesture, closeVideoEditProject, editVideoProject, finishVideoEditGesture, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit, updateVideoEditGesture, updateVideoEditMaskGesture } from '../application/videoEditService'
import { applyVideoEditBuiltinEffect, updateVideoEditBuiltinEffect } from '../application/videoEditCompositing'
import { getVideoEditMaskEditing, setVideoEditMaskEditing } from '../application/videoEditMaskEditing'
import { createVideoEditMaskShape, type VideoEditMaskShape } from '@/core/videoEdit/effectMasks'
import { VideoEditMaskOverlay } from './VideoEditMaskOverlay'

vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))

beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/masks.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  // jsdom 没有布局与指针捕获：节目画面按 1920×480 显示（序列 1920×1080 被拉伸，验证按显示框换算）。
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) })
})
afterEach(async () => {
  cleanup(); setVideoEditMaskEditing(null)
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})

async function fixture(kind: 'rect' | 'ellipse' = 'rect') {
  const owner = (await createVideoEditProject())!; const projectId = owner.document.id
  appendVideoEditMedia(projectId, { id:'m',name:'素材',path:'/media/a.mp4',kind:'video',durationSeconds:20,width:1920,height:1080 })
  appendVideoEditClip(projectId,'m')
  const sequence = getActiveVideoEditSequence(owner); const clip = sequence.clips.find(value=>value.kind==='video')!
  const [effectId] = applyVideoEditBuiltinEffect(projectId,sequence.id,[clip.id],'gaussian_blur')
  const target = {projectId,sequenceId:sequence.id,clipId:clip.id,effectId}
  const shape = createVideoEditMaskShape(kind,'shape')
  updateVideoEditBuiltinEffect(target,effectId,{mask:{regionId:'shapes',shapes:[shape]}})
  setVideoEditMaskEditing({...target,shapeId:shape.id})
  const onError = vi.fn()
  const unhandledKey = vi.fn()
  const view = render(<div onKeyDown={unhandledKey}><VideoEditMaskOverlay instance={owner} onError={onError}/></div>)
  const svg = view.container.querySelector('svg')!
  const vertex = (index:number) => view.container.querySelector(`[data-video-edit-mask-handle="vertex-${index}"]`)!
  const read = (): VideoEditMaskShape => {
    const mask = getActiveVideoEditSequence(owner).clips.find(value=>value.id===clip.id)!.effects![0].mask!
    if (mask.regionId!=='shapes') throw new Error('没有手绘遮罩')
    return mask.shapes[0]
  }
  const down = (element: Element,x:number,y:number,modifiers: Record<string,boolean> = {}) => fireEvent.pointerDown(element,{button:0,pointerId:1,clientX:x,clientY:y,...modifiers})
  const move = (x:number,y:number,modifiers: Record<string,boolean> = {}) => fireEvent.pointerMove(svg,{pointerId:1,clientX:x,clientY:y,...modifiers})
  const up = (x:number,y:number,modifiers: Record<string,boolean> = {}) => fireEvent.pointerUp(svg,{pointerId:1,clientX:x,clientY:y,...modifiers})
  const key = (key:string,modifiers: Record<string,boolean> = {}) => fireEvent.keyDown(svg,{key,code:key==='t' ? 'KeyT' : key,...modifiers})
  return {owner,projectId,target,view,svg,shape,vertex,read,down,move,up,key,onError,unhandledKey}
}

it('局部遮罩手势保留未改数据引用，输入隔离，拒绝缺失跟踪、非法路径、锁定与失效句柄', async () => {
  const f=await fixture(); const before=f.owner.document
  const handle=beginVideoEditGesture(f.projectId)
  const input=createVideoEditMaskShape('ellipse','shape')
  act(()=>{updateVideoEditMaskGesture(handle,f.target.sequenceId,f.target.clipId,f.target.effectId,{regionId:'shapes',shapes:[input]})})
  expect(f.owner.document.media).toBe(before.media)
  expect(f.owner.document.items).toBe(before.items)
  const stable=f.owner.document
  input.points[0][0]=1.5
  expect(f.read().points[0][0]).toBe(.5)
  expect(()=>updateVideoEditMaskGesture(handle,f.target.sequenceId,f.target.clipId,f.target.effectId,{regionId:'tracker',trackerId:'missing'})).toThrow()
  expect(()=>updateVideoEditMaskGesture(handle,f.target.sequenceId,f.target.clipId,f.target.effectId,{regionId:'shapes',shapes:[{...input,points:[]}]})).toThrow()
  expect(f.owner.document).toBe(stable)
  act(()=>finishVideoEditGesture(handle))
  expect(()=>updateVideoEditMaskGesture(handle,f.target.sequenceId,f.target.clipId,f.target.effectId,null)).toThrow('已结束')
  act(()=>{editVideoProject(f.projectId,document=>({...document,sequences:document.sequences.map(sequence=>({...sequence,tracks:sequence.tracks.map(track=>({...track,locked:true}))}))}))})
  const locked=beginVideoEditGesture(f.projectId)
  expect(()=>updateVideoEditMaskGesture(locked,f.target.sequenceId,f.target.clipId,f.target.effectId,null)).toThrow('锁定')
  act(()=>finishVideoEditGesture(locked,false))
})

it('遮罩回到初值不增加历史并保留最后预览；混合普通写入仍完整提交', async () => {
  const f=await fixture(); const history=f.owner.past.length
  const handle=beginVideoEditGesture(f.projectId)
  act(()=>{updateVideoEditMaskGesture(handle,f.target.sequenceId,f.target.clipId,f.target.effectId,{regionId:'shapes',shapes:[createVideoEditMaskShape('ellipse','shape')]})})
  act(()=>{updateVideoEditMaskGesture(handle,f.target.sequenceId,f.target.clipId,f.target.effectId,{regionId:'shapes',shapes:[f.shape]})})
  const preview=f.owner.document
  act(()=>finishVideoEditGesture(handle))
  expect(f.owner.document).toBe(preview); expect(f.owner.past.length).toBe(history)
  const mixed=beginVideoEditGesture(f.projectId)
  act(()=>{updateVideoEditGesture(mixed,document=>({...document,sequences:document.sequences.map(sequence=>({...sequence,clips:sequence.clips.map(clip=>({...clip,x:.1}))}))}))})
  act(()=>{updateVideoEditMaskGesture(mixed,f.target.sequenceId,f.target.clipId,f.target.effectId,{regionId:'shapes',shapes:[f.shape]})})
  act(()=>finishVideoEditGesture(mixed))
  expect(getActiveVideoEditSequence(f.owner).clips[0].x).toBe(.1); expect(f.owner.past.length).toBe(history+1)
})

it('点击选点、选中突出、空白取消，不写文档；双击不再转换；Ctrl/Alt/Shift 光标变化', async () => {
  const f=await fixture(); const before=f.owner.document
  f.down(f.vertex(0),576,324); f.up(576,324)
  expect(f.vertex(0).getAttribute('data-selected')).toBe('true')
  expect(f.vertex(1).getAttribute('data-selected')).toBe('false')
  expect(f.owner.document).toBe(before)
  fireEvent.doubleClick(f.vertex(0))
  expect(f.read()).toEqual(f.shape)
  act(()=>{f.svg.blur()}); fireEvent.pointerEnter(f.svg)
  fireEvent.keyDown(window,{key:'Alt',altKey:true}); expect(f.svg.classList.contains('cursor-crosshair')).toBe(true)
  f.key('Alt',{altKey:true}); expect(f.svg.classList.contains('cursor-crosshair')).toBe(true)
  fireEvent.keyUp(f.svg,{key:'Control',ctrlKey:true}); expect(f.svg.classList.contains('cursor-not-allowed')).toBe(true)
  fireEvent.keyUp(f.svg,{key:'Shift',shiftKey:true}); expect(f.svg.classList.contains('cursor-copy')).toBe(true)
  f.down(f.svg,50,50)
  expect(f.vertex(0).getAttribute('data-selected')).toBe('false')
  expect(f.owner.document).toBe(before)
})

it('指针按 rAF 合并，最后 pointerup 值立即提交；松手保留预览，一次手势一步撤销', async () => {
  const f=await fixture(); const callbacks=new Map<number,FrameRequestCallback>(); let next=0
  vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{callbacks.set(++next,callback);return next})
  vi.spyOn(window,'cancelAnimationFrame').mockImplementation(id=>{callbacks.delete(id)})
  const initial=f.owner.document; const history=f.owner.past.length
  f.down(f.vertex(2),1344,756)
  f.move(1400,800); f.move(1440,810)
  expect(f.owner.document).toBe(initial); expect(callbacks.size).toBe(1)
  act(()=>{const callback=[...callbacks.values()][0];callbacks.clear();callback(16)})
  expect(f.owner.document.revision).toBe(initial.revision+1)
  expect(f.read().points[2][0]).toBeCloseTo(.75)
  const preview=f.owner.document
  f.up(1440,810)
  expect(f.owner.document).toBe(preview)
  expect(f.owner.past.length).toBe(history+1)
  expect(callbacks.size).toBe(0)
  act(()=>undoVideoEdit(f.projectId))
  expect(f.read()).toEqual(f.shape)
  f.down(f.vertex(2),1344,756); f.move(1400,800); f.up(1536,864)
  expect(f.read().points[2].slice(0,2)).toEqual([expect.closeTo(.8),expect.closeTo(.8)])
  expect(callbacks.size).toBe(0)
})

it('Shift 插点、Ctrl 减点、Delete 下限与方向微移都独立撤销，不传播监视器 Delete', async () => {
  const f=await fixture()
  const path=f.view.container.querySelector('[data-video-edit-mask-shape]')!
  const history=f.owner.past.length
  f.down(path,960,324,{shiftKey:true}); f.up(960,324,{shiftKey:true})
  expect(f.read().points.length).toBe(5); expect(getVideoEditMaskEditing()?.pointIndex).toBe(1)
  expect(f.owner.past.length).toBe(history+1)
  f.down(f.vertex(1),960,324,{ctrlKey:true}); expect(f.read().points.length).toBe(4)
  f.down(f.vertex(0),576,324); f.up(576,324); f.key('ArrowRight',{shiftKey:true})
  expect(f.read().points[0][0]).toBeCloseTo(.3+10/1920)
  f.key('Delete'); expect(f.read().points.length).toBe(3)
  expect(f.unhandledKey).not.toHaveBeenCalled()
  f.down(f.vertex(0),1344,324); f.up(1344,324); f.key('Delete')
  expect(f.read().points.length).toBe(3); expect(String(f.onError.mock.lastCall?.[0])).toContain('至少')
})

it('Alt 点转平滑，Alt 拖出对称柄，单侧 Alt 拖只动该柄；移动顶点带两柄', async () => {
  const f=await fixture()
  f.down(f.vertex(0),576,324,{altKey:true}); f.up(576,324,{altKey:true})
  expect(f.read().points[0].slice(2).some(Boolean)).toBe(true)
  f.down(f.vertex(0),576,324,{altKey:true}); f.move(768,432,{altKey:true}); f.up(768,432,{altKey:true})
  expect(f.read().points[0].slice(2)).toEqual([expect.closeTo(-.1),expect.closeTo(-.1),expect.closeTo(.1),expect.closeTo(.1)])
  const incoming=f.read().points[0].slice(2,4)
  const handle=f.view.container.querySelector('[data-video-edit-mask-handle="out-0"]')!
  f.down(handle,768,432,{altKey:true}); f.up(960,540,{altKey:true})
  expect(f.read().points[0].slice(2,4)).toEqual(incoming)
  expect(f.read().points[0].slice(4)).toEqual([expect.closeTo(.2),expect.closeTo(.2)])
  const offsets=f.read().points[0].slice(2)
  f.down(f.vertex(0),576,324); f.up(672,378)
  expect(f.read().points[0].slice(2)).toEqual(offsets)
  expect(f.read().points[0].slice(0,2)).toEqual([expect.closeTo(.35),expect.closeTo(.35)])
})

it('Ctrl+T 八柄与旋转，Shift 等比缩放与移动整体共用一步历史；Enter 确认，Esc 取消，框外确认', async () => {
  const f=await fixture(); const history=f.owner.past.length
  f.key('t',{ctrlKey:true})
  expect(f.view.container.querySelectorAll('[data-video-edit-mask-transform-handle]')).toHaveLength(9)
  const corner=f.view.container.querySelector('[data-video-edit-mask-transform-handle="4"]')!
  f.down(corner,1344,756); f.up(1536,864,{shiftKey:true})
  expect(f.owner.past.length).toBe(history)
  expect(f.read().points[2].slice(0,2)).toEqual([expect.closeTo(.8),expect.closeTo(.8)])
  f.down(f.svg,960,540); f.up(1056,594)
  const preview=f.owner.document
  f.key('Enter')
  expect(f.owner.document).toBe(preview); expect(f.owner.past.length).toBe(history+1)
  expect(f.view.container.querySelector('[data-video-edit-mask-transform]')).toBeNull()
  act(()=>undoVideoEdit(f.projectId)); expect(f.read()).toEqual(f.shape)
  f.key('t',{ctrlKey:true})
  f.down(f.view.container.querySelector('[data-video-edit-mask-transform-handle="4"]')!,1344,756); f.up(1440,864)
  f.key('Escape'); expect(f.read()).toEqual(f.shape); expect(f.owner.past.length).toBe(history)
  f.key('t',{ctrlKey:true})
  f.down(f.view.container.querySelector('[data-video-edit-mask-transform-handle="rotate"]')!,960,216); f.up(1284,540)
  expect(f.read()).not.toEqual(f.shape)
  f.down(f.svg,50,50)
  expect(f.view.container.querySelector('[data-video-edit-mask-transform]')).toBeNull()
  expect(f.owner.past.length).toBe(history+1)
})

it('更换效果/片段取消正在进行的拖动与变换，不遗留延迟更新', async () => {
  const f=await fixture()
  f.down(f.vertex(0),576,324); f.up(672,378)
  const before=f.read()
  f.key('t',{ctrlKey:true}); f.down(f.view.container.querySelector('[data-video-edit-mask-transform-handle="4"]')!,1344,756); f.up(1440,864)
  act(()=>setVideoEditMaskEditing(null))
  expect(f.read()).toEqual(before)
  expect(f.owner.past.length).toBeGreaterThan(0)
})

it('钢笔：逐点画、按住拖出控制柄、点回起点闭合成遮罩（一步撤销）；选中后拖顶点改路径', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'm1', name: '素材', path: 'D:/media/a.mp4', kind: 'video', durationSeconds: 20, width: 1920, height: 1080 })
  appendVideoEditClip(id, 'm1')
  const sequence = getActiveVideoEditSequence(owner); const clip = sequence.clips.find(entry => entry.kind === 'video')!
  const [effectId] = applyVideoEditBuiltinEffect(id, sequence.id, [clip.id], 'gaussian_blur')
  const target = { projectId: id, sequenceId: sequence.id, clipId: clip.id, effectId }
  setVideoEditMaskEditing({ ...target, pen: true })
  const view = render(<VideoEditMaskOverlay instance={owner} onError={error => { throw error }} />)
  const svg = view.container.querySelector('[data-video-edit-mask-overlay="pen"]')!
  const click = (x: number, y: number, dragTo?: [number, number]): void => {
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: x, clientY: y })
    if (dragTo) fireEvent.pointerMove(svg, { pointerId: 1, clientX: dragTo[0], clientY: dragTo[1] })
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: dragTo?.[0] ?? x, clientY: dragTo?.[1] ?? y })
  }
  click(192, 108); click(960, 108, [1152, 108]); click(960, 540)
  click(193, 109) // 回到起点：闭合
  const effect = (): NonNullable<ReturnType<typeof getActiveVideoEditSequence>['clips'][number]['effects']>[number] => getActiveVideoEditSequence(owner).clips.find(entry => entry.id === clip.id)!.effects![0]
  const mask = effect().mask
  expect(mask?.regionId).toBe('shapes')
  const shape = mask?.regionId === 'shapes' ? mask.shapes[0] : undefined
  expect(shape?.kind).toBe('path')
  expect(shape?.points?.map(point => point.map(value => Math.round(value * 100) / 100 + 0))).toEqual([[0.1, 0.1, 0, 0, 0, 0], [0.5, 0.1, -0.1, 0, 0.1, 0], [0.5, 0.5, 0, 0, 0, 0]])
  // 闭合后进入编辑：拖第三个顶点
  const handle = view.container.querySelector('[data-video-edit-mask-handle="vertex-2"]')!
  fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 960, clientY: 540 })
  fireEvent.pointerMove(view.container.querySelector('svg')!, { pointerId: 2, clientX: 1344, clientY: 756 })
  fireEvent.pointerUp(view.container.querySelector('svg')!, { pointerId: 2, clientX: 1344, clientY: 756 })
  const edited = effect().mask
  expect(edited?.regionId === 'shapes' && edited.shapes[0].points![2].slice(0, 2).map(value => Math.round(value * 100) / 100)).toEqual([0.7, 0.7])
  undoVideoEdit(id)
  const undone = effect().mask
  expect(undone?.regionId === 'shapes' && undone.shapes[0].points![2].slice(0, 2).map(value => Math.round(value * 100) / 100)).toEqual([0.5, 0.5])
  undoVideoEdit(id)
  expect(effect().mask).toBeUndefined()
})
