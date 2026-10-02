// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { rememberVideoEditCodeMetadata, readVideoEditCodeMetadata } from '../application/videoEditCodeState'
import { appendVideoEditSequence, closeVideoEditProject, createVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditTimelineView, setVideoEditView, subscribeVideoEdit, switchVideoEditSequence, undoVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { executeVideoEditTimelineEdit } from '../application/videoEditTimeline'
import { VIDEO_EDIT_ITEM_DRAG_MIME } from '../application/videoEditDrop'
import { VideoEditTimeline } from '../VideoEditTimeline'
import { useSettingsStore } from '@/stores/settingsStore'
import { TIMELINE_HEADER_WIDTH as header, timelineInitialScrollTop, timelineTrackRows } from './timelineGeometry'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const source = 'export default {apiVersion:1,name:"代码",kind:"generator",mode:"dynamic",width:64,height:64,durationSeconds:30,seed:1,parameters:{},render(ctx){return [rect({x:0,y:0,width:10,height:10,fill:[1,0,0,1]})];}}'
let owner: VideoEditInstance
let ids: string[]
let onError: ReturnType<typeof vi.fn>
function View({ visible = true }: { visible?: boolean }): React.ReactElement { useSyncExternalStore(subscribeVideoEdit, videoEditRevision); return <VideoEditTimeline instance={owner} onError={onError} visible={visible} /> }
const current = () => getActiveVideoEditSequence(owner)
const trackClientY = (index = 1): number => {
  const row = timelineTrackRows(current()).find(row => row.track.index === index)!
  const host = document.querySelector<HTMLElement>('[data-video-edit-timeline-viewport]')
  return row.top + row.height / 2 - (host?.scrollTop ?? 0)
}
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
    document.sequences[0].clips = ['video-item', 'code-item'].map((id, index) => ({ ...makeVideoEditItemClip(document, id, document.sequences[0].id, { frame: index * 60, track: 1 }, readVideoEditCodeMetadata(owner, document)), duration: 30 }))
    return document
  })
  ids = current().clips.map(clip => clip.id)
  setVideoEditTimelineView(owner.document.id, { selectedClipIds: [], snapping: false })
})
afterEach(async () => { cleanup(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

it('普通视频与代码多选，连续拖动仅本地预览，释放一次历史且一次撤销', () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20))
  fireEvent.pointerUp(host, event(header + 20))
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 代码' }), event(header + 140, trackClientY(), { ctrlKey: true }))
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

it('框选与关联选择不误定位播放头；Ctrl 点击关联集合整体取消', () => {
  executeVideoEditTimelineEdit(owner.document.id, current().id, { kind: 'link', clipIds: ids })
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' }); const frame = owner.frame
  const y = trackClientY()
  fireEvent.pointerDown(host, event(header + 150, y + 20)); fireEvent.pointerMove(host, event(header + 10, y - 20)); fireEvent.pointerUp(host, event(header + 10, y - 20))
  expect(new Set(owner.selectedClipIds)).toEqual(new Set(ids)); expect(owner.frame).toBe(frame)
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20, trackClientY(), { ctrlKey: true }))
  expect(owner.selectedClipIds).toEqual([])
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 代码' }), event(header + 140)); fireEvent.pointerUp(host, event(header + 140))
  expect(new Set(owner.selectedClipIds)).toEqual(new Set(ids)); expect(owner.selection).toBe(ids[1]); expect(onError).not.toHaveBeenCalled()
})

it('锁定轨道阻止指针编辑；目标/静音/独奏/输出/同步使用同一领域轨道', () => {
  const view = render(<View />); const name = current().tracks[1].name
  fireEvent.click(view.getByRole('button', { name: `${name}锁定` })); expect(current().tracks[1].locked).toBe(true)
  const baseline = owner.document; const history = owner.past.length
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20)); fireEvent.pointerMove(view.getByRole('region', { name: '时间线编辑区域' }), event(header + 40))
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history); expect(onError.mock.calls[0][0].message).toContain('锁定')
  fireEvent.click(view.getByRole('button', { name: `${name}静音` })); fireEvent.click(view.getByRole('button', { name: `${name}独奏` })); fireEvent.click(view.getByRole('button', { name: `${name}输出` })); fireEvent.click(view.getByRole('button', { name: `${name}同步锁定` }))
  expect(current().tracks[1]).toMatchObject({ muted: true, solo: true, enabled: false, syncLocked: false })
  const trackId = current().tracks[1].id; const before = owner.targetTrackIds.includes(trackId)
  fireEvent.click(view.getByRole('button', { name: `${name}设为目标` })); expect(owner.targetTrackIds.includes(trackId)).toBe(!before)
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
  expect(view.container.querySelectorAll('[data-video-edit-track]')).toHaveLength(32)
  const resizeY = trackClientY() + 15
  fireEvent.pointerDown(view.getByRole('separator', { name: '调整轨道1高度' }), event(100, resizeY)); fireEvent.pointerMove(host, event(100, resizeY + 40))
  expect(current().tracks[1].height).toBeUndefined(); expect(owner.past).toHaveLength(history)
  fireEvent.pointerUp(host, event(100, resizeY + 40)); expect(current().tracks[1].height).toBe(72); expect(owner.past).toHaveLength(history + 1)
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20))
  host.scrollTop = 60; fireEvent.scroll(host); const targetY = trackClientY(29)
  fireEvent.pointerMove(host, event(header + 20, targetY)); fireEvent.pointerUp(host, event(header + 20, targetY))
  expect(current().clips[0].track).toBe(29); expect(onError).not.toHaveBeenCalled()
})

it('手形只滚动，轨道向前选择按命中轨道和位置', () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.click(view.getByRole('button', { name: '轨道向前选择' })); fireEvent.pointerDown(host, event(header + 90)); expect(owner.selectedClipIds).toEqual([ids[1]])
  const baseline = owner.document
  fireEvent.click(view.getByRole('button', { name: '手形工具' })); fireEvent.pointerDown(host, event(500, 200)); fireEvent.pointerMove(host, event(450, 150)); fireEvent.pointerUp(host, event(450, 150))
  expect(host.scrollLeft).toBe(50); expect(host.scrollTop).toBe(50); expect(owner.document).toBe(baseline); expect(onError).not.toHaveBeenCalled()
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

it('矮时间线在边缘区按住片段不动不滚动，拖向边缘才滚动、离开即停；框选与标尺横向一致', () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => ({ left: 0, top: 0, right: 900, bottom: 118, width: 900, height: 118, x: 0, y: 0, toJSON: () => ({}) }))
  viewportHeight = 118
  const clock = layoutClock()
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' }); const baseline = owner.document
  fireEvent.wheel(host, { deltaY: 10 }); for (let frame = 0; frame < 8 && clock.callbacks.size; frame++) clock.step()
  const row = timelineTrackRows(current()).find(value => value.track.index === 1)!
  host.scrollTop = row.top + row.height / 2 - 44; fireEvent.scroll(host)
  const scrolled = host.scrollTop; const y = trackClientY()
  expect(y).toBeGreaterThanOrEqual(28); expect(y).toBeLessThan(60) // 落在顶部 32px 自动滚动区
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20, y))
  fireEvent.pointerMove(host, event(header + 20, y)); fireEvent.pointerMove(host, event(header + 21, y + 1))
  expect(clock.callbacks.size).toBe(0); expect(host.scrollTop).toBe(scrolled)
  fireEvent.pointerMove(host, event(header + 20, y - 10))
  expect(clock.callbacks.size).toBe(1); clock.step(); expect(host.scrollTop).toBeLessThan(scrolled)
  fireEvent.pointerMove(host, event(header + 20, 74)); const held = host.scrollTop
  clock.step(); expect(host.scrollTop).toBe(held); expect(clock.callbacks.size).toBe(0)
  fireEvent.pointerCancel(host, event(header + 20, 74)); expect(owner.document).toBe(baseline)
  for (const [pressY, label] of [[74, 'box'], [14, 'ruler']] as const) {
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

it('正式运输/工具按钮共用命令与自定义键位；实时读数使用当前上下文', async () => {
  const view = render(<View />)
  const previous = useSettingsStore.getState().videoEditShortcuts
  try {
    act(() => useSettingsStore.getState().setVideoEditShortcuts({ ...previous, select_tool: { code: 'KeyQ', ctrl: false, alt: false, shift: false, meta: false } }))
    expect(view.getByRole('button', { name: '选择工具' }).getAttribute('title')).toBe('选择工具（Q）')
    fireEvent.click(view.getByRole('button', { name: '下一帧' })); expect(owner.frame).toBe(1)
    fireEvent.click(view.getByRole('button', { name: '下一帧' })); expect(owner.frame).toBe(2)
    fireEvent.click(view.getByRole('button', { name: '上一帧' })); expect(owner.frame).toBe(1)
    fireEvent.click(view.getByRole('button', { name: '播放／暂停' })); await waitFor(() => expect(owner.playing).toBe(true))
    fireEvent.click(view.getByRole('button', { name: '播放／暂停' })); expect(owner.playing).toBe(false)
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
  fireEvent.click(view.getByRole('menuitem', { name: '在项目中定位' }))
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

it('交错32轨道与500片段分成真实音画两区，初次可见底层画面且DOM仍有界', () => {
  const tracks = mixedTracks()
  editVideoProject(owner.document.id, document => {
    const sequence = document.sequences[0]; const clip = sequence.clips[0]
    sequence.tracks = tracks
    sequence.clips = Array.from({ length: 500 }, (_, index) => ({ ...clip, id: `clip-${index}`, start: index * 100, duration: 10 }))
    return document
  })
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  const displayedTracks = [...view.container.querySelectorAll('[data-video-edit-track]')]
  expect(displayedTracks).toHaveLength(32)
  expect(displayedTracks.map(row => Number(row.getAttribute('data-track-index')))).toEqual([...Array.from({ length: 16 }, (_, index) => 31 - index * 2), ...Array.from({ length: 16 }, (_, index) => index * 2)])
  expect(current().tracks).toEqual(tracks)
  expect(host.scrollTop).toBe(timelineInitialScrollTop(timelineTrackRows(current()), 300))
  expect(view.getByRole('separator', { name: '画面与声音轨道分界' })).not.toBeNull()
  expect(view.container.querySelector('[data-video-edit-clip="clip-0"]')).not.toBeNull()
  expect(view.container.querySelectorAll('[data-video-edit-clip]').length).toBeGreaterThan(0)
  expect(view.container.querySelectorAll('[data-video-edit-clip]').length).toBeLessThan(10)
  host.scrollLeft = 10000; fireEvent.scroll(host)
  expect(view.container.querySelector('[data-video-edit-clip="clip-0"]')).toBeNull(); expect(view.container.querySelector('[data-video-edit-clip="clip-50"]')).not.toBeNull()
  expect(view.container.querySelectorAll('[data-video-edit-clip]').length).toBeLessThan(10); expect(view.container.querySelector('[data-video-edit-ruler]')!.querySelectorAll('span').length).toBeLessThan(20)
  expect(onError).not.toHaveBeenCalled()
})

it('初始定位只做一次，手动滚动后播放、文档刷新、尺寸变化和重新显示均保留位置，切序列重新定位', () => {
  const tracks = mixedTracks()
  editVideoProject(owner.document.id, document => { document.sequences[0].tracks = tracks; return document })
  let resize: (() => void) | undefined
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe(): void {} disconnect(): void {} })
  const view = render(<View />); let host = view.getByRole('region', { name: '时间线编辑区域' })
  expect(host.scrollTop).toBeGreaterThan(0)
  host.scrollTop = 0; fireEvent.scroll(host)
  act(() => { editVideoProject(owner.document.id, document => { document.sequences[0].tracks[1].name = '改名'; return document }); setVideoEditView(owner.document.id, { frame: 20, playing: true }) })
  viewportHeight = 250; act(() => resize?.())
  view.rerender(<View visible={false} />); view.rerender(<View />)
  expect(host.scrollTop).toBe(0)
  act(() => {
    const id = appendVideoEditSequence(owner.document.id)
    editVideoProject(owner.document.id, document => { const sequence = document.sequences.find(sequence => sequence.id === id)!; sequence.tracks = tracks.map(track => ({ ...track, id: `new-${track.id}` })); return document })
    switchVideoEditSequence(owner.document.id, id)
  })
  host = view.getByRole('region', { name: '时间线编辑区域' })
  expect(host.scrollTop).toBe(timelineInitialScrollTop(timelineTrackRows(current()), 250))
  expect(host.scrollTop).toBeGreaterThan(0); expect(onError).not.toHaveBeenCalled()
})

it('隐藏或零高度初次挂载等待实际显示定位，单类32轨道不制造空分区', () => {
  const tracks = mixedTracks()
  editVideoProject(owner.document.id, document => { document.sequences[0].tracks = tracks; return document })
  viewportHeight = 0
  const view = render(<View visible={false} />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  expect(host.scrollTop).toBe(0)
  viewportHeight = 300; view.rerender(<View />)
  expect(host.scrollTop).toBe(timelineInitialScrollTop(timelineTrackRows(current()), 300))
  view.unmount()
  editVideoProject(owner.document.id, document => { document.sequences[0].tracks = tracks.map(track => ({ ...track, kind: 'video' })); return document })
  const single = render(<View />)
  expect(single.getByRole('region', { name: '时间线编辑区域' }).scrollTop).toBe(0)
  expect(single.queryByRole('separator', { name: '画面与声音轨道分界' })).toBeNull()
  expect([...single.container.querySelectorAll('[data-video-edit-track]')].map(row => Number(row.getAttribute('data-track-index')))).toEqual(Array.from({ length: 32 }, (_, index) => 31 - index))
  expect(onError).not.toHaveBeenCalled()
})

it('项目项拖放按重排后的原轨道命中，音画分界不产生伪落点或历史', async () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  const transfer = { types: [VIDEO_EDIT_ITEM_DRAG_MIME], getData: () => JSON.stringify({ projectId: owner.document.id, itemIds: ['video-item'] }) }
  const baseline = owner.document; const history = owner.past.length
  const divider = Number.parseFloat((view.getByRole('separator', { name: '画面与声音轨道分界' }) as HTMLElement).style.top)
  fireEvent.dragOver(host, { clientX: header + 200, clientY: divider, dataTransfer: transfer })
  fireEvent.drop(host, { clientX: header + 200, clientY: divider, dataTransfer: transfer })
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
  const y = trackClientY(3)
  fireEvent.dragOver(host, { clientX: header + 200, clientY: y, dataTransfer: transfer })
  expect(view.getByText('释放以添加素材')).not.toBeNull()
  fireEvent.drop(host, { clientX: header + 200, clientY: y, dataTransfer: transfer })
  await waitFor(() => expect(current().clips).toHaveLength(3))
  expect(current().clips.at(-1)).toMatchObject({ itemId: 'video-item', track: 3, start: 100 })
  expect(owner.past).toHaveLength(history + 1); expect(onError).not.toHaveBeenCalled()
})

it('首测300后Dock缩到190仍完成首次分界定位，程序scroll不提前冻结；稳定后普通resize与内容刷新不复位', () => {
  editVideoProject(owner.document.id, document => {
    const sequence = document.sequences[0]
    sequence.tracks = sequence.tracks.map(track => ({ ...track, kind: [0, 1, 7].includes(track.index) ? 'audio' : 'video' }))
    sequence.clips = sequence.clips.map(clip => ({ ...clip, track: 2 }))
    return document
  })
  let resize: (() => void) | undefined
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe(): void {} disconnect(): void {} })
  const clock = layoutClock()
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  expect(host.scrollTop).toBe(0); clock.step()
  viewportHeight = 190; act(() => resize?.())
  const positioned = timelineInitialScrollTop(timelineTrackRows(current()), 190)
  expect(host.scrollTop).toBe(positioned); expect(positioned).toBeGreaterThan(0)
  fireEvent.scroll(host)
  expect(clock.callbacks.size).toBe(1)
  const rows = timelineTrackRows(current()); const picture = rows.find(row => row.track.index === 2)!; const audio = rows.find(row => row.track.index === 1)!
  expect(picture.top - positioned).toBeGreaterThanOrEqual(28)
  expect(audio.top + audio.height - positioned).toBeLessThanOrEqual(190)
  clock.step(); clock.step(); expect(clock.callbacks.size).toBe(0)
  viewportHeight = 170; act(() => resize?.())
  act(() => { editVideoProject(owner.document.id, document => { document.sequences[0].tracks[2].height = 80; return document }); setVideoEditView(owner.document.id, { playing: true, frame: 10 }) })
  expect(host.scrollTop).toBe(positioned); expect(clock.callbacks.size).toBe(0); expect(onError).not.toHaveBeenCalled()
})

it('初始布局等待中用户滚轮立即冻结，非程序scroll也保留用户位置', () => {
  const tracks = mixedTracks()
  editVideoProject(owner.document.id, document => { document.sequences[0].tracks = tracks; return document })
  const clock = layoutClock()
  let resize: (() => void) | undefined
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe(): void {} disconnect(): void {} })
  for (const action of ['wheel', 'scroll'] as const) {
    viewportHeight = 300
    const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' }); const initial = host.scrollTop
    expect(clock.callbacks.size).toBe(1)
    fireEvent.scroll(host) // Only the pending programmatic target is ignored.
    if (action === 'wheel') fireEvent.wheel(host, { deltaY: 10 })
    if (action === 'scroll') { host.scrollTop = initial + 10; fireEvent.scroll(host) }
    const position = host.scrollTop
    expect(clock.callbacks.size).toBe(0)
    viewportHeight = 190; act(() => resize?.())
    expect(host.scrollTop).toBe(position); clock.step(); expect(host.scrollTop).toBe(position)
    view.unmount()
  }
  expect(onError).not.toHaveBeenCalled()
})

it('初始布局等待隐藏与卸载即释放，持续变化也在有限布局帧内停止', () => {
  const tracks = mixedTracks()
  editVideoProject(owner.document.id, document => { document.sequences[0].tracks = tracks; return document })
  const clock = layoutClock()
  const view = render(<View />)
  expect(clock.callbacks.size).toBe(1)
  view.rerender(<View visible={false} />); expect(clock.callbacks.size).toBe(0)
  view.rerender(<View />); expect(clock.callbacks.size).toBe(1)
  for (let index = 0; index < 12; index++) { viewportHeight = index % 2 ? 190 : 191; clock.step() }
  expect(clock.callbacks.size).toBe(0)
  view.unmount(); expect(clock.callbacks.size).toBe(0)
  viewportHeight = 300
  const pending = render(<View />); expect(clock.callbacks.size).toBe(1)
  const previousFrame = [...clock.callbacks.keys()][0]
  act(() => { const next = appendVideoEditSequence(owner.document.id); switchVideoEditSequence(owner.document.id, next) })
  expect(clock.callbacks.has(previousFrame)).toBe(false); expect(clock.callbacks.size).toBe(1)
  pending.unmount(); expect(clock.callbacks.size).toBe(0); expect(onError).not.toHaveBeenCalled()
})

function linkedPair(): { picture: string; sound: string } {
  editVideoProject(owner.document.id, document => { document.media[0].hasAudio = true; return document })
  executeVideoEditTimelineEdit(owner.document.id, current().id, { kind: 'separate_audio', clipIds: [ids[0]], audioTrack: 0 })
  setVideoEditTimelineView(owner.document.id, { selectedClipIds: [] })
  return { picture: ids[0], sound: current().clips.find(clip => clip.kind === 'audio')!.id }
}
const clipButton = (view: ReturnType<typeof render>, id: string): HTMLElement => view.container.querySelector<HTMLElement>(`[data-video-edit-clip="${id}"] [aria-label^="选择片段"]`)!
const syncBadges = (view: ReturnType<typeof render>) => Object.fromEntries([...view.container.querySelectorAll('[data-video-edit-sync-offset]')].map(badge => [badge.closest('[data-video-edit-clip]')!.getAttribute('data-video-edit-clip'), badge.textContent]))

it('按住 Alt 单独选中并拖动链接中的声音，片段显示失步帧数，右键移入同步恢复且链接保留', async () => {
  const { picture, sound } = linkedPair()
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.pointerDown(clipButton(view, sound), event(header + 20, trackClientY(0))); fireEvent.pointerUp(host, event(header + 20, trackClientY(0)))
  expect(new Set(owner.selectedClipIds)).toEqual(new Set([picture, sound]))
  fireEvent.pointerDown(clipButton(view, sound), event(header + 20, trackClientY(0), { altKey: true }))
  expect(owner.selectedClipIds).toEqual([sound])
  fireEvent.pointerMove(host, event(header + 30, trackClientY(0), { altKey: true }))
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
  vi.spyOn(getPlatform().audioEdit, 'extractWaveformRange').mockImplementation(async request => {
    requests.push({ audioStream: request.audioStream, audioChannel: request.audioChannel, channels: request.channels })
    return { startUs: request.startUs, endUs: request.endUs, durationSeconds: 30, sampleRate: 48000, channelCount: 1, channels: [{ peak: Array(16).fill(.5), rms: Array(16).fill(.3), sampleCounts: Array(16).fill(1) }], fileIdentity: 'file' }
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
