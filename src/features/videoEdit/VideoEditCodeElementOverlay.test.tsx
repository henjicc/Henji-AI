// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { codeElementFramePolygon } from '@/core/videoEdit/codeElementSelection'
import { createVideoEditTestProject } from './application/videoEditDocumentTestKit'
import { editVideoProject, getActiveVideoEditSequence, setVideoEditView, setVideoEditTimelineView, listVideoEditInstances, closeVideoEditProject, type VideoEditInstance } from './application/videoEditService'
import { readVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from './application/videoEditCodeState'
import { hitVideoEditCodeElement, selectedVideoEditCodeElement, selectVideoEditCodeElement, videoEditCodeElementFrames, resolveVideoEditElementAnnotation, videoEditSelectedCodeElementContext } from './application/videoEditCodeElements'
import { readVideoEditCodeEditor } from './application/videoEditCodeParameters'
import { readVideoEditData } from './application/videoEditReflection'
import { CodeSourceEditor } from './panels/CodeSourceEditor'
import { CodeParameterPanel } from './panels/CodeParameterPanel'
import { VideoEditCodeElementOverlay } from './VideoEditCodeElementOverlay'
import { VideoEditAnnotationOverlay } from './VideoEditAnnotationOverlay'
import { invalidateCodeTextMetrics } from './videoEditGlyphMetrics'

const source = (body: string): string => `export default {apiVersion:1,languageVersion:3,name:"标题",kind:"generator",mode:"dynamic",width:1920,height:1080,durationSeconds:10,seed:1,parameters:{title:{type:"text",title:"标题文字",default:"你好",maxLength:100,animatable:false}},render(ctx){${body}}}`
const original = source('\n'.repeat(20) + 'return [group({id:"标题组",x:ctx.time*100,y:0},[rect({id:"底板",x:100,y:100,width:400,height:200,fill:[1,1,1,1]}),text({id:"标题",x:120,y:120,text:ctx.params.title,fontSize:48,baseline:"top",fill:[0,0,0,1]})])];')
let owner: VideoEditInstance; let clipId: string; let fontScale = 1
beforeEach(async () => {
  installHarnessNativeStorage()
  fontScale = 1
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 16) * fontScale; return { width: text.length * size, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * size } } } } })
  owner = await createVideoEditTestProject()
  const program = compileCodeMaterial(original)
  rememberVideoEditCodeMetadata(owner, 'definition', { id: 'version', source: original, apiVersion: 1, languageVersion: 3 }, program)
  editVideoProject(owner.document.id, document => {
    document.codeMaterials = [{ id: 'definition', name: '标题', defaultVersionId: 'version', versions: [{ id: 'version', source: original, apiVersion: 1, languageVersion: 3 }] }]
    document.items.push({ id: 'code-item', name: '标题', kind: 'code', code: { definitionId: 'definition', versionId: 'version', parameters: {} } })
    const clip = makeVideoEditItemClip(document, 'code-item', owner.activeSequenceId, { frame: 0 }, readVideoEditCodeMetadata(owner, document)); clipId = clip.id
    document.sequences[0].clips.push(clip); return document
  })
  setVideoEditView(owner.document.id, { selection: clipId })
})
afterEach(async () => { cleanup(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
function titlePoint(): { x: number; y: number } {
  const entry = videoEditCodeElementFrames(owner).get(clipId)!; const bound = entry.index.byId.get('标题')!
  const polygon = codeElementFramePolygon(bound, entry.clip, entry.picture, getActiveVideoEditSequence(owner))
  return { x: (polygon[0].x + polygon[2].x) / 2, y: (polygon[0].y + polygon[2].y) / 2 }
}
it('叠层点选/悬停/重复与Alt循环，片段和参数联动，不产生内容撤销', () => {
  const onError = vi.fn(); const view = render(<div><VideoEditCodeElementOverlay instance={owner} enabled onError={onError} /><CodeParameterPanel projectId={owner.document.id} sequenceId={owner.activeSequenceId} clipId={clipId} onError={onError} /></div>)
  const host = view.getByLabelText('代码元素选择层').parentElement!
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000))
  const at = titlePoint(); const dispatch = (type: string, extra = {}): void => { fireEvent(host, new MouseEvent(type, { clientX: at.x * 1000, clientY: at.y * 1000, bubbles: true, ...extra })) }
  const before = owner.past.length
  dispatch('pointermove'); expect(view.container.querySelector('[data-code-element-hover]')).toBeTruthy()
  dispatch('pointerdown'); expect(owner.selection).toBe(clipId); expect(selectedVideoEditCodeElement(owner)?.element.elementId).toBe('标题')
  expect(view.getByLabelText('已选元素').textContent).toContain('标题')
  expect(view.container.querySelector('[data-code-element-parameter="true"]')?.getAttribute('data-video-edit-code-parameter')).toBe('title')
  dispatch('pointerdown'); expect(selectedVideoEditCodeElement(owner)?.element.elementId).toBe('标题组')
  dispatch('pointerdown', { altKey: true }); expect(selectedVideoEditCodeElement(owner)?.element.elementId).toBe('底板')
  expect(owner.past).toHaveLength(before); expect(onError).not.toHaveBeenCalled()
})
it('画面选择滚动并高亮sourceSpan，源码光标反选调用且保留光标位置；未应用源码不映射', () => {
  const editor = readVideoEditCodeEditor(owner.document.id, owner.activeSequenceId, clipId)
  const view = render(<CodeSourceEditor editor={editor} />)
  act(() => selectVideoEditCodeElement(owner, clipId, '标题'))
  fireEvent.click(view.getByRole('button', { name: '查看与编辑源码' }))
  const input = view.getByLabelText('代码素材源码') as HTMLTextAreaElement
  const span = selectedVideoEditCodeElement(owner)!.element.sourceSpan!
  expect(input.selectionStart).toBe(span.start); expect(input.selectionEnd).toBe(span.end)
  expect(input.scrollTop).toBeGreaterThan(0)
  expect(view.getByLabelText('选中元素源码').textContent).toBe(original.slice(span.start, span.end))
  input.focus(); input.setSelectionRange(original.indexOf('width:400'), original.indexOf('width:400'))
  fireEvent.click(input)
  expect(selectedVideoEditCodeElement(owner)?.element.elementId).toBe('底板')
  expect(input.selectionStart).toBe(original.indexOf('width:400'))
  fireEvent.change(input, { target: { value: `${original}\n` } })
  expect(view.queryByLabelText('选中元素源码')).toBeNull()
  input.setSelectionRange(original.indexOf('fontSize'), original.indexOf('fontSize')); fireEvent.click(input)
  expect(selectedVideoEditCodeElement(owner)?.element.elementId).toBe('底板')
})
it('评论钉自动绑定代码元素和源码；动态元素包围盒跟随且消失提示，原标注不改写', () => {
  const onError = vi.fn(); const view = render(<VideoEditAnnotationOverlay instance={owner} mode="point" onError={onError} />)
  const layer = view.getByLabelText('画面标注层'); Object.defineProperty(layer, 'setPointerCapture', { value: vi.fn() })
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000))
  const at = titlePoint()
  for (const type of ['pointerdown', 'pointerup']) fireEvent(layer, new MouseEvent(type, { clientX: at.x * 1000, clientY: at.y * 1000, bubbles: true }))
  fireEvent.change(view.getByLabelText('这里要改什么？'), { target: { value: '改标题' } }); fireEvent.click(view.getByRole('button', { name: '加入待发送' }))
  const mark = getActiveVideoEditSequence(owner).annotations[0]
  expect(mark).toMatchObject({ clipId, frame: 0, target: { kind: 'element', elementId: '标题', sourceSpan: { start: expect.any(Number), end: expect.any(Number) } } })
  const initial = structuredClone(mark)
  act(() => setVideoEditView(owner.document.id, { frame: 30 }))
  const moved = resolveVideoEditElementAnnotation(owner, mark)
  expect(moved.mark.target.kind === 'element' && moved.mark.target.region!.x).toBeGreaterThan(initial.target.kind === 'element' ? initial.target.region!.x : 0)
  expect(mark).toEqual(initial)
  const next = source('return [rect({id:"新底板",x:0,y:0,width:100,height:100,fill:[1,1,1,1]})];')
  rememberVideoEditCodeMetadata(owner, 'definition', { id: 'new-version', source: next, apiVersion: 1, languageVersion: 3 }, compileCodeMaterial(next))
  act(() => { editVideoProject(owner.document.id, document => { document.codeMaterials![0].versions.push({ id: 'new-version', source: next, apiVersion: 1, languageVersion: 3 }); document.sequences[0].clips.find(clip => clip.id === clipId)!.code!.versionId = 'new-version'; return document }); setVideoEditView(owner.document.id, { frame: 0 }) })
  view.rerender(<VideoEditAnnotationOverlay instance={owner} mode="point" onError={onError} />)
  expect(view.getByRole('button', { name: '1 · 元素已不存在' })).toBeTruthy(); expect(onError).not.toHaveBeenCalled()
})
it('上下文和通用实体共享当前元素信息；切片段及源码版本后不暴露旧选区', () => {
  selectVideoEditCodeElement(owner, clipId, '标题')
  const selected = videoEditSelectedCodeElementContext(owner)!
  expect(selected).toMatchObject({ clipRef: `video_edit.clip:${owner.document.id}:${clipId}`, elementId: '标题', parameterKeys: ['title'], sourceSpan: { start: expect.any(Number) } })
  expect(readVideoEditData({ kind: 'video_edit.document', id: owner.document.id }).selectedCodeElement).toEqual(selected)
  act(() => setVideoEditTimelineView(owner.document.id, { selectedClipIds: [] }))
  expect(videoEditSelectedCodeElementContext(owner)).toBeNull()
})
it('不穿透顶层非代码片段及隐藏轨道', () => {
  const at = titlePoint()
  expect(hitVideoEditCodeElement(owner, at)?.element.elementId).toBe('标题')
  act(() => editVideoProject(owner.document.id, document => {
    const sequence = document.sequences[0]; const track = { id: 'occluding-track', name: '上层画面', index: Math.max(...sequence.tracks.map(track => track.index)) + 1, kind: 'video' as const, locked: false, enabled: true, muted: false, solo: false }; sequence.tracks.push(track)
    document.items.push({ id: 'text-item', kind: 'text', name: '遮挡' })
    sequence.clips.push({ ...sequence.clips[0], id: 'occluder', itemId: 'text-item', kind: 'text', track: track.index, code: undefined, text: '遮挡' }); return document
  }))
  expect(hitVideoEditCodeElement(owner, at)).toBeUndefined()
  act(() => editVideoProject(owner.document.id, document => { const sequence = document.sequences[0]; sequence.tracks.find(track => track.kind === 'video' && track.index === sequence.clips.find(clip => clip.id === 'occluder')!.track)!.enabled = false; return document }))
  expect(hitVideoEditCodeElement(owner, at)?.element.elementId).toBe('标题')
})
it('字体加载后同帧重新度量文字选框，淡入零透明帧不可选', () => {
  const before = videoEditCodeElementFrames(owner).get(clipId)!.index.byId.get('标题')!
  fontScale = 2; invalidateCodeTextMetrics()
  expect(videoEditCodeElementFrames(owner).get(clipId)!.index.byId.get('标题')!.width).toBeCloseTo(before.width * 2)
  const at = titlePoint()
  act(() => editVideoProject(owner.document.id, document => { document.sequences[0].clips.find(clip => clip.id === clipId)!.fadeInFrames = 10; return document }))
  expect(hitVideoEditCodeElement(owner, at)).toBeUndefined()
})
it('4K节目完整热命中链含片段逆映射与1000粒子，P95小于4ms', () => {
  const particles = source('return repeat(1000,i=>ellipse({id:"粒子",x:(i%50)*70,y:floor(i/50)*90,width:12,height:12,fill:[1,1,1,1]}));').replace('width:1920,height:1080', 'width:3840,height:2160')
  rememberVideoEditCodeMetadata(owner, 'definition', { id: 'particles', source: particles, apiVersion: 1, languageVersion: 3 }, compileCodeMaterial(particles))
  editVideoProject(owner.document.id, document => {
    document.codeMaterials![0].versions.push({ id: 'particles', source: particles, apiVersion: 1, languageVersion: 3 })
    const sequence = document.sequences[0]; sequence.width = 3840; sequence.height = 2160; sequence.clips.find(clip => clip.id === clipId)!.code!.versionId = 'particles'; return document
  })
  expect(videoEditCodeElementFrames(owner).get(clipId)!.index.bounds).toHaveLength(1000)
  for (let i = 0; i < 30; i++) hitVideoEditCodeElement(owner, { x: 6 / 3840, y: 6 / 2160 })
  const durations: number[] = []
  for (let i = 0; i < 200; i++) {
    const at = performance.now(); const hit = hitVideoEditCodeElement(owner, { x: (i % 50 * 70 + 6) / 3840, y: (Math.floor(i / 50) * 90 + 6) / 2160 }); durations.push(performance.now() - at); expect(hit?.element.elementId).toBe(`粒子:${i}`)
  }
  durations.sort((a, b) => a - b); expect(durations[Math.floor(durations.length * .95)]).toBeLessThan(4)
})
