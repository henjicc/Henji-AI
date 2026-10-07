// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { BLACK_HEX } from '@/core/theme/colorTokens'
import { codeElementOrientedPolygon } from '@/core/videoEdit/codeElementManipulation'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createVideoEditTestProject, reopenVideoEdit } from './application/videoEditDocumentTestKit'
import { closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, saveVideoEdit, setVideoEditView, undoVideoEdit, type VideoEditInstance } from './application/videoEditService'
import { rememberVideoEditCodeMetadata, readVideoEditCodeMetadata } from './application/videoEditCodeState'
import { selectVideoEditCodeElement, selectedVideoEditCodeElement } from './application/videoEditCodeElements'
import { bakeVideoEditCodeElement, readVideoEditCodeElementEdit, resetVideoEditCodeElement, setVideoEditCodeElementAutoKeyframes, showVideoEditCodeElementSource, updateVideoEditCodeElement, videoEditCodeElementHostSummary, videoEditCodeElementOverrideSummary } from './application/videoEditCodeElementEditing'
import { readVideoEditCodeEditor } from './application/videoEditCodeParameters'
import { CodeSourceEditor } from './panels/CodeSourceEditor'
import { VideoEditCodeElementsPanel } from './panels/VideoEditCodeElementsPanel'
import { VideoEditCodeElementOverlay } from './VideoEditCodeElementOverlay'

// Only compiler-worker/GPU trial boundaries are substituted; parsing, document,
// application registry, gestures, immutable versions and storage are real.
vi.mock('./engine/videoEditCodeCompiler', async () => ({ VideoEditCodeCompiler: class {
  async compile(source: string) { return compileCodeMaterial(source) }
  dispose() {}
} }))
vi.mock('./engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))
const source = 'export default {apiVersion:1,languageVersion:3,name:"元素编辑",kind:"generator",mode:"static",width:1920,height:1080,durationSeconds:10,seed:1,parameters:{title:{type:"text",title:"文字",default:"原文",maxLength:100,animatable:false}},render(ctx){return [rect({id:"box",x:100,y:100,width:200,height:100,fill:[1,1,1,1]}),text({id:"title",x:400,y:100,text:ctx.params.title,fontSize:40,baseline:"top",fill:[1,1,1,1]})];}}'
let owner: VideoEditInstance; let clipId: string
const target = (elementId = 'box') => ({ projectId: owner.document.id, sequenceId: owner.activeSequenceId, clipId, versionId: 'version', elementId })
const clip = () => getActiveVideoEditSequence(owner).clips.find(value => value.id === clipId)!
beforeEach(async () => {
  installHarnessNativeStorage()
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 16); return { width: text.length * size, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * size } } } } })
  owner = await createVideoEditTestProject()
  rememberVideoEditCodeMetadata(owner, 'definition', { id: 'version', source, apiVersion: 1, languageVersion: 3 }, compileCodeMaterial(source))
  editVideoProject(owner.document.id, document => {
    document.codeMaterials = [{ id: 'definition', name: '元素编辑', defaultVersionId: 'version', versions: [{ id: 'version', source, apiVersion: 1, languageVersion: 3 }] }]
    document.items.push({ id: 'item', name: '元素编辑', kind: 'code', code: { definitionId: 'definition', versionId: 'version', parameters: {} } })
    const value = makeVideoEditItemClip(document, 'item', owner.activeSequenceId, { frame: 0 }, readVideoEditCodeMetadata(owner, document)); clipId = value.id; document.sequences[0].clips.push(value); return document
  })
  setVideoEditView(owner.document.id, { selection: clipId }); selectVideoEditCodeElement(owner, clipId, 'box')
})
afterEach(async () => { cleanup(); for (const value of listVideoEditInstances()) await closeVideoEditProject(value.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
function view() {
  const onError = vi.fn(); const result = render(<VideoEditCodeElementOverlay instance={owner} enabled onError={onError} />)
  vi.spyOn(result.getByLabelText('代码元素变换层'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1920, 1080))
  return { ...result, onError }
}
function pointer(element: Element, type: string, x: number, y: number, shiftKey = false) { fireEvent(element, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, shiftKey })) }
it('移动和方向键一次手势一次撤销；Esc回滚未提交动作', () => {
  const result = view(); const before = owner.past.length; const root = result.getByLabelText('代码元素变换层'); const body = result.container.querySelector('[data-code-element-edit-body]')!
  pointer(body, 'pointerdown', 200, 150); pointer(root, 'pointermove', 220, 175); pointer(root, 'pointermove', 240, 180); pointer(root, 'pointerup', 240, 180)
  expect(clip().elementOverrides?.box.dx).toBeCloseTo(40); expect(clip().elementOverrides?.box.dy).toBeCloseTo(30); expect(owner.past).toHaveLength(before + 1)
  fireEvent.keyDown(root, { key: 'ArrowRight' }); fireEvent.keyDown(root, { key: 'ArrowRight', repeat: true }); fireEvent.keyUp(root, { key: 'ArrowRight' })
  expect(clip().elementOverrides?.box.dx).toBeCloseTo(42); expect(owner.past).toHaveLength(before + 2)
  act(() => undoVideoEdit(owner.document.id)); expect(clip().elementOverrides?.box.dx).toBeCloseTo(40)
  pointer(body, 'pointerdown', 240, 180); pointer(root, 'pointermove', 280, 190); fireEvent.keyDown(root, { key: 'Escape' }); expect(clip().elementOverrides?.box.dx).toBeCloseTo(40); expect(clip().elementOverrides?.box.dy).toBeCloseTo(30); expect(owner.past).toHaveLength(before + 1)
  expect(result.onError).not.toHaveBeenCalled()
})
it('角点缩放固定对角；Shift等比与旋转分别提交一步撤销', () => {
  const result = view(); const before = owner.past.length; const root = result.getByLabelText('代码元素变换层')
  pointer(result.getByLabelText('缩放元素角3'), 'pointerdown', 300, 200); pointer(root, 'pointermove', 500, 300, true); pointer(root, 'pointerup', 500, 300, true)
  expect(clip().elementOverrides?.box.scaleX).toBeCloseTo(2); expect(clip().elementOverrides?.box.scaleY).toBeCloseTo(2); expect(clip().elementOverrides?.box.dx).toBeCloseTo(100); expect(clip().elementOverrides?.box.dy).toBeCloseTo(50)
  const selected = selectedVideoEditCodeElement(owner)!; const polygon = codeElementOrientedPolygon(selected.element, selected.entry.clip, selected.entry.picture, getActiveVideoEditSequence(owner))
  expect(polygon[0].x * 1920).toBeCloseTo(100); expect(polygon[0].y * 1080).toBeCloseTo(100)
  pointer(result.getByLabelText('旋转元素'), 'pointerdown', 300, 100); pointer(root, 'pointermove', 400, 200); pointer(root, 'pointerup', 400, 200)
  expect(clip().elementOverrides?.box.rotation).toBeCloseTo(90); expect(owner.past).toHaveLength(before + 2); expect(result.onError).not.toHaveBeenCalled()
})
it('吸附画面中心和安全框，Alt取消吸附；失去指针和切帧取消手势', () => {
  const result = view(); const root = result.getByLabelText('代码元素变换层'); const body = result.container.querySelector('[data-code-element-edit-body]')!
  owner.snapping = true
  pointer(body, 'pointerdown', 200, 150); pointer(root, 'pointermove', 958, 150)
  expect(result.container.querySelector('[data-code-element-guide="x"]')).toBeTruthy(); expect(clip().elementOverrides?.box.dx).toBeCloseTo(760)
  fireEvent(root, new MouseEvent('pointermove', { bubbles: true, clientX: 958, clientY: 150, altKey: true })); expect(clip().elementOverrides?.box.dx).toBeCloseTo(758)
  pointer(root, 'pointercancel', 958, 150); expect(clip().elementOverrides).toBeUndefined()
  pointer(body, 'pointerdown', 200, 150); pointer(root, 'pointermove', 200, 152); expect(result.container.querySelector('[data-code-element-guide="y"]')).toBeTruthy()
  act(() => setVideoEditView(owner.document.id, { frame: 30 })); expect(clip().elementOverrides).toBeUndefined(); expect(result.onError).not.toHaveBeenCalled()
})
it('双击参数文字直接写参数；Enter提交、Esc取消，与覆盖共用撤销栈', () => {
  selectVideoEditCodeElement(owner, clipId, 'title'); const result = view(); const body = result.container.querySelector('[data-code-element-edit-body]')!; const before = owner.past.length
  fireEvent.doubleClick(body); const input = result.getByLabelText('原地编辑代码文字'); fireEvent.change(input, { target: { value: '改文案' } }); fireEvent.keyDown(input, { key: 'Enter' })
  expect(clip().code!.parameters.title).toBe('改文案'); expect(clip().elementOverrides).toBeUndefined(); expect(owner.past).toHaveLength(before + 1)
  fireEvent.doubleClick(body); fireEvent.change(result.getByLabelText('原地编辑代码文字'), { target: { value: '取消' } }); fireEvent.keyDown(result.getByLabelText('原地编辑代码文字'), { key: 'Escape' }); expect(clip().code!.parameters.title).toBe('改文案')
  act(() => undoVideoEdit(owner.document.id)); expect(clip().code!.parameters.title).toBeUndefined(); expect(result.onError).not.toHaveBeenCalled()
})
it('默认静态，显式开启的属性按当前源时刻打帧；关闭冻结当前值', () => {
  updateVideoEditCodeElement(target(), { dx: 10 }); expect(clip().elementOverrides?.box.curves).toBeUndefined()
  setVideoEditCodeElementAutoKeyframes(target(), true); setVideoEditView(owner.document.id, { frame: 30 }); updateVideoEditCodeElement(target(), { dx: 110 })
  expect(clip().elementOverrides?.box.curves?.dx).toHaveLength(2)
  setVideoEditView(owner.document.id, { frame: 15 }); expect(readVideoEditCodeElementEdit(target()).values.dx).toBeCloseTo(60)
  setVideoEditCodeElementAutoKeyframes(target(), false); expect(clip().elementOverrides?.box).toMatchObject({ dx: 60 }); expect(clip().elementOverrides?.box.curves).toBeUndefined()
})
it('效果控件复用文字面板，字号/字重/颜色写覆盖并可撤销，不改参数文字', () => {
  selectVideoEditCodeElement(owner, clipId, 'title'); const onError = vi.fn()
  const result = render(<VideoEditCodeElementsPanel instance={owner} clipId={clipId} onError={onError} />)
  expect(result.queryByLabelText('全部大写')).toBeNull()
  const size = result.getByLabelText('文字字号'); fireEvent.focus(size); fireEvent.change(size, { target: { value: '80' } }); fireEvent.blur(size)
  const weight = result.getByLabelText('文字字重'); fireEvent.focus(weight); fireEvent.change(weight, { target: { value: '700' } }); fireEvent.blur(weight)
  const beforeColor = owner.past.length; const color = result.getByLabelText('文字填充颜色'); fireEvent.focus(color); fireEvent.change(color, { target: { value: BLACK_HEX } }); fireEvent.blur(color)
  expect(clip().elementOverrides?.title).toMatchObject({ fontSize: 80, fontWeight: 700, fill: [0,0,0,1] }); expect(clip().code!.parameters.title).toBeUndefined(); expect(owner.past).toHaveLength(beforeColor + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(clip().elementOverrides?.title.fill).toBeUndefined(); expect(onError).not.toHaveBeenCalled()
})
it('查看源码可等待效果控件挂载，并展开及定位当前元素', () => {
  showVideoEditCodeElementSource(target())
  const result = render(<CodeSourceEditor editor={readVideoEditCodeEditor(owner.document.id, owner.activeSequenceId, clipId)} />)
  const input = result.getByLabelText('代码素材源码') as HTMLTextAreaElement
  expect(input.selectionStart).toBe(selectedVideoEditCodeElement(owner)!.element.sourceSpan!.start)
})
it('助手通用实体原子读写、拒绝无效值与锁定、撤销和保存重开；失效覆盖可清除', async () => {
  const app = createApplicationHarness(); const ref = { kind: 'video_edit.clip', id: `${owner.document.id}:${clipId}` }; const before = owner.past.length
  expect(await app.change(ref, { 'video_edit.clip.element_overrides': { box: { dx: 20, fill: [1,0,0,1] }, gone: { hidden: true } } })).toMatchObject({ ok: true })
  expect((await app.read(ref, ['video_edit.clip.element_overrides'])).properties).toMatchObject({ 'video_edit.clip.element_overrides': { box: { dx: 20 } } }); expect(owner.past).toHaveLength(before + 1)
  expect(videoEditCodeElementHostSummary(owner.document.id)).toMatchObject({ count: 2, items: [{ elementId: 'box', missing: false }, { elementId: 'gone', missing: true }] })
  expect((await app.change(ref, { 'video_edit.clip.element_overrides': { box: { scale: -2 } } })).ok).toBe(false)
  editVideoProject(owner.document.id, document => { document.sequences[0].tracks.find(track => track.index === clip().track)!.locked = true; return document })
  expect((await app.change(ref, { 'video_edit.clip.element_overrides': {} })).ok).toBe(false); undoVideoEdit(owner.document.id)
  await saveVideoEdit(owner.document.id); owner = await reopenVideoEdit(owner.document.id)
  expect(clip().elementOverrides?.box.dx).toBe(20); expect(videoEditCodeElementOverrideSummary(owner.document.id, owner.activeSequenceId, clipId).find(value => value.elementId === 'gone')?.missing).toBe(true)
  resetVideoEditCodeElement(target('gone')); expect(clip().elementOverrides?.gone).toBeUndefined(); undoVideoEdit(owner.document.id); expect(clip().elementOverrides?.gone).toEqual({ hidden: true })
})
it('确定性写回创建新版本并清除覆盖同一步撤销；复杂坐标创建助手标注', async () => {
  updateVideoEditCodeElement(target(), { dx: 20, fill: [1,0,0,1] }); const before = owner.past.length
  expect(await bakeVideoEditCodeElement(target())).toBe('baked'); expect(clip().elementOverrides).toBeUndefined(); expect(clip().code!.versionId).not.toBe('version'); expect(owner.document.codeMaterials![0].versions[0].source).toBe(source); expect(owner.past).toHaveLength(before + 1)
  undoVideoEdit(owner.document.id); expect(clip().code!.versionId).toBe('version'); expect(clip().elementOverrides?.box.dx).toBe(20)
  updateVideoEditCodeElement(target(), { scale: 2 }); expect(await bakeVideoEditCodeElement(target())).toBe('assistant')
  const mark = getActiveVideoEditSequence(owner).annotations.at(-1)!; expect(mark.text).toContain('请把这些覆盖写回源码'); expect(mark.target).toMatchObject({ kind: 'element', elementId: 'box' }); expect(clip().elementOverrides?.box.scale).toBe(2)
})
