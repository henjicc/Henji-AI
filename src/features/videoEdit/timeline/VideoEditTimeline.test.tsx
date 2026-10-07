import { createVideoEditTestProject as createVideoEditProject } from '../application/videoEditDocumentTestKit'
// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { rememberVideoEditCodeMetadata, readVideoEditCodeMetadata } from '../application/videoEditCodeState'
import { appendVideoEditSequence, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditTimelineView, setVideoEditView, subscribeVideoEdit, switchVideoEditSequence, undoVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { executeVideoEditTimelineEdit } from '../application/videoEditTimeline'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from '../application/videoEditCommands'
import { videoEditKeyboardCommand } from '../application/videoEditKeyboard'
import { closeVideoEditSpeedDialog } from '../application/videoEditSpeedDialog'
import { videoEditClipSourceRange, videoEditClipSpeedPercent } from '@/core/videoEdit/clipSpeed'
import { VIDEO_EDIT_ITEM_DRAG_MIME } from '../application/videoEditDrop'
import { VideoEditTimeline } from '../VideoEditTimeline'
import { VideoEditInOutDuration } from './VideoEditTimelineTransport'
import { useSettingsStore } from '@/stores/settingsStore'
import { TIMELINE_HEADER_WIDTH as header, TIMELINE_DEFAULT_SPLIT, timelineLayout } from './timelineGeometry'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'
import { resetFilmstripFramesForTests } from '@/services/videoFilmstrip/filmstripFrameService'
import { VirtuosoMockContext } from 'react-virtuoso'
import { createVideoEditCaption } from '../application/videoEditTimedContent'
import { selectedVideoEditSubtitleId } from '../application/videoEditSubtitleSelection'
import { VideoEditTimedContentPanel } from '../panels/VideoEditTimedContentPanel'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const source = 'export default {apiVersion:1,name:"代码",kind:"generator",mode:"dynamic",width:64,height:64,durationSeconds:30,seed:1,parameters:{},render(ctx){return [rect({x:0,y:0,width:10,height:10,fill:[1,0,0,1]})];}}'
let owner: VideoEditInstance
let ids: string[]
let onError: ReturnType<typeof vi.fn>
function View({ visible = true }: { visible?: boolean }): React.ReactElement { useSyncExternalStore(subscribeVideoEdit, videoEditRevision); return <VideoEditTimeline instance={owner} onError={onError} visible={visible} /> }
/** 复用工作区根部的正式键盘路由与命令执行器，叶子时间线不另注册快捷键。 */
function SpeedKeyboardView(): React.ReactElement {
  return <div onKeyDown={event => {
    const binding = videoEditKeyboardCommand({ code: event.code, key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, repeat: event.repeat, isComposing: event.nativeEvent.isComposing, defaultPrevented: event.defaultPrevented, target: event.target }, 'timeline', {})
    if (!binding) return
    const context = captureVideoEditCommandContext(owner.document.id, binding.scope)
    if (!videoEditCommandState(context, binding.id).enabled) return
    event.preventDefault(); event.stopPropagation()
    void executeVideoEditCommand(context, binding.id).catch(onError)
  }}><View /></div>
}

it('Ctrl+R 打开速度对话框：50% 与时长互算，倒放／保持音调／波纹编辑一起提交并一步撤销（4.13）', async () => {
  setVideoEditTimelineView(owner.document.id, { selectedClipIds: [ids[0]] })
  const baseline = owner.document; const history = owner.past.length
  const view = render(<SpeedKeyboardView />)
  fireEvent.keyDown(view.getByRole('region', { name: '时间线编辑区域' }), { key: 'r', code: 'KeyR', ctrlKey: true })
  const dialog = within(await view.findByRole('dialog', { name: '剪辑速度/持续时间' }))
  const speed = dialog.getByLabelText('速度百分比') as HTMLInputElement
  const duration = dialog.getByLabelText('持续时间') as HTMLInputElement
  expect(speed.value).toBe('100'); expect(duration.value).toBe('00:00:01:00')
  for (const name of ['倒放速度', '保持音频音调', '波纹编辑，移动尾部剪辑']) expect(dialog.getByRole('checkbox', { name }).getAttribute('aria-checked')).toBe('false')
  fireEvent.change(speed, { target: { value: '50' } }); fireEvent.blur(speed)
  expect(duration.value).toBe('00:00:02:00')
  for (const name of ['倒放速度', '保持音频音调', '波纹编辑，移动尾部剪辑']) fireEvent.click(dialog.getByRole('checkbox', { name }))
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
  fireEvent.click(dialog.getByRole('button', { name: '确定' }))
  expect(current().clips[0]).toMatchObject({ duration: 60, reverse: true, preservePitch: true })
  expect(videoEditClipSpeedPercent(current().clips[0])).toBe(50)
  expect(videoEditClipSourceRange(current().clips[0], 30)).toEqual({ from: 0, to: 1 })
  expect(current().clips[1].start).toBe(90); expect(owner.past).toHaveLength(history + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(owner.document.sequences).toEqual(baseline.sequences); expect(owner.past).toHaveLength(history)
  expect(onError).not.toHaveBeenCalled()
})

it('速度对话框：持续时间反算速度，输入保护与取消不编辑，关闭波纹后保留尾部位置（4.13）', async () => {
  setVideoEditTimelineView(owner.document.id, { selectedClipIds: [ids[0]] })
  const view = render(<SpeedKeyboardView />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  const open = async () => { fireEvent.keyDown(host, { key: 'r', code: 'KeyR', ctrlKey: true }); return within(await view.findByRole('dialog', { name: '剪辑速度/持续时间' })) }
  let dialog = await open(); const baseline = owner.document; const history = owner.past.length
  const duration = dialog.getByLabelText('持续时间') as HTMLInputElement
  fireEvent.change(duration, { target: { value: '00:00:02:00' } }); fireEvent.blur(duration)
  expect((dialog.getByLabelText('速度百分比') as HTMLInputElement).value).toBe('50')
  // 弹窗输入里按 R 不切换工具、Ctrl+R 不重开对话框。
  fireEvent.keyDown(duration, { key: 'r', code: 'KeyR' }); fireEvent.keyDown(duration, { key: 'r', code: 'KeyR', ctrlKey: true })
  expect(owner.tool).toBe('select'); expect(view.getAllByRole('dialog')).toHaveLength(1)
  fireEvent.click(dialog.getByRole('button', { name: '取消' }))
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
  dialog = await open()
  const time = dialog.getByLabelText('持续时间') as HTMLInputElement
  fireEvent.change(time, { target: { value: 'bad-timecode' } }); fireEvent.blur(time)
  expect(time.value).toBe('00:00:01:00')
  fireEvent.change(time, { target: { value: '00:00:02:00' } }); fireEvent.keyDown(time, { key: 'Enter', code: 'Enter' })
  expect((dialog.getByLabelText('速度百分比') as HTMLInputElement).value).toBe('50')
  // 开关打开再关闭，确保提交读取最终值。
  const ripple = dialog.getByRole('checkbox', { name: '波纹编辑，移动尾部剪辑' })
  fireEvent.click(ripple); fireEvent.click(ripple)
  fireEvent.click(dialog.getByRole('button', { name: '确定' }))
  expect(current().clips[0].duration).toBe(60); expect(current().clips[1].start).toBe(60)
  expect(videoEditClipSpeedPercent(current().clips[0])).toBe(50); expect(owner.past).toHaveLength(history + 1)
  expect(onError).not.toHaveBeenCalled()
})

it.each(['in', 'out'] as const)('R 比率拉伸拖 %s 边缘：吸附、实时预览、保留源范围，释放一步历史与撤销（4.13）', async edge => {
  editVideoProject(owner.document.id, document => { document.sequences[0].clips[0].start = 30; document.sequences[0].clips[1].start = 90; return document })
  setVideoEditTimelineView(owner.document.id, { snapping: true }); setVideoEditView(owner.document.id, { frame: 45 })
  const view = render(<SpeedKeyboardView />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.keyDown(host, { key: 'r', code: 'KeyR' }); await waitFor(() => expect(owner.tool).toBe('rate_stretch'))
  const baseline = owner.document; const history = owner.past.length
  const origin = edge === 'in' ? 60 : 120; const target = edge === 'in' ? 87 : 177
  fireEvent.pointerDown(view.getByRole('button', { name: `裁剪视频${edge === 'in' ? '入点' : '出点'}` }), event(header + origin))
  fireEvent.pointerMove(host, event(header + target - 10)); fireEvent.pointerMove(host, event(header + target))
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
  const block = view.container.querySelector(`[data-video-edit-clip="${ids[0]}"]`)!
  expect(block.getAttribute('data-clip-start')).toBe(edge === 'in' ? '45' : '30')
  expect(block.getAttribute('data-clip-duration')).toBe(edge === 'in' ? '15' : '60')
  expect(block.textContent).toContain(edge === 'in' ? '[200%]' : '[50%]')
  expect(view.container.querySelector('[data-video-edit-snap-indicator]')?.getAttribute('data-video-edit-snap-indicator')).toBe(edge === 'in' ? '45' : '90')
  fireEvent.pointerUp(host, event(header + target))
  expect(current().clips[0]).toMatchObject({ start: edge === 'in' ? 45 : 30, duration: edge === 'in' ? 15 : 60 })
  expect(videoEditClipSpeedPercent(current().clips[0])).toBe(edge === 'in' ? 200 : 50)
  expect(videoEditClipSourceRange(current().clips[0], 30)).toEqual({ from: 0, to: 1 })
  expect(current().clips[1].start).toBe(90); expect(owner.past).toHaveLength(history + 1)
  expect(view.container.querySelector('[data-video-edit-snap-indicator]')).toBeNull()
  act(() => undoVideoEdit(owner.document.id)); expect(owner.document.sequences).toEqual(baseline.sequences); expect(owner.past).toHaveLength(history); expect(onError).not.toHaveBeenCalled()
})

it('速度对话框回读既有倒放与保持音调，关闭两项不改变速度或源范围且一步撤销（4.13）', async () => {
  executeVideoEditTimelineEdit(owner.document.id, current().id, { kind: 'speed', clipIds: [ids[0]], linked: false, change: { speed: { numerator: 2, denominator: 1 }, reverse: true, preservePitch: true } })
  setVideoEditTimelineView(owner.document.id, { selectedClipIds: [ids[0]] })
  const baseline = owner.document; const history = owner.past.length
  const view = render(<SpeedKeyboardView />)
  fireEvent.keyDown(view.getByRole('region', { name: '时间线编辑区域' }), { key: 'r', code: 'KeyR', ctrlKey: true })
  const dialog = within(await view.findByRole('dialog', { name: '剪辑速度/持续时间' }))
  expect((dialog.getByLabelText('速度百分比') as HTMLInputElement).value).toBe('200')
  expect((dialog.getByLabelText('持续时间') as HTMLInputElement).value).toBe('00:00:00:15')
  for (const name of ['倒放速度', '保持音频音调']) {
    const checkbox = dialog.getByRole('checkbox', { name })
    expect(checkbox.getAttribute('aria-checked')).toBe('true'); fireEvent.click(checkbox)
  }
  fireEvent.click(dialog.getByRole('button', { name: '确定' }))
  expect(current().clips[0].reverse).toBeUndefined(); expect(current().clips[0].preservePitch).toBeUndefined()
  expect(current().clips[0].duration).toBe(15); expect(videoEditClipSpeedPercent(current().clips[0])).toBe(200)
  expect(videoEditClipSourceRange(current().clips[0], 30)).toEqual({ from: 0, to: 1 }); expect(owner.past).toHaveLength(history + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(owner.document.sequences).toEqual(baseline.sequences); expect(owner.past).toHaveLength(history)
  expect(onError).not.toHaveBeenCalled()
})
const current = () => getActiveVideoEditSequence(owner)
/** 轨道中线的客户区纵坐标：按实际渲染的区位置与区内滚动读取（视口 getBoundingClientRect 固定在 0）。 */
const trackClientY = (index = 1): number => {
  const row = document.querySelector<HTMLElement>(`[data-video-edit-track][data-track-index="${index}"]`)
  if (row) return Number.parseFloat(row.parentElement!.style.top) + Number.parseFloat(row.style.top) + Number.parseFloat(row.style.height) / 2
  const layout = timelineLayout(current(), { viewportHeight, split: TIMELINE_DEFAULT_SPLIT, scroll: { video: 0, audio: 0 } }).rows.find(value => value.track.index === index)!
  return layout.top + layout.height / 2
}
const trackTop = (index: number): number => { const row = document.querySelector<HTMLElement>(`[data-video-edit-track][data-track-index="${index}"]`)!; return Number.parseFloat(row.parentElement!.style.top) + Number.parseFloat(row.style.top) }
const event = (clientX: number, clientY = trackClientY(), extra: Partial<PointerEventInit> = {}) => ({ clientX, clientY, pointerId: 1, button: 0, ...extra })
let viewportHeight = 300
const mixedTracks = () => Array.from({ length: 32 }, (_, index) => ({ ...current().tracks[1], id: `track-${current().id}-${index}`, index, kind: index % 2 ? 'video' as const : 'audio' as const, name: `轨道${index}`, height: 32 }))
function layoutClock() {
  const callbacks = new Map<number, FrameRequestCallback>(); let token = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++token, callback); return token })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  return { callbacks, step: (): void => { const pending = [...callbacks.values()]; callbacks.clear(); act(() => pending.forEach(callback => callback(token * 16))) } }
}

beforeEach(async () => {
  installHarnessNativeStorage(); onError = vi.fn()
  // 缩略帧不是这些用例的对象：取帧一直“进行中”直到用例结束被中止，不再因替身缺 video 命名空间刷失败日志。
  vi.spyOn(getPlatform().video, 'getFilmstripFrame').mockImplementation((_request, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('用例结束', 'AbortError')))))
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/fixture/timeline-ui.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.stubGlobal('PointerEvent', class extends MouseEvent { readonly pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } })
  vi.stubGlobal('DragEvent', class extends MouseEvent { readonly dataTransfer: DataTransfer | null; constructor(type: string, init: DragEventInit = {}) { super(type, init); this.dataTransfer = init.dataTransfer ?? null } })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, top: 0, right: 900, bottom: 300, width: 900, height: 300, x: 0, y: 0, toJSON: () => ({}) }))
  viewportHeight = 300
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => viewportHeight)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
  const captures = new WeakMap<Element, number>()
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value(this: HTMLElement, id: number) { captures.set(this, id) } },
    hasPointerCapture: { configurable: true, value(this: HTMLElement, id: number) { return captures.get(this) === id } },
    releasePointerCapture: { configurable: true, value(this: HTMLElement) { captures.delete(this) } },
  })
  owner = (await createVideoEditProject())!
  const program = compileCodeMaterial(source)
  rememberVideoEditCodeMetadata(owner, 'definition', { id: 'version', source, apiVersion: 1, languageVersion: 1 }, program)
  editVideoProject(owner.document.id, document => {
    document.media.push({ id: 'media', name: '视频', path: 'D:/fixture/video.mp4', kind: 'video', width: 64, height: 64, durationSeconds: 30, hasAudio: false })
    document.codeMaterials = [{ id: 'definition', name: '代码', defaultVersionId: 'version', versions: [{ id: 'version', source, apiVersion: 1, languageVersion: 1 }] }]
    document.items.push({ id: 'video-item', name: '视频', kind: 'video', mediaId: 'media' }, { id: 'code-item', name: '代码', kind: 'code', code: { definitionId: 'definition', versionId: 'version', parameters: {} } })
    // 多轨编辑用例沿用八条轨道（A1 + V1–V7）；新序列默认只有 V1/A1。
    addLegacyVideoEditTracks(document.sequences[0])
    document.sequences[0].clips = ['video-item', 'code-item'].map((id, index) => ({ ...makeVideoEditItemClip(document, id, document.sequences[0].id, { frame: index * 60, track: 1 }, readVideoEditCodeMetadata(owner, document)), duration: 30 }))
    return document
  })
  ids = current().clips.map(clip => clip.id)
  setVideoEditTimelineView(owner.document.id, { selectedClipIds: [], snapping: false })
})
afterEach(async () => { cleanup(); closeVideoEditSpeedDialog(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage(); resetFilmstripFramesForTests() })

it('普通视频与代码多选，连续拖动仅本地预览，释放一次历史且一次撤销', () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20))
  fireEvent.pointerUp(host, event(header + 20))
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 代码' }), event(header + 140, trackClientY(), { shiftKey: true }))
  expect(owner.selectedClipIds).toEqual(ids)
  const baseline = owner.document; const history = owner.past.length
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20))
  for (let delta = 4; delta <= 20; delta += 2) fireEvent.pointerMove(host, event(header + 20 + delta))
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
  expect(view.container.querySelector(`[data-video-edit-clip="${ids[0]}"]`)?.getAttribute('data-clip-start')).toBe('10')
  fireEvent.pointerUp(host, event(header + 40))
  expect(current().clips.map(clip => clip.start)).toEqual([10, 70]); expect(owner.past).toHaveLength(history + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(current().clips.map(clip => clip.start)).toEqual([0, 60]); expect(onError).not.toHaveBeenCalled()
})

it('字幕时间线点击与面板行双向选中，切换标记页后也能定位字幕，选中不推进撤销', async () => {
  vi.spyOn(getPlatform().audioEdit, 'listAsrModels').mockResolvedValue([])
  const first = createVideoEditCaption(owner.document.id, current().id, { start: 0, duration: 30, text: '第一条' })
  const second = createVideoEditCaption(owner.document.id, current().id, { start: 60, duration: 30, text: '第二条' })
  const history = owner.past.length
  const view = render(<><View /><VirtuosoMockContext.Provider value={{ viewportHeight: 280, itemHeight: 56 }}><VideoEditTimedContentPanel instance={owner} onError={onError} /></VirtuosoMockContext.Provider></>)
  const secondBar = view.getByRole('button', { name: '定位字幕 第二条' })
  fireEvent.click(secondBar)
  expect(owner.frame).toBe(60); expect(owner.activePanel).toBe('content')
  expect(selectedVideoEditSubtitleId(owner)).toBe(second)
  expect(secondBar.getAttribute('aria-pressed')).toBe('true')
  expect((await view.findByRole('button', { name: '字幕：第二条' })).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(view.getByRole('button', { name: '字幕：第一条' }))
  expect(selectedVideoEditSubtitleId(owner)).toBe(first)
  expect(view.getByRole('button', { name: '定位字幕 第一条' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(view.getByRole('tab', { name: '标记' }))
  fireEvent.click(view.getByRole('button', { name: '定位字幕 第一条' }))
  await waitFor(() => expect(view.getByRole('tab', { name: '字幕' }).getAttribute('aria-selected')).toBe('true'))
  expect(owner.past).toHaveLength(history); expect(onError).not.toHaveBeenCalled()
})

it('框选与关联选择不误定位播放头；Shift 点击关联集合整体取消', () => {
  executeVideoEditTimelineEdit(owner.document.id, current().id, { kind: 'link', clipIds: ids })
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' }); const frame = owner.frame
  const y = trackClientY()
  fireEvent.pointerDown(host, event(header + 150, y + 20)); fireEvent.pointerMove(host, event(header + 10, y - 20)); fireEvent.pointerUp(host, event(header + 10, y - 20))
  expect(new Set(owner.selectedClipIds)).toEqual(new Set(ids)); expect(owner.frame).toBe(frame)
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20, trackClientY(), { shiftKey: true }))
  expect(owner.selectedClipIds).toEqual([])
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 代码' }), event(header + 140)); fireEvent.pointerUp(host, event(header + 140))
  expect(new Set(owner.selectedClipIds)).toEqual(new Set(ids)); expect(owner.selection).toBe(ids[1]); expect(onError).not.toHaveBeenCalled()
})

it('Premiere 修饰键拖动：Alt 复制、Ctrl 重排插入、Ctrl+Alt 复制插入，各一步历史；双击片段在源监视器打开', async () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  const spans = () => current().clips.filter(clip => clip.track === 1).map(clip => [clip.start, clip.duration]).sort((a, b) => a[0] - b[0])
  // 片段：视频 [0,30)，代码 [60,90)；每帧 2px
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20, trackClientY(), { altKey: true }))
  fireEvent.pointerMove(host, event(header + 100, trackClientY(), { altKey: true }))
  expect(view.container.querySelectorAll('[data-video-edit-clip]')).toHaveLength(3)
  let history = owner.past.length
  fireEvent.pointerUp(host, event(header + 100, trackClientY(), { altKey: true }))
  expect(spans()).toEqual([[0, 30], [40, 30], [70, 20]]); expect(owner.past).toHaveLength(history + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(spans()).toEqual([[0, 30], [60, 30]])
  act(() => setVideoEditTimelineView(owner.document.id, { selectedClipIds: [] }))
  history = owner.past.length
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20, trackClientY(), { ctrlKey: true }))
  fireEvent.pointerMove(host, event(header + 160, trackClientY(), { ctrlKey: true })); fireEvent.pointerUp(host, event(header + 160, trackClientY(), { ctrlKey: true }))
  // 抽出 [0,30) 后代码移到 30，落点 70 前移 30 到 40：插入后代码被拆成 [30,40) 与 [70,90)
  expect(spans()).toEqual([[30, 10], [40, 30], [70, 20]]); expect(owner.past).toHaveLength(history + 1)
  act(() => undoVideoEdit(owner.document.id)); act(() => setVideoEditTimelineView(owner.document.id, { selectedClipIds: [] }))
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20, trackClientY(), { ctrlKey: true, altKey: true }))
  fireEvent.pointerMove(host, event(header + 140, trackClientY(), { ctrlKey: true, altKey: true })); fireEvent.pointerUp(host, event(header + 140, trackClientY(), { ctrlKey: true, altKey: true }))
  expect(spans()).toEqual([[0, 30], [60, 30], [90, 30]])
  const source = vi.spyOn(await import('../application/videoEditSource'), 'updateVideoEditSource').mockResolvedValue(undefined as never)
  fireEvent.doubleClick(view.getAllByRole('button', { name: '选择片段 视频' })[0])
  await waitFor(() => expect(source).toHaveBeenCalledWith(owner.document.id, expect.objectContaining({ itemId: 'video-item' })))
  expect(onError).not.toHaveBeenCalled()
})

it('吸附开启时修饰键拖动也吸附：Alt 复制的副本贴到原片段末尾（2.3 复核）', () => {
  act(() => setVideoEditTimelineView(owner.document.id, { snapping: true }))
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  // 片段：视频 [0,30)，代码 [60,90)；每帧 2px，拖 27 帧落在 [27,57)，吸附到原片段末尾 30
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20, trackClientY(), { altKey: true }))
  fireEvent.pointerMove(host, event(header + 74, trackClientY(), { altKey: true })); fireEvent.pointerUp(host, event(header + 74, trackClientY(), { altKey: true }))
  expect(current().clips.filter(clip => clip.track === 1).map(clip => clip.start).sort((a, b) => a - b)).toEqual([0, 30, 60])
  expect(onError).not.toHaveBeenCalled()
})

it('新序列只有 V1/A1：片段拖到最上视频轨之上自动加轨，素材拖到那里也加轨，各一步撤销（2.4）', async () => {
  editVideoProject(owner.document.id, document => { document.sequences[0].tracks = document.sequences[0].tracks.filter(track => track.index <= 1); return document })
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  expect(view.container.querySelectorAll('[data-video-edit-track]')).toHaveLength(2)
  const history = owner.past.length
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20))
  fireEvent.pointerMove(host, event(header + 20, 60))
  // 预览里已出现新轨道，继续在它上面移动仍是同一条新轨道
  expect(view.container.querySelectorAll('[data-video-edit-track]')).toHaveLength(3)
  fireEvent.pointerMove(host, event(header + 22, trackClientY(2))); fireEvent.pointerUp(host, event(header + 22, trackClientY(2)))
  expect(current().tracks.filter(track => track.kind === 'video').map(track => track.index)).toEqual([1, 2])
  expect(current().clips.find(clip => clip.id === ids[0])).toMatchObject({ track: 2, start: 1 }); expect(owner.past).toHaveLength(history + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(current().tracks).toHaveLength(2)
  const transfer = { types: [VIDEO_EDIT_ITEM_DRAG_MIME], getData: () => JSON.stringify({ projectId: owner.document.id, itemIds: ['video-item'] }) }
  fireEvent.dragOver(host, { clientX: header + 200, clientY: 60, dataTransfer: transfer })
  expect(view.getByText('释放以新建轨道并添加')).not.toBeNull()
  fireEvent.drop(host, { clientX: header + 200, clientY: 60, dataTransfer: transfer })
  await waitFor(() => expect(current().clips).toHaveLength(3))
  expect(current().tracks).toHaveLength(3); expect(current().clips.at(-1)).toMatchObject({ itemId: 'video-item', track: 2, start: 100 })
  expect(owner.past).toHaveLength(history + 1); expect(onError).not.toHaveBeenCalled()
})

it('锁定轨道阻止指针编辑；目标/静音/独奏/输出/同步使用同一领域轨道', () => {
  act(() => useSettingsStore.getState().setVideoEditTrackHeaderButtons('video', ['target', 'sync', 'enabled', 'locked', 'muted', 'solo']))
  const view = render(<View />); const name = current().tracks[1].name
  fireEvent.click(view.getByRole('button', { name: `${name}锁定` })); expect(current().tracks[1].locked).toBe(true)
  const baseline = owner.document; const history = owner.past.length
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20)); fireEvent.pointerMove(view.getByRole('region', { name: '时间线编辑区域' }), event(header + 40))
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history); expect(onError.mock.calls[0][0].message).toContain('锁定')
  fireEvent.click(view.getByRole('button', { name: `${name}静音` })); fireEvent.click(view.getByRole('button', { name: `${name}独奏` })); fireEvent.click(view.getByRole('button', { name: `${name}输出` })); fireEvent.click(view.getByRole('button', { name: `${name}同步锁定` }))
  expect(current().tracks[1]).toMatchObject({ muted: true, solo: true, enabled: false, syncLocked: false })
  const trackId = current().tracks[1].id; const before = owner.targetTrackIds.includes(trackId)
  fireEvent.click(view.getByRole('button', { name: `${name}设为目标` })); expect(owner.targetTrackIds.includes(trackId)).toBe(!before)
  act(() => useSettingsStore.getState().setVideoEditTrackHeaderButtons('video', null))
})

it('切序列后的晚到释放、Escape、丢捕获、窗口失焦与卸载均清理原拖动', () => {
  const view = render(<View />); let host = view.getByRole('region', { name: '时间线编辑区域' }); const original = current().id
  for (const cancel of ['escape', 'capture', 'blur'] as const) {
    const baseline = owner.document; const history = owner.past.length
    fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20)); fireEvent.pointerMove(host, event(header + 40))
    if (cancel === 'escape') fireEvent.keyDown(host, { key: 'Escape' })
    if (cancel === 'capture') fireEvent.lostPointerCapture(host)
    if (cancel === 'blur') fireEvent(window, new Event('blur'))
    fireEvent.pointerUp(host, event(header + 40)); expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
  }
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20)); fireEvent.pointerMove(host, event(header + 40))
  act(() => { const second = appendVideoEditSequence(owner.document.id); switchVideoEditSequence(owner.document.id, second) })
  const baseline = owner.document; fireEvent.pointerUp(host, event(header + 40)); host = view.getByRole('region', { name: '时间线编辑区域' }); fireEvent.pointerUp(host, event(header + 40))
  expect(owner.document).toBe(baseline); expect(current().clips).toEqual([])
  act(() => switchVideoEditSequence(owner.document.id, original)); host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20)); fireEvent.pointerMove(host, event(header + 40)); view.unmount()
  expect(current().clips[0].start).toBe(0); expect(onError).not.toHaveBeenCalled()
})

it('时间线浮出到系统窗口（另一 realm 文档）后仍可点选、拖动并按浮窗窗口失焦取消', () => {
  const frame = document.createElement('iframe'); document.body.append(frame)
  const popout = frame.contentWindow as Window & typeof globalThis
  // 复制主 realm 的测试桩：浮窗元素使用子窗口自己的原型与事件构造器。
  const captures = new WeakMap<Element, number>()
  Object.defineProperties(popout.HTMLElement.prototype, {
    getBoundingClientRect: { configurable: true, value: () => ({ left: 0, top: 0, right: 900, bottom: 300, width: 900, height: 300, x: 0, y: 0, toJSON: () => ({}) }) },
    clientHeight: { configurable: true, get: () => viewportHeight },
    clientWidth: { configurable: true, get: () => 900 },
    setPointerCapture: { configurable: true, value(this: HTMLElement, id: number) { captures.set(this, id) } },
    hasPointerCapture: { configurable: true, value(this: HTMLElement, id: number) { return captures.get(this) === id } },
    releasePointerCapture: { configurable: true, value(this: HTMLElement) { captures.delete(this) } },
  })
  Object.assign(popout, { PointerEvent: class extends popout.MouseEvent { readonly pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } } })
  const view = render(<>{createPortal(<View />, popout.document.body)}</>)
  const within = (selector: string): HTMLElement => popout.document.querySelector<HTMLElement>(selector)!
  const host = within('[data-video-edit-timeline-viewport]'); const video = within('[aria-label="选择片段 视频"]')
  expect(video instanceof HTMLElement).toBe(false)
  fireEvent.pointerDown(video, event(header + 20)); fireEvent.pointerUp(host, event(header + 20))
  expect(owner.selectedClipIds).toEqual([ids[0]])
  // 主窗口失焦（焦点移到浮窗）不取消浮窗中的拖动；释放提交一次历史。
  let history = owner.past.length
  fireEvent.pointerDown(video, event(header + 20)); fireEvent.pointerMove(host, event(header + 40))
  fireEvent(window, new Event('blur'))
  fireEvent.pointerUp(host, event(header + 40))
  expect(current().clips[0].start).toBe(10); expect(owner.past).toHaveLength(history + 1)
  // 浮窗自身失焦取消拖动。
  const baseline = owner.document; history = owner.past.length
  fireEvent.pointerDown(within('[aria-label="选择片段 视频"]'), event(header + 40)); fireEvent.pointerMove(host, event(header + 60))
  fireEvent(popout, new popout.Event('blur'))
  fireEvent.pointerUp(host, event(header + 60))
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
  view.unmount(); frame.remove()
  expect(onError).not.toHaveBeenCalled()
})

it('高度只在释放提交一次，实际32轨道与高度用于纵向命中', () => {
  editVideoProject(owner.document.id, document => { const track = document.sequences[0].tracks[1]; document.sequences[0].tracks = Array.from({ length: 32 }, (_, index) => ({ ...track, id: `track-${index}`, index, kind: index === 0 ? 'audio' as const : 'video' as const, name: `轨道${index}` })); return document })
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' }); const history = owner.past.length
  expect(current().tracks).toHaveLength(32)
  expect(view.container.querySelectorAll('[data-video-edit-track]').length).toBeLessThan(20)
  const resizeY = trackClientY() + 15
  fireEvent.pointerDown(view.getByRole('separator', { name: '调整轨道1高度' }), event(100, resizeY)); fireEvent.pointerMove(host, event(100, resizeY + 40))
  expect(current().tracks[1].height).toBeUndefined(); expect(owner.past).toHaveLength(history)
  fireEvent.pointerUp(host, event(100, resizeY + 40)); expect(current().tracks[1].height).toBe(72); expect(owner.past).toHaveLength(history + 1)
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20))
  // 拖动中 Ctrl+滚轮把视频区往上滚，露出上层轨道（只滚光标所在的视频区）
  fireEvent.wheel(host, { deltaY: -830, ctrlKey: true, clientX: 300, clientY: 60 }); const targetY = trackClientY(29)
  expect(targetY).toBeGreaterThanOrEqual(28); expect(targetY).toBeLessThan(160)
  fireEvent.pointerMove(host, event(header + 20, targetY)); fireEvent.pointerUp(host, event(header + 20, targetY))
  expect(current().clips[0].track).toBe(29); expect(onError).not.toHaveBeenCalled()
})

it('手形只滚动，轨道向前选择按命中轨道和位置', () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.click(view.getByRole('button', { name: '向前选择轨道工具' })); fireEvent.pointerDown(host, event(header + 90)); expect(owner.selectedClipIds).toEqual([ids[1]])
  const baseline = owner.document
  fireEvent.click(view.getByRole('button', { name: '手形工具' })); fireEvent.pointerDown(host, event(500, 200)); fireEvent.pointerMove(host, event(450, 150)); fireEvent.pointerUp(host, event(450, 150))
  expect(host.scrollLeft).toBe(50); expect(owner.document).toBe(baseline)
  // 手形纵向拖动滚动按下处所在的区：视频区往下拖露出上层轨道
  const before = trackTop(1); fireEvent.pointerDown(host, event(500, 100)); fireEvent.pointerMove(host, event(500, 140)); fireEvent.pointerUp(host, event(500, 140))
  expect(trackTop(1)).toBe(before + 40); expect(onError).not.toHaveBeenCalled()
})

it('PR 工具：波纹拖出点后面片段跟着移且一步撤销，外滑只换源内容，向后选择轨道，文字工具在空白处放文字', async () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  const tool = (id: Parameters<typeof executeVideoEditCommand>[1]) => act(() => executeVideoEditCommand(captureVideoEditCommandContext(owner.document.id, 'timeline'), id))
  // 片段：视频 [0,30)，代码 [60,90)；每帧 2px
  fireEvent.click(view.getByRole('button', { name: '波纹编辑工具' })); expect(owner.tool).toBe('ripple')
  const history = owner.past.length
  fireEvent.pointerDown(view.getByRole('button', { name: '裁剪视频出点' }), event(header + 60)); fireEvent.pointerMove(host, event(header + 80)); fireEvent.pointerUp(host, event(header + 80))
  expect(current().clips.map(clip => [clip.start, clip.duration])).toEqual([[0, 40], [70, 30]]); expect(owner.past).toHaveLength(history + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(current().clips.map(clip => [clip.start, clip.duration])).toEqual([[0, 30], [60, 30]])
  await tool('slip_tool')
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 40)); fireEvent.pointerMove(host, event(header + 20)); fireEvent.pointerUp(host, event(header + 20))
  expect(current().clips[0]).toMatchObject({ start: 0, duration: 30 }); expect(current().clips[0].sourceInUs).toBe(Math.round(10 / 30 * 1e6))
  await tool('track_backward_tool')
  fireEvent.pointerDown(host, event(header + 150)); expect(new Set(owner.selectedClipIds)).toEqual(new Set(ids))
  await tool('type_tool')
  fireEvent.pointerDown(host, event(header + 220)); fireEvent.pointerUp(host, event(header + 220))
  const text = current().clips.find(clip => clip.kind === 'text')!
  expect(text).toMatchObject({ start: 110, duration: 90, track: 1 }); expect(owner.selectedClipIds).toEqual([text.id]); expect(owner.activePanel).toBe('effects')
  expect(onError).not.toHaveBeenCalled()
})

it('真实入出点拖动、播放头吸附和冲突失败保留基线', () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.pointerDown(view.getByRole('button', { name: '裁剪视频出点' }), event(header + 60)); fireEvent.pointerMove(host, event(header + 80)); fireEvent.pointerUp(host, event(header + 80))
  expect(current().clips[0].duration).toBe(40)
  act(() => { setVideoEditTimelineView(owner.document.id, { snapping: true }); setVideoEditView(owner.document.id, { frame: 50 }) })
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20)); fireEvent.pointerMove(host, event(header + 37)); fireEvent.pointerUp(host, event(header + 37))
  expect(current().clips[0].start).toBe(10)
  const baseline = owner.document; const history = owner.past.length
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 40)); fireEvent.pointerMove(host, event(header + 100)); fireEvent.pointerUp(host, event(header + 100))
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history); expect(onError.mock.calls.at(-1)![0].message).toContain('已有片段')
})

it('空白点击与静止片段点击不编辑或定位，标尺实际定位更新叶子读数', () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' }); const baseline = owner.document; const history = owner.past.length
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20)); fireEvent.pointerUp(host, event(header + 20))
  fireEvent.pointerDown(host, event(header + 400, 120)); fireEvent.pointerUp(host, event(header + 400, 120))
  expect(owner.selectedClipIds).toEqual([]); expect(owner.frame).toBe(0); expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
  const ruler = view.getByRole('slider', { name: '剪辑时间定位' })
  fireEvent.pointerDown(ruler, event(header + 40, 14)); fireEvent.pointerUp(host, event(header + 40, 14))
  expect(owner.frame).toBe(20); expect(ruler.getAttribute('aria-valuenow')).toBe('20'); expect(owner.scrubbing).toBe(false)
  act(() => setVideoEditView(owner.document.id, { frame: 31 })); expect(ruler.getAttribute('aria-valuenow')).toBe('31'); expect(view.getByLabelText('当前时间码').textContent).toBe('00:00:01:01')
  expect(owner.document).toBe(baseline); expect(onError).not.toHaveBeenCalled()
})

it('边缘持续滚动使用同一命中坐标，取消释放动画资源且无领域草稿', () => {
  editVideoProject(owner.document.id, document => { document.sequences[0].clips[1].track = 2; return document })
  const callbacks = new Map<number, FrameRequestCallback>(); let token = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++token, callback); return token })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' }); const baseline = owner.document
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20)); fireEvent.pointerMove(host, event(895))
  const [id, callback] = [...callbacks.entries()][0]; callbacks.delete(id)
  act(() => callback(16)); expect(host.scrollLeft).toBeGreaterThan(0)
  expect(owner.document).toBe(baseline)
  fireEvent.pointerCancel(host, event(895)); expect(callbacks.size).toBe(0)
  fireEvent.pointerUp(host, event(895)); expect(owner.document).toBe(baseline); expect(onError).not.toHaveBeenCalled()
})

it('矮时间线：片段拖向所在区的边缘才滚动这一区，按住不动不滚；框选与标尺横向一致', () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => ({ left: 0, top: 0, right: 900, bottom: 118, width: 900, height: 118, x: 0, y: 0, toJSON: () => ({}) }))
  viewportHeight = 118
  const clock = layoutClock()
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' }); const baseline = owner.document
  const y = trackClientY(); const top = trackTop(1)
  expect(y).toBeGreaterThanOrEqual(28); expect(y).toBeLessThan(69) // 视频区 [28, 69)
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20, y))
  fireEvent.pointerMove(host, event(header + 20, y)); fireEvent.pointerMove(host, event(header + 21, y + 1))
  expect(clock.callbacks.size).toBe(0); expect(trackTop(1)).toBe(top)
  fireEvent.pointerMove(host, event(header + 20, y - 10))
  expect(clock.callbacks.size).toBe(1); clock.step(); expect(trackTop(1)).toBeGreaterThan(top)
  fireEvent.pointerCancel(host, event(header + 20, y - 10)); expect(clock.callbacks.size).toBe(0); expect(owner.document).toBe(baseline)
  for (const [pressY, label] of [[100, 'box'], [14, 'ruler']] as const) {
    const target = label === 'ruler' ? view.getByRole('slider', { name: '剪辑时间定位' }) : host
    fireEvent.pointerDown(target, event(890, pressY)); fireEvent.pointerMove(host, event(890, pressY))
    expect(clock.callbacks.size).toBe(0); expect(host.scrollLeft).toBe(0)
    fireEvent.pointerMove(host, event(896, pressY)); expect(clock.callbacks.size).toBe(1)
    clock.step(); expect(host.scrollLeft).toBeGreaterThan(0)
    fireEvent.pointerCancel(host, event(896, pressY)); expect(clock.callbacks.size).toBe(0)
    host.scrollLeft = 0; fireEvent.scroll(host)
  }
  expect(owner.document).toBe(baseline); expect(onError).not.toHaveBeenCalled()
})

it('滚轮横向滚动、Ctrl 纵向；Alt 缩放保持光标处时间；Shift 纵向缩放停下后只写一步历史', async () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.wheel(host, { deltaY: 120 }); expect(host.scrollLeft).toBe(120)
  // Ctrl+滚轮只滚光标所在的区：视频区往上滚，音频区不动
  const videoTop = trackTop(1); const audioTop = trackTop(0)
  fireEvent.wheel(host, { deltaY: -40, ctrlKey: true, clientY: 100 }); expect(trackTop(1)).toBe(videoTop + 40); expect(trackTop(0)).toBe(audioTop)
  fireEvent.wheel(host, { deltaY: 40, ctrlKey: true, clientY: 100 }); expect(trackTop(1)).toBe(videoTop)
  host.scrollLeft = 0; fireEvent.scroll(host)
  const pixels = 60 * owner.zoom / current().fps; const anchor = (300 - header) / pixels
  fireEvent.wheel(host, { deltaY: -100, altKey: true, clientX: 300, clientY: 100 })
  expect(owner.zoom).toBeCloseTo(1.25)
  const after = 60 * owner.zoom / current().fps
  expect((host.scrollLeft + 300 - header) / after).toBeCloseTo(anchor)
  const history = owner.past.length; const video = current().tracks.find(track => track.kind === 'video')!
  fireEvent.wheel(host, { deltaY: -100, shiftKey: true, clientX: 300, clientY: trackClientY(video.index) })
  fireEvent.wheel(host, { deltaY: -100, shiftKey: true, clientX: 300, clientY: trackClientY(video.index) })
  expect(owner.past.length).toBe(history)
  await waitFor(() => expect(owner.past.length).toBe(history + 1))
  expect(current().tracks.find(track => track.id === video.id)!.height).toBe((video.height ?? 32) + 16)
  expect(onError).not.toHaveBeenCalled()
})

it('时间线工具按钮共用命令与自定义键位', () => {
  const view = render(<View />)
  const previous = useSettingsStore.getState().videoEditShortcuts
  try {
    act(() => useSettingsStore.getState().setVideoEditShortcuts({ ...previous, select_tool: { code: 'F9', ctrl: false, alt: false, shift: false, meta: false } }))
    expect(view.getByRole('button', { name: '选择工具' }).getAttribute('title')).toBe('选择工具（F9）')
    fireEvent.click(view.getByRole('button', { name: '吸附' })); expect(owner.snapping).toBe(true)
  } finally { act(() => useSettingsStore.getState().setVideoEditShortcuts(previous)) }
  expect(onError).not.toHaveBeenCalled()
})

it('右键菜单消费正式启用状态与标签，延迟操作保留原片段和播放头', async () => {
  const view = render(<View />)
  act(() => setVideoEditView(owner.document.id, { frame: 10 }))
  fireEvent.contextMenu(view.getByRole('button', { name: '选择片段 视频' }), { clientX: 300, clientY: 80 })
  expect(view.getByRole('menuitem', { name: '复制片段（Ctrl+C）' }).getAttribute('aria-disabled')).toBe('false')
  expect(view.getByRole('menuitem', { name: '链接片段' }).getAttribute('aria-disabled')).toBe('true')
  expect(view.getByRole('menuitem', { name: '拆开音画' }).getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(view.getByRole('menuitem', { name: '在播放头拆分（Ctrl+K）' }))
  act(() => { setVideoEditView(owner.document.id, { frame: 20 }); setVideoEditTimelineView(owner.document.id, { selectedClipIds: [ids[1]] }) })
  await waitFor(() => expect(current().clips).toHaveLength(3))
  expect(current().clips.find(clip => clip.id === ids[0])!.duration).toBe(10)
  expect(current().clips.find(clip => clip.id === ids[1])!.duration).toBe(30); expect(onError).not.toHaveBeenCalled()
})

it('关联片段右键按点击主对象定位项目与属性，代码素材保持自己的源禁用状态', async () => {
  executeVideoEditTimelineEdit(owner.document.id, current().id, { kind: 'group', clipIds: ids })
  const view = render(<View />)
  fireEvent.contextMenu(view.getByRole('button', { name: '选择片段 代码' }), { clientX: 400, clientY: 80 })
  expect(view.getByRole('menuitem', { name: '打开源素材' }).getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(view.getByRole('menuitem', { name: '在素材中定位' }))
  await waitFor(() => expect(owner.selectedItemIds).toEqual(['code-item'])); expect(owner.activePanel).toBe('project')
  fireEvent.contextMenu(view.getByRole('button', { name: '选择片段 代码' }), { clientX: 400, clientY: 80 }); fireEvent.click(view.getByRole('menuitem', { name: '编辑片段属性' }))
  await waitFor(() => expect(owner.activePanel).toBe('effects')); expect(owner.selection).toBe(ids[1]); expect(new Set(owner.selectedClipIds)).toEqual(new Set(ids)); expect(onError).not.toHaveBeenCalled()
})

it('剃刀释放时固定最初点击片段，移动改变落点且切序列取消', () => {
  const view = render(<View />); let host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.click(view.getByRole('button', { name: '剃刀工具' }))
  const history = owner.past.length
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20)); fireEvent.pointerMove(host, event(header + 30)); expect(current().clips).toHaveLength(2)
  fireEvent.pointerUp(host, event(header + 30)); expect(current().clips.find(clip => clip.id === ids[0])!.duration).toBe(15); expect(owner.past).toHaveLength(history + 1)
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 代码' }), event(header + 140))
  act(() => { const next = appendVideoEditSequence(owner.document.id); switchVideoEditSequence(owner.document.id, next) })
  const baseline = owner.document; fireEvent.pointerUp(host, event(header + 150)); host = view.getByRole('region', { name: '时间线编辑区域' }); fireEvent.pointerUp(host, event(header + 150))
  expect(owner.document).toBe(baseline); expect(current().clips).toEqual([]); expect(onError).not.toHaveBeenCalled()
})

it('交错32轨道与500片段分成音画两区，各自纵向滚动，DOM仍有界', () => {
  const tracks = mixedTracks()
  editVideoProject(owner.document.id, document => {
    const sequence = document.sequences[0]; const clip = sequence.clips[0]
    sequence.tracks = tracks
    sequence.clips = Array.from({ length: 500 }, (_, index) => ({ ...clip, id: `clip-${index}`, start: index * 100, duration: 10 }))
    return document
  })
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  const displayedTracks = [...view.container.querySelectorAll('[data-video-edit-track]')]
  expect(displayedTracks.length).toBeLessThan(20)
  const mounted = new Set(displayedTracks.map(row => Number(row.getAttribute('data-track-index'))))
  expect(displayedTracks.map(row => Number(row.getAttribute('data-track-index')))).toEqual([...Array.from({ length: 16 }, (_, index) => 31 - index * 2), ...Array.from({ length: 16 }, (_, index) => index * 2)].filter(index => mounted.has(index)))
  expect(current().tracks).toEqual(tracks)
  // 初次即见底层画面（V1 贴分隔条上方）与首条声音（A1 贴下方）
  const divider = view.getByRole('separator', { name: '画面与声音轨道分界' }) as HTMLElement
  expect(trackTop(1) + 32).toBe(Number.parseFloat(divider.style.top)); expect(trackTop(0)).toBe(Number.parseFloat(divider.style.top) + 8)
  expect(view.container.querySelectorAll('[data-video-edit-region-scrollbar]')).toHaveLength(2)
  expect(view.container.querySelector('[data-video-edit-clip="clip-0"]')).not.toBeNull()
  expect(view.container.querySelectorAll('[data-video-edit-clip]').length).toBeGreaterThan(0)
  expect(view.container.querySelectorAll('[data-video-edit-clip]').length).toBeLessThan(10)
  // 音频区往下滚，视频区不动
  const video = trackTop(1); fireEvent.wheel(host, { deltaY: 64, ctrlKey: true, clientY: 250 })
  expect(trackTop(0)).toBe(Number.parseFloat(divider.style.top) + 8 - 64); expect(trackTop(1)).toBe(video)
  host.scrollLeft = 10000; fireEvent.scroll(host)
  expect(view.container.querySelector('[data-video-edit-clip="clip-0"]')).toBeNull(); expect(view.container.querySelector('[data-video-edit-clip="clip-50"]')).not.toBeNull()
  expect(view.container.querySelectorAll('[data-video-edit-clip]').length).toBeLessThan(10); expect(view.container.querySelector('[data-video-edit-ruler]')!.querySelectorAll('span:not([aria-hidden])').length).toBeLessThan(20); expect(view.container.querySelector('[data-video-edit-ruler]')!.querySelectorAll('span').length).toBeLessThan(200)
  expect(onError).not.toHaveBeenCalled()
})

it('素材项拖放按重排后的原轨道命中，音画分界不产生伪落点或历史', async () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  const transfer = { types: [VIDEO_EDIT_ITEM_DRAG_MIME], getData: () => JSON.stringify({ projectId: owner.document.id, itemIds: ['video-item'] }) }
  const baseline = owner.document; const history = owner.past.length
  const divider = Number.parseFloat((view.getByRole('separator', { name: '画面与声音轨道分界' }) as HTMLElement).style.top)
  fireEvent.dragOver(host, { clientX: header + 200, clientY: divider, dataTransfer: transfer })
  fireEvent.drop(host, { clientX: header + 200, clientY: divider, dataTransfer: transfer })
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
  expect(onError).toHaveBeenCalledOnce()
  expect(onError.mock.calls[0][0]).toMatchObject({ message: '拖入位置不在可用轨道上，请把素材拖到时间线轨道内。' })
  onError.mockClear()
  const y = trackClientY(3)
  fireEvent.dragOver(host, { clientX: header + 200, clientY: y, dataTransfer: transfer })
  expect(view.getByText('释放以添加素材')).not.toBeNull()
  fireEvent.drop(host, { clientX: header + 200, clientY: y, dataTransfer: transfer })
  await waitFor(() => expect(current().clips).toHaveLength(3))
  expect(current().clips.at(-1)).toMatchObject({ itemId: 'video-item', track: 3, start: 100 })
  expect(owner.past).toHaveLength(history + 1); expect(onError).not.toHaveBeenCalled()
})

function linkedPair(): { picture: string; sound: string } {
  editVideoProject(owner.document.id, document => { document.media[0].hasAudio = true; return document })
  executeVideoEditTimelineEdit(owner.document.id, current().id, { kind: 'separate_audio', clipIds: [ids[0]], audioTrack: 0 })
  setVideoEditTimelineView(owner.document.id, { selectedClipIds: [] })
  return { picture: ids[0], sound: current().clips.find(clip => clip.kind === 'audio')!.id }
}
const clipButton = (view: ReturnType<typeof render>, id: string): HTMLElement => view.container.querySelector<HTMLElement>(`[data-video-edit-clip="${id}"] [aria-label^="选择片段"]`)!
const syncBadges = (view: ReturnType<typeof render>) => Object.fromEntries([...view.container.querySelectorAll('[data-video-edit-sync-offset]')].map(badge => [badge.closest('[data-video-edit-clip]')!.getAttribute('data-video-edit-clip'), badge.textContent]))

it('Alt 点击单独选中链接中的声音，松开 Alt 拖动后显示失步帧数，右键移入同步恢复且链接保留', async () => {
  const { picture, sound } = linkedPair()
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.pointerDown(clipButton(view, sound), event(header + 20, trackClientY(0))); fireEvent.pointerUp(host, event(header + 20, trackClientY(0)))
  expect(new Set(owner.selectedClipIds)).toEqual(new Set([picture, sound]))
  fireEvent.pointerDown(clipButton(view, sound), event(header + 20, trackClientY(0), { altKey: true })); fireEvent.pointerUp(host, event(header + 20, trackClientY(0)))
  expect(owner.selectedClipIds).toEqual([sound])
  // Premiere：Alt 只在按下时决定单选；拖动时按住 Alt 是复制，所以移动单侧要松开 Alt 再拖。
  fireEvent.pointerDown(clipButton(view, sound), event(header + 20, trackClientY(0)))
  fireEvent.pointerMove(host, event(header + 30, trackClientY(0)))
  expect(syncBadges(view)).toEqual({ [picture]: '-5', [sound]: '+5' })
  fireEvent.pointerUp(host, event(header + 30, trackClientY(0)))
  expect(current().clips.find(clip => clip.id === sound)!.start).toBe(5); expect(current().clips.find(clip => clip.id === picture)!.start).toBe(0)
  expect(current().clips.find(clip => clip.id === sound)!.linkId).toBe(current().clips.find(clip => clip.id === picture)!.linkId)
  expect(syncBadges(view)).toEqual({ [picture]: '-5', [sound]: '+5' })
  fireEvent.contextMenu(clipButton(view, sound), { clientX: 300, clientY: 80 })
  expect(owner.selectedClipIds).toEqual([sound])
  fireEvent.click(view.getByRole('menuitem', { name: '移入同步' }))
  await waitFor(() => expect(current().clips.find(clip => clip.id === sound)!.start).toBe(0))
  expect(syncBadges(view)).toEqual({}); expect(onError).not.toHaveBeenCalled()
})

it('链接选择开关关闭后点击只选一条；剃刀联动拆开链接组，Alt 剃刀只拆一条；解除链接后完全独立', async () => {
  const { picture, sound } = linkedPair()
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  const toggle = view.getByRole('button', { name: '链接选择' })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(toggle); expect(owner.linkedSelection).toBe(false); expect(toggle.getAttribute('aria-pressed')).toBe('false')
  fireEvent.pointerDown(clipButton(view, picture), event(header + 20)); fireEvent.pointerUp(host, event(header + 20))
  expect(owner.selectedClipIds).toEqual([picture])
  fireEvent.pointerDown(clipButton(view, sound), event(header + 20, trackClientY(0), { altKey: true, shiftKey: true })); fireEvent.pointerUp(host, event(header + 20, trackClientY(0)))
  expect(new Set(owner.selectedClipIds)).toEqual(new Set([picture, sound]))
  fireEvent.click(toggle); expect(owner.linkedSelection).toBe(true)
  fireEvent.click(view.getByRole('button', { name: '剃刀工具' }))
  fireEvent.pointerDown(clipButton(view, picture), event(header + 20)); fireEvent.pointerUp(host, event(header + 20))
  await waitFor(() => expect(current().clips).toHaveLength(5))
  const right = current().clips.filter(clip => clip.start === 10 && clip.id !== ids[1])
  expect(right).toHaveLength(2); expect(right[0].linkId).toBe(right[1].linkId)
  expect(right[0].linkId).not.toBe(current().clips.find(clip => clip.id === picture)!.linkId)
  const rightSound = right.find(clip => clip.kind === 'audio')!
  fireEvent.pointerDown(clipButton(view, rightSound.id), event(header + 40, trackClientY(0), { altKey: true })); fireEvent.pointerUp(host, event(header + 40, trackClientY(0)))
  await waitFor(() => expect(current().clips).toHaveLength(6))
  expect(current().clips.filter(clip => clip.linkId === rightSound.linkId)).toHaveLength(3)
  fireEvent.click(view.getByRole('button', { name: '选择工具' }))
  fireEvent.contextMenu(clipButton(view, picture), { clientX: 300, clientY: 80 })
  fireEvent.click(view.getByRole('menuitem', { name: '解除链接' }))
  await waitFor(() => expect(current().clips.find(clip => clip.id === picture)!.linkId).toBeUndefined())
  expect(current().clips.find(clip => clip.id === sound)!.linkId).toBeUndefined()
  act(() => setVideoEditTimelineView(owner.document.id, { selectedClipIds: [] }))
  fireEvent.pointerDown(clipButton(view, picture), event(header + 10)); fireEvent.pointerUp(host, event(header + 10))
  expect(owner.selectedClipIds).toEqual([picture]); expect(onError).not.toHaveBeenCalled()
})

it('关闭链接选择后点击编组内片段仍选中整组，只有按住 Alt 才单独选中一条', () => {
  executeVideoEditTimelineEdit(owner.document.id, current().id, { kind: 'group', clipIds: ids })
  setVideoEditTimelineView(owner.document.id, { selectedClipIds: [], linkedSelection: false })
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.pointerDown(clipButton(view, ids[0]), event(header + 20)); fireEvent.pointerUp(host, event(header + 20))
  expect(new Set(owner.selectedClipIds)).toEqual(new Set(ids))
  fireEvent.pointerDown(clipButton(view, ids[1]), event(header + 140, trackClientY(), { altKey: true })); fireEvent.pointerUp(host, event(header + 140))
  expect(owner.selectedClipIds).toEqual([ids[1]]); expect(onError).not.toHaveBeenCalled()
})

it('声道映射片段按每个片段声道各画一条波形并按声音流与声道取波形，悬停与轨道头显示声道类型；右键“音频声道…”打开只改源声道的设置（2.6）', async () => {
  const requests: Array<{ audioStream?: number; audioChannel?: number; channels: number }> = []
  vi.spyOn(getPlatform().audioEdit, 'extractWaveformPyramid').mockImplementation(async request => {
    requests.push({ audioStream: request.audioStream ?? 0, audioChannel: request.audioChannel, channels: request.channels })
    return { version: `v${request.audioStream ?? 0}`, sampleRate: 48000, frameCount: 48000 * 30, startSeconds: 0, endSeconds: 30, amplitudeScale: 1, peakMax: .5, channelCount: 1, levels: [{ samplesPerBucket: 128, bucketCount: 11250, peak: [new Uint16Array(11250).fill(32768)], rms: [new Uint16Array(11250).fill(19660)] }] }
  })
  const { sound } = linkedPair()
  editVideoProject(owner.document.id, document => {
    document.media[0].audioStreams = [{ channels: 1 }, { channels: 1 }]
    document.sequences[0].clips = document.sequences[0].clips.map(clip => clip.id === sound ? { ...clip, audioMapping: { format: 'stereo', sources: [{ stream: 0, channel: 0 }, { stream: 1, channel: 0 }] } } : clip)
    return document
  })
  const view = render(<View />)
  await waitFor(() => expect(view.container.querySelector(`[data-video-edit-waveform="${sound}"]`)?.getAttribute('data-waveform-lanes')).toBe('2'))
  expect(requests).toEqual(expect.arrayContaining([{ audioStream: 0, audioChannel: 0, channels: 1 }, { audioStream: 1, audioChannel: 0, channels: 1 }]))
  expect(clipButton(view, sound).getAttribute('title')).toBe('视频 · 立体声')
  expect([...view.container.querySelectorAll('[data-video-edit-track-channels]')].map(node => [node.closest('[data-track-index]')!.getAttribute('data-track-index'), node.textContent])).toEqual([['0', '立体声']])
  expect(view.container.querySelector(`[data-video-edit-clip="${sound}"] [data-video-edit-audio-format]`)?.getAttribute('data-video-edit-audio-format')).toBe('stereo')
  fireEvent.contextMenu(clipButton(view, sound), { clientX: 300, clientY: 80 })
  fireEvent.click(view.getByRole('menuitem', { name: '音频声道…' }))
  await waitFor(() => expect(view.getByLabelText('左源声道')).toBeTruthy())
  expect((view.getByLabelText('右源声道') as HTMLSelectElement).value).toBe('1:0')
  expect(view.queryByLabelText('音频声道预设')).toBeNull()
  expect(onError).not.toHaveBeenCalled()
})

it('视频片段显示缩略图条：首格取入点画面，只铺可见范围，滚动换批后复用已取的帧；代码片段不取帧（2.4）', async () => {
  const requests: Array<{ timeUs: number; height: number }> = []
  vi.spyOn(getPlatform().video, 'getFilmstripFrame').mockImplementation(async ({ source, timeUs, height }) => {
    requests.push({ timeUs, height })
    return { path: `${source}.${timeUs}.${height}.webp` }
  })
  editVideoProject(owner.document.id, document => {
    const sequence = document.sequences[0]
    // A twenty-minute clip whose in point is 2.5s into the source; far wider than the viewport.
    sequence.clips = sequence.clips.map((clip, index) => index === 0 ? { ...clip, duration: 30 * 1200, sourceInUs: 2_500_000 } : { ...clip, start: 30 * 1200 + 10 })
    document.media[0].durationSeconds = 4000
    return document
  })
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  const strip = (): HTMLElement => view.container.querySelector<HTMLElement>(`[data-video-edit-filmstrip="${ids[0]}"]`)!
  await waitFor(() => expect(Number(strip().getAttribute('data-filmstrip-ready'))).toBe(Number(strip().getAttribute('data-filmstrip-tiles'))))
  const tiles = Number(strip().getAttribute('data-filmstrip-tiles'))
  // Only the visible span (≈ 692px at a 26px-tall square tile) plus one tile each side, not the whole clip.
  expect(tiles).toBeGreaterThan(20); expect(tiles).toBeLessThan(40)
  expect(requests[0]).toEqual({ timeUs: 2_500_000, height: 32 })
  expect(strip().querySelectorAll('img')).toHaveLength(tiles)
  expect(view.container.querySelector(`[data-video-edit-filmstrip="${ids[1]}"]`)).toBeNull()
  const firstBatch = requests.length
  host.scrollLeft = 300; fireEvent.scroll(host)
  await waitFor(() => expect(requests.length).toBeGreaterThan(firstBatch))
  // Tiles already fetched are not requested again; the new batch only adds the newly visible ones.
  expect(new Set(requests.map(request => request.timeUs)).size).toBe(requests.length)
  expect(requests.length - firstBatch).toBeLessThan(16)
  expect(onError).not.toHaveBeenCalled()
})

it('轨道头按 PR 默认只放几个开关，右键“自定义…”用按钮编辑器加按钮；点编号名称设为目标并整行高亮（2.4）', async () => {
  const view = render(<View />)
  const video = current().tracks.find(track => track.index === 1)!; const audio = current().tracks.find(track => track.kind === 'audio')!
  const header = view.container.querySelector<HTMLElement>(`[data-video-edit-track-header="${video.id}"]`)!
  expect(header.querySelector('[data-video-edit-track-code]')!.textContent).toBe('V1')
  expect(view.container.querySelector(`[data-video-edit-track-header="${audio.id}"] [data-video-edit-track-code]`)!.textContent).toBe('A1')
  const order = (id: string): string[] => [...view.container.querySelectorAll(`[data-video-edit-track-header="${id}"] button`)].map(button => button.getAttribute('aria-label')!.replace(/^.*?(设为目标|同步锁定|输出|锁定|静音|独奏)$/, '$1')).slice(1)
  expect(order(video.id)).toEqual(['锁定', '同步锁定', '输出'])
  expect(order(audio.id)).toEqual(['锁定', '静音', '独奏'])
  for (const label of ['锁定', '同步锁定', '输出']) { const toggle = view.getByRole('button', { name: `${video.name}${label}` }); expect(toggle.querySelector('svg')).not.toBeNull(); expect(toggle.textContent).toBe('') }
  expect(view.getByRole('button', { name: `${video.name}输出` }).getAttribute('aria-pressed')).toBe('true')
  try {
    fireEvent.contextMenu(header, { clientX: 40, clientY: 100 })
    fireEvent.click(await view.findByText('自定义…'))
    fireEvent.click(await view.findByRole('button', { name: '设为目标' }))
    fireEvent.click(view.getByRole('button', { name: '确定' }))
    await waitFor(() => expect(order(video.id)).toEqual(['锁定', '同步锁定', '输出', '设为目标']))
    expect(useSettingsStore.getState().videoEditTrackHeaderButtons).toEqual({ video: ['locked', 'sync', 'enabled', 'target'] })
    expect(order(audio.id)).toEqual(['锁定', '静音', '独奏'])
  } finally { act(() => useSettingsStore.getState().setVideoEditTrackHeaderButtons('video', null)) }
  const targeted = owner.targetTrackIds.includes(video.id)
  fireEvent.click(view.getByRole('button', { name: `目标轨道 ${video.name}` }))
  expect(owner.targetTrackIds.includes(video.id)).toBe(!targeted); expect(header.className.includes('bg-raised')).toBe(!targeted)
  expect(onError).not.toHaveBeenCalled()
})

it('轨道头右键：添加／删除单个轨道各一步撤销，重命名，删除轨道…删除所有空轨道（2.4）', async () => {
  const view = render(<View />)
  const v1 = current().tracks.find(track => track.index === 1)!
  const headerOf = (id: string) => view.container.querySelector<HTMLElement>(`[data-video-edit-track-header="${id}"]`)!
  const count = (kind: 'video' | 'audio') => current().tracks.filter(track => track.kind === kind).length
  const history = owner.past.length
  fireEvent.contextMenu(headerOf(v1.id), { clientX: 40, clientY: 100 }); fireEvent.click(await view.findByText('添加单个轨道'))
  await waitFor(() => expect(count('video')).toBe(8)); expect(owner.past).toHaveLength(history + 1)
  // 新轨道紧贴在 V1 之上，原 V2 及以上顺延为 V3…
  const codes = [...view.container.querySelectorAll('[data-video-edit-track-code]')].map(node => node.textContent)
  expect(codes.filter(code => code?.startsWith('V'))).toEqual(['V7', 'V6', 'V5', 'V4', 'V3', 'V2', 'V1'])
  expect(current().clips.every(clip => current().tracks.some(track => track.index === clip.track))).toBe(true)
  act(() => undoVideoEdit(owner.document.id)); expect(count('video')).toBe(7)
  fireEvent.contextMenu(headerOf(v1.id), { clientX: 40, clientY: 100 }); fireEvent.click(await view.findByText('重命名'))
  const input = await view.findByRole('textbox', { name: '轨道名称' })
  fireEvent.change(input, { target: { value: '主画面' } }); fireEvent.keyDown(input, { key: 'Enter' })
  expect(current().tracks.find(track => track.id === v1.id)!.name).toBe('主画面')
  // V1 上有片段：删除单个轨道连同片段删除
  fireEvent.contextMenu(headerOf(v1.id), { clientX: 40, clientY: 100 }); fireEvent.click(await view.findByText('删除单个轨道'))
  await waitFor(() => expect(current().tracks.some(track => track.id === v1.id)).toBe(false)); expect(current().clips).toEqual([])
  act(() => undoVideoEdit(owner.document.id)); expect(current().clips).toHaveLength(2)
  fireEvent.contextMenu(headerOf(v1.id), { clientX: 40, clientY: 100 }); fireEvent.click(await view.findByText('删除轨道…'))
  fireEvent.click(await view.findByRole('button', { name: '删除 6 条轨道' }))
  expect(count('video')).toBe(1); expect(count('audio')).toBe(1); expect(current().clips).toHaveLength(2)
  expect(onError).not.toHaveBeenCalled()
})
it('过渡块：点选即选中，拖右缘改时长、拖中间平移，实时预览且松手一步撤销；淡化手柄拖出淡入（4.3）', () => {
  editVideoProject(owner.document.id, document => {
    const [video] = document.sequences[0].clips
    document.sequences[0].clips = [video, { ...video, id: 'next-video', start: 30, sourceInUs: 2_000_000 }]
    document.sequences[0].transitions = [{ id: 'dissolve', kind: 'cross_dissolve', leftClipId: video.id, rightClipId: 'next-video', durationFrames: 10 }]
    return document
  })
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  const block = () => view.container.querySelector<HTMLElement>('[data-video-edit-transition="dissolve"]')!
  // 窗口 25..35 帧，每帧 2 像素
  expect(block().style.left).toBe(`${header + 50}px`); expect(block().style.width).toBe('20px')
  const history = owner.past.length
  fireEvent.pointerDown(block().querySelector('[data-video-edit-transition-edge="out"]')!, event(header + 69))
  fireEvent.pointerMove(host, event(header + 79))
  expect(current().transitions![0]).toMatchObject({ durationFrames: 15, alignment: 'custom', framesBeforeCut: 5 })
  expect(owner.past).toHaveLength(history)
  fireEvent.pointerUp(host, event(header + 79))
  expect(owner.past).toHaveLength(history + 1); expect(block().getAttribute('data-selected')).toBe('true')
  act(() => undoVideoEdit(owner.document.id)); expect(current().transitions![0]).toEqual({ id: 'dissolve', kind: 'cross_dissolve', leftClipId: ids[0], rightClipId: 'next-video', durationFrames: 10 })
  fireEvent.pointerDown(block().querySelector('[data-video-edit-transition-edge="out"]')!.previousElementSibling!, event(header + 60))
  fireEvent.pointerMove(host, event(header + 50)); fireEvent.pointerUp(host, event(header + 50))
  expect(current().transitions![0]).toMatchObject({ durationFrames: 10, alignment: 'end' })
  expect(owner.past).toHaveLength(history + 1)
  const fade = view.container.querySelector<HTMLElement>(`[data-video-edit-clip="${ids[0]}"] [data-video-edit-fade="in"]`)!
  fireEvent.pointerDown(fade, event(header + 2)); fireEvent.pointerMove(host, event(header + 14)); fireEvent.pointerUp(host, event(header + 14))
  expect(current().clips[0].fadeInFrames).toBe(6); expect(owner.past).toHaveLength(history + 2)
  expect(view.container.querySelector(`[data-video-edit-clip="${ids[0]}"] [data-video-edit-fade-shape="in"]`)).not.toBeNull()
  act(() => undoVideoEdit(owner.document.id)); expect(current().clips[0]).not.toHaveProperty('fadeInFrames')
  expect(onError).not.toHaveBeenCalled()
})
it('不能编辑的原因浮在时间线上方不占位，指针显示禁止（4.3）', () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20))
  fireEvent.pointerMove(host, event(header + 20, trackClientY(0)))
  const hint = view.container.querySelector<HTMLElement>('[data-video-edit-timeline-failure]')!
  expect(hint.textContent).toContain('同类型轨道'); expect(hint.className).toContain('pointer-events-none'); expect(hint.className).toContain('absolute')
  expect(host.className).toContain('cursor-not-allowed')
  fireEvent.pointerUp(host, event(header + 20))
  expect(host.className).not.toContain('cursor-not-allowed')
})
it('标尺入出点区间：拖两端改入出点、拖中间平移，吸附时显示提示线，松手收起；节目监视器读数显示入出点持续时间（4.4）', () => {
  act(() => setVideoEditTimelineView(owner.document.id, { inFrame: 10, outFrame: 40 }))
  const view = render(<><View /><VideoEditInOutDuration instance={owner} /></>)
  const bar = () => view.container.querySelector<HTMLElement>('[data-video-edit-in-out-range]')!
  // 每帧 2 像素：入点 10 → 20px，宽 30 帧
  expect(bar().style.left).toBe('20px'); expect(bar().style.width).toBe('60px')
  expect(view.getByLabelText('入出点持续时间').textContent).toBe('00:00:01:00')
  const handle = (edge: 'in' | 'out') => bar().querySelector<HTMLElement>(`[data-video-edit-in-out-handle="${edge}"]`)!
  const history = owner.past.length
  fireEvent.pointerDown(handle('in'), event(header + 20, 10)); fireEvent.pointerMove(handle('in'), event(header + 30, 10)); fireEvent.pointerUp(handle('in'), event(header + 30, 10))
  expect([owner.inFrame, owner.outFrame]).toEqual([15, 40]); expect(owner.frame).toBe(0)
  // 吸附开着：出点拖到片段末尾（30 帧）附近吸上，拖动中显示提示线
  act(() => setVideoEditTimelineView(owner.document.id, { snapping: true }))
  fireEvent.pointerDown(handle('out'), event(header + 80, 10)); fireEvent.pointerMove(handle('out'), event(header + 63, 10))
  expect(owner.outFrame).toBe(30); expect(view.container.querySelector('[data-video-edit-snap-indicator="30"]')).not.toBeNull()
  fireEvent.pointerUp(handle('out'), event(header + 63, 10))
  expect(view.container.querySelector('[data-video-edit-snap-indicator]')).toBeNull()
  act(() => setVideoEditTimelineView(owner.document.id, { snapping: false }))
  fireEvent.pointerDown(bar(), event(header + 40, 10)); fireEvent.pointerMove(bar(), event(header + 60, 10)); fireEvent.pointerUp(bar(), event(header + 60, 10))
  expect([owner.inFrame, owner.outFrame]).toEqual([25, 40])
  expect(view.getByLabelText('入出点持续时间').textContent).toBe('00:00:00:15')
  // 入出点是视图状态，同 I／O 键一样不记撤销
  expect(owner.past).toHaveLength(history)
  act(() => setVideoEditTimelineView(owner.document.id, { inFrame: null, outFrame: null }))
  expect(view.container.querySelector('[data-video-edit-in-out-range]')).toBeNull(); expect(view.queryByLabelText('入出点持续时间')).toBeNull()
  expect(onError).not.toHaveBeenCalled()
})
it('拖动吸上时轨道上显示吸附提示线：片段移动、过渡块与 Shift 拖播放头共用同一条，松手收起（4.4）', () => {
  editVideoProject(owner.document.id, document => {
    const [video] = document.sequences[0].clips
    document.sequences[0].transitions = [{ id: 'tail', kind: 'cross_dissolve', leftClipId: video.id, durationFrames: 10 }]
    return document
  })
  act(() => { setVideoEditTimelineView(owner.document.id, { snapping: true }); setVideoEditView(owner.document.id, { frame: 50 }) })
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  const line = () => view.container.querySelector<HTMLElement>('[data-video-edit-snap-indicator]')
  // 片段 0..30 右移约 20.5 帧：末尾吸到播放头 50
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20)); fireEvent.pointerMove(host, event(header + 61))
  expect(line()?.getAttribute('data-video-edit-snap-indicator')).toBe('50'); expect(line()!.style.left).toBe(`${header + 100}px`)
  fireEvent.pointerUp(host, event(header + 61))
  expect(current().clips[0].start).toBe(20); expect(line()).toBeNull()
  // 单侧过渡块（片段出点 40..50）只有左缘能拖：左缘拖到片段起点 20 附近吸上
  const block = view.container.querySelector<HTMLElement>('[data-video-edit-transition="tail"]')!
  expect(block.getAttribute('data-video-edit-transition-side')).toBe('out')
  expect(block.querySelector('[data-video-edit-transition-edge="out"]')).toBeNull()
  fireEvent.pointerDown(block.querySelector('[data-video-edit-transition-edge="in"]')!, event(header + 80)); fireEvent.pointerMove(host, event(header + 43))
  expect(current().transitions![0].durationFrames).toBe(30); expect(line()?.getAttribute('data-video-edit-snap-indicator')).toBe('20')
  fireEvent.pointerUp(host, event(header + 43)); expect(line()).toBeNull()
  // Shift 拖播放头吸到编辑点
  const ruler = view.getByRole('slider', { name: '剪辑时间定位' })
  fireEvent.pointerDown(ruler, event(header + 41, 14, { shiftKey: true }))
  expect(owner.frame).toBe(20); expect(line()?.getAttribute('data-video-edit-snap-indicator')).toBe('20')
  fireEvent.pointerUp(host, event(header + 41, 14)); expect(line()).toBeNull()
  expect(onError).not.toHaveBeenCalled()
})
