import { createVideoEditTestProject as createVideoEditProject } from '../application/videoEditDocumentTestKit'
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { getPlatform } from '@/platform/runtime'
import { BLACK_HEX } from '@/core/theme/colorTokens'
import { videoEditClipToFrame } from '@/core/videoEdit/clipGeometry'
import { layoutVideoEditText } from '@/core/videoEdit/text'
import { defaultVideoEditTextStyle } from '@/core/videoEdit/text'
import { appendVideoEditClip, appendVideoEditSequence, editVideoSequence, getActiveVideoEditSequence, setVideoEditTimelineView, setVideoEditView, switchVideoEditSequence, undoVideoEdit, type VideoEditInstance } from '../application/videoEditService'
import { closeAllVideoEdits, reopenVideoEdit } from '../application/videoEditDocumentTestKit'
import { setVideoEditMaskEditing } from '../application/videoEditMaskEditing'
import { setVideoEditTrackingEditing } from '../application/videoEditTrackingEditing'
import { VideoEditTextOverlay } from './VideoEditTextOverlay'
import { VideoEditTextStylePanel } from './VideoEditTextStylePanel'

const rect = { left: 100, top: 50, width: 960, height: 540, right: 1060, bottom: 590, x: 100, y: 50, toJSON: () => ({}) }
beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (text: string) => ({ width: [...text].length * 20 }) } as unknown as CanvasRenderingContext2D)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  Element.prototype.setPointerCapture = () => undefined
})
afterEach(async () => { cleanup(); setVideoEditMaskEditing(null); setVideoEditTrackingEditing(null); await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
const clip = (owner: VideoEditInstance) => getActiveVideoEditSequence(owner).clips.find(clip => clip.id === owner.selection)!
function pointer(target: Element, kind: 'down' | 'move' | 'up', x: number, y: number): void {
  fireEvent(target, new MouseEvent(`pointer${kind}`, { bubbles: true, button: 0, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y }))
}
async function setup() {
  const owner = await createVideoEditProject()
  setVideoEditTimelineView(owner.document.id, { tool: 'type' })
  const onError = vi.fn(); const view = render(<VideoEditTextOverlay instance={owner} onError={onError} />)
  const root = () => view.getByLabelText('节目文字工具')
  const place = (x: number, y: number, end?: { x: number; y: number }): void => { pointer(root(), 'down', x, y); if (end) pointer(root(), 'move', end.x, end.y); pointer(root(), 'up', end?.x ?? x, end?.y ?? y) }
  const input = (text: string): void => { const editor = view.getByRole('textbox', { name: '就地编辑文字' }); editor.textContent = text; fireEvent.input(editor) }
  const finish = (): void => { fireEvent.keyDown(view.getByRole('textbox', { name: '就地编辑文字' }), { key: 'Escape' }) }
  return { owner, view, root, place, input, finish, onError }
}
it('单击在当前帧目标视频轨放文字，即时输入，Esc 提交为一步编辑；撤销输入与放置', async () => {
  const { owner, view, place, input, finish, onError } = await setup()
  act(() => setVideoEditView(owner.document.id, { frame: 30 }))
  const past = owner.past.length; place(.25, .25)
  expect(clip(owner)).toMatchObject({ kind: 'text', start: 30, x: -.25, y: -.25, textStyle: { boxWidth: 0, align: 'left' } })
  expect(view.getByRole('textbox').ownerDocument.activeElement).toBe(view.getByRole('textbox'))
  input('第一行'); input('第一行\n第二行'); finish()
  expect(clip(owner).text).toBe('第一行\n第二行'); expect(owner.past).toHaveLength(past + 2)
  act(() => undoVideoEdit(owner.document.id)); expect(clip(owner).text).toBe('')
  act(() => undoVideoEdit(owner.document.id)); expect(getActiveVideoEditSequence(owner).clips).toHaveLength(0)
  expect(onError).not.toHaveBeenCalled()
})
it('退出文字工具保留本次输入，返回选择工具可继续编辑', async () => {
  const { owner, view, place, input, onError } = await setup()
  place(.25, .25); input('输入后切换工具')
  const past = owner.past.length
  act(() => setVideoEditTimelineView(owner.document.id, { tool: 'select' }))
  expect(clip(owner).text).toBe('输入后切换工具'); expect(view.queryByRole('textbox', { name: '就地编辑文字' })).toBeNull()
  expect(owner.past).toHaveLength(past + 1); expect(onError).not.toHaveBeenCalled()
})
it('拖框创建固定宽度段落，视频轨被占用时新建轨道，不覆盖原片段', async () => {
  const { owner, place, input, finish, onError } = await setup()
  act(() => appendVideoEditClip(owner.document.id))
  const original = getActiveVideoEditSequence(owner).clips[0]; const tracks = getActiveVideoEditSequence(owner).tracks.length
  place(.6, .5, { x: .2, y: .3 }); input('段落文字'); finish()
  const created = clip(owner)
  expect(created.x).toBeCloseTo(-.3); expect(created.y).toBeCloseTo(-.2); expect(created.textStyle?.boxWidth).toBeCloseTo(.4)
  expect(getActiveVideoEditSequence(owner).tracks).toHaveLength(tracks + 1); expect(created.track).toBeGreaterThan(original.track)
  expect(getActiveVideoEditSequence(owner).clips[0]).toEqual(original)
  expect(onError).not.toHaveBeenCalled()
})
it('选择工具双击就地编辑，点击空白提交；移动与拖角缩放均写运动并一步撤销', async () => {
  const { owner, view, root, place, input, finish, onError } = await setup()
  place(.25, .25); input('文字'); finish()
  act(() => setVideoEditTimelineView(owner.document.id, { tool: 'select' }))
  const box = () => view.container.querySelector('[data-video-edit-text-clip]')!
  fireEvent.doubleClick(box()); input('新标题'); pointer(root(), 'down', .9, .9)
  expect(view.queryByRole('textbox')).toBeNull(); expect(clip(owner).text).toBe('新标题')
  const before = clip(owner); const past = owner.past.length
  pointer(box(), 'down', .25, .25); pointer(root(), 'move', .3, .35); pointer(root(), 'move', .35, .4); pointer(root(), 'up', .35, .4)
  expect(clip(owner).x).toBeCloseTo(before.x + .1); expect(clip(owner).y).toBeCloseTo(before.y + .15); expect(owner.past).toHaveLength(past + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(clip(owner)).toEqual(before)
  const sequence = getActiveVideoEditSequence(owner); const layout = layoutVideoEditText(before, sequence, text => [...text].length * 20)
  const fixed = videoEditClipToFrame(before, sequence, sequence, layout.left / sequence.width, layout.top / sequence.height)
  const moving = videoEditClipToFrame(before, sequence, sequence, (layout.left + layout.width) / sequence.width, (layout.top + layout.height) / sequence.height)
  pointer(view.container.querySelector('[data-video-edit-text-handle="2"]')!, 'down', moving.x, moving.y)
  pointer(root(), 'up', fixed.x + 2 * (moving.x - fixed.x), fixed.y + 2 * (moving.y - fixed.y))
  expect(clip(owner).scale).toBeCloseTo(2); expect(owner.past).toHaveLength(past + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(clip(owner)).toEqual(before)
  expect(onError).not.toHaveBeenCalled()
})
it('遮罩和跟踪编辑优先，文字叠层结束编辑；再次选择 T 取得画面，切换序列不写新目标', async () => {
  const { owner, view, place, input, finish, onError } = await setup()
  place(.25, .25); input('标题'); finish()
  const target = { projectId: owner.document.id, sequenceId: owner.activeSequenceId, clipId: owner.selection! }
  act(() => setVideoEditMaskEditing({ ...target, effectId: 'effect' }))
  expect(view.queryByLabelText('节目文字工具')).toBeNull()
  act(() => setVideoEditMaskEditing(null))
  fireEvent.doubleClick(view.container.querySelector('[data-video-edit-text-clip]')!); input('保存当前文字')
  act(() => setVideoEditTrackingEditing({ ...target, method: 'box', mode: 'box' }))
  expect(view.queryByLabelText('节目文字工具')).toBeNull(); expect(clip(owner).text).toBe('保存当前文字')
  act(() => setVideoEditTimelineView(owner.document.id, { tool: 'select' }))
  act(() => setVideoEditTimelineView(owner.document.id, { tool: 'type' }))
  expect(view.getByLabelText('节目文字工具')).toBeTruthy()
  const id = owner.document.id; const oldSequence = owner.activeSequenceId
  let nextSequence = ''
  act(() => { nextSequence = appendVideoEditSequence(id, { name: '另一个序列' }) })
  act(() => switchVideoEditSequence(id, oldSequence))
  fireEvent.doubleClick(view.container.querySelector('[data-video-edit-text-clip]')!); input('临时草稿')
  act(() => switchVideoEditSequence(id, nextSequence))
  expect(getActiveVideoEditSequence(owner).clips).toHaveLength(0)
  expect(owner.document.sequences.find(sequence => sequence.id === oldSequence)!.clips[0].text).toBe('保存当前文字')
  expect(onError).not.toHaveBeenCalled()
})
it('效果控件样式与助手通用实体读写同源，样式保存重开保留，null 恢复旧样式', async () => {
  const { owner, place, input, finish, onError } = await setup()
  place(.25, .25); input('标题'); finish()
  const sequenceId = owner.activeSequenceId; const clipId = owner.selection!; const projectId = owner.document.id
  function Panel(): React.ReactElement { return <VideoEditTextStylePanel projectId={projectId} sequenceId={sequenceId} clip={clip(owner)} height={1080} onError={onError} /> }
  const panel = render(<Panel />)
  fireEvent.click(panel.getByRole('switch', { name: '文字背景框' })); panel.rerender(<Panel />)
  expect(clip(owner).textStyle?.background).toBe(true)
  const app = createApplicationHarness(); const ref = { kind: 'video_edit.clip', id: `${projectId}:${clipId}` }
  try {
    const style = { ...clip(owner).textStyle!, color: BLACK_HEX, strokeWidth: 3, shadow: true, fontSize: 64, fontFamily: 'serif', align: 'right' as const }
    const result = await app.change(ref, { 'video_edit.clip.text_style': style, 'video_edit.clip.text': '助手改字' })
    expect(result.ok).toBe(true); expect((await app.read(ref, ['video_edit.clip.text_style'])).properties).toMatchObject({ 'video_edit.clip.text_style': style })
    expect(clip(owner)).toMatchObject({ text: '助手改字', textStyle: style })
    panel.unmount(); cleanup()
    const reopened = await reopenVideoEdit(projectId)
    expect(getActiveVideoEditSequence(reopened).clips.find(clip => clip.id === clipId)?.textStyle).toEqual(style)
    expect((await app.change(ref, { 'video_edit.clip.text_style': null })).ok).toBe(true)
    expect((await app.read(ref, ['video_edit.clip.text_style'])).properties).toMatchObject({ 'video_edit.clip.text_style': null })
  } finally { app.dispose() }
  expect(onError).not.toHaveBeenCalled()
})
it('锁定的视频轨不允许选择和编辑文字', async () => {
  const { owner, view, place, input, finish } = await setup()
  place(.25, .25); input('标题'); finish()
  act(() => { setVideoEditTimelineView(owner.document.id, { tool: 'select' }); editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(track => ({ ...track, locked: true })) })) })
  expect(view.container.querySelector('[data-video-edit-text-clip]')).toBeNull()
})
it('未结束的节目输入切到样式连续编辑时，先提交文字再开始样式手势', async () => {
  const { owner, view, place, input, onError } = await setup()
  place(.25, .25); input('已输入')
  const current = clip(owner); const past = owner.past.length
  const panel = render(<VideoEditTextStylePanel projectId={owner.document.id} sequenceId={owner.activeSequenceId} clip={current} height={1080} onError={onError} />)
  const color = panel.getByLabelText('文字颜色')
  fireEvent.pointerDown(color); fireEvent.focus(color); fireEvent.change(color, { target: { value: BLACK_HEX } }); fireEvent.blur(color)
  expect(view.queryByRole('textbox', { name: '就地编辑文字' })).toBeNull(); expect(clip(owner)).toMatchObject({ text: '已输入', textStyle: { color: BLACK_HEX } })
  expect(owner.past).toHaveLength(past + 2); expect(onError).not.toHaveBeenCalled()
})
it('样式字段未结束时点放下一段文字，先结束样式再开始新的文字输入', async () => {
  const { owner, view, place, input, finish, onError } = await setup()
  place(.25, .25); input('第一段'); finish()
  const panel = render(<VideoEditTextStylePanel projectId={owner.document.id} sequenceId={owner.activeSequenceId} clip={clip(owner)} height={1080} onError={onError} />)
  const font = panel.getByLabelText('文字字体')
  act(() => (font as HTMLInputElement).focus()); fireEvent.change(font, { target: { value: 'serif' } })
  place(.7, .7); input('第二段'); finish()
  expect(getActiveVideoEditSequence(owner).clips).toHaveLength(2)
  expect(getActiveVideoEditSequence(owner).clips[0]).toMatchObject({ text: '第一段', textStyle: { fontFamily: 'serif' } })
  expect(clip(owner).text).toBe('第二段'); expect(view.queryByRole('textbox', { name: '就地编辑文字' })).toBeNull()
  expect(onError).not.toHaveBeenCalled()
})
it('助手用通用集合放文字与序列坐标，随后一次改样式，公共撤销恢复', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  const app = createApplicationHarness(); const project = { kind: 'video_edit.document', id }; const sequence = { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }
  try {
    const createdItem = await app.call('change_application_entities', { summary: '准备文字', changes: [{ kind: 'create_items', entityType: 'video_edit.item', parent: project, items: [{ properties: { 'video_edit.item.name': '标题', 'video_edit.item.kind': 'text' } }] }] }, (await app.read(project)).revisions as Record<string, number>)
    expect(createdItem.ok).toBe(true)
    const item = owner.document.items.find(item => item.kind === 'text')!
    const placed = await app.call('change_application_entities', { summary: '左上放标题', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequence, items: [{ properties: { 'video_edit.clip.name': '标题', 'video_edit.clip.kind': 'text', 'video_edit.clip.item_id': item.id, 'video_edit.clip.text': '助手放置', 'video_edit.clip.start': 30, 'video_edit.clip.x': -.3, 'video_edit.clip.y': -.2, 'video_edit.clip.text_style': null } }] }] }, (await app.read(sequence)).revisions as Record<string, number>)
    expect(placed.ok).toBe(true)
    const title = getActiveVideoEditSequence(owner).clips[0]
    expect(title).toMatchObject({ start: 30, x: -.3, y: -.2, text: '助手放置' }); expect(title.textStyle).toBeUndefined()
    const style = { ...defaultVideoEditTextStyle(1080), anchor: 'top' as const, shadow: true }
    expect((await app.change({ kind: 'video_edit.clip', id: `${id}:${title.id}` }, { 'video_edit.clip.text_style': style })).ok).toBe(true)
    expect(getActiveVideoEditSequence(owner).clips[0].textStyle).toEqual(style)
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].textStyle).toBeUndefined()
  } finally { app.dispose() }
})
