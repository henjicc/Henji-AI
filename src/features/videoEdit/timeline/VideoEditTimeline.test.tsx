// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { rememberVideoEditCodeMetadata, readVideoEditCodeMetadata } from '../application/videoEditCodeState'
import { appendVideoEditSequence, closeVideoEditProject, createVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditTimelineView, setVideoEditView, subscribeVideoEdit, switchVideoEditSequence, undoVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { executeVideoEditTimelineEdit, readVideoEditClipboard } from '../application/videoEditTimeline'
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
  expect(new Set(owner.selectedClipIds)).toEqual(new Set(ids)); expect(onError).not.toHaveBeenCalled()
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

it('剃刀按真实落点拆分，手形只滚动，轨道向前选择按命中轨道和位置', () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.click(view.getByRole('button', { name: '轨道向前选择' })); fireEvent.pointerDown(host, event(header + 90)); expect(owner.selectedClipIds).toEqual([ids[1]])
  const baseline = owner.document
  fireEvent.click(view.getByRole('button', { name: '手形工具' })); fireEvent.pointerDown(host, event(500, 200)); fireEvent.pointerMove(host, event(450, 150)); fireEvent.pointerUp(host, event(450, 150))
  expect(host.scrollLeft).toBe(50); expect(host.scrollTop).toBe(50); expect(owner.document).toBe(baseline)
  host.scrollLeft = 0; host.scrollTop = 0
  fireEvent.click(view.getByRole('button', { name: '剃刀工具' })); fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 视频' }), event(header + 20)); expect(current().clips).toHaveLength(2); fireEvent.pointerUp(host, event(header + 20))
  expect(current().clips).toHaveLength(3); expect(current().clips.find(clip => clip.id === ids[0])!.duration).toBe(10); expect(onError).not.toHaveBeenCalled()
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

it('500片段与长标尺只挂当前视口，滚动后换入真实远端片段', () => {
  editVideoProject(owner.document.id, document => { const clip = document.sequences[0].clips[0]; document.sequences[0].clips = Array.from({ length: 500 }, (_, index) => ({ ...clip, id: `clip-${index}`, start: index * 100, duration: 10 })); return document })
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  expect(view.container.querySelectorAll('[data-video-edit-clip]').length).toBeLessThan(10)
  expect(view.container.querySelector('[data-video-edit-clip="clip-0"]')).not.toBeNull()
  host.scrollLeft = 10000; fireEvent.scroll(host)
  expect(view.container.querySelector('[data-video-edit-clip="clip-0"]')).toBeNull(); expect(view.container.querySelector('[data-video-edit-clip="clip-50"]')).not.toBeNull()
  expect(view.container.querySelectorAll('[data-video-edit-clip]').length).toBeLessThan(10); expect(view.container.querySelector('[data-video-edit-ruler]')!.querySelectorAll('span').length).toBeLessThan(20)
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

it('菜单关闭后切序列的迟到动作拒绝，锁定菜单禁用且不丢原内容', async () => {
  const view = render(<View />); const original = current().id
  act(() => setVideoEditView(owner.document.id, { frame: 10 }))
  fireEvent.contextMenu(view.getByRole('button', { name: '选择片段 视频' }), { clientX: 300, clientY: 80 })
  fireEvent.click(view.getByRole('menuitem', { name: '删除片段（Delete）' }))
  act(() => { const next = appendVideoEditSequence(owner.document.id); switchVideoEditSequence(owner.document.id, next) })
  const baseline = owner.document; await waitFor(() => expect(onError).toHaveBeenCalled())
  expect(owner.document).toBe(baseline); expect(owner.document.sequences.find(sequence => sequence.id === original)!.clips).toHaveLength(2)
  act(() => switchVideoEditSequence(owner.document.id, original))
  fireEvent.click(view.getByRole('button', { name: `${current().tracks[1].name}锁定` }))
  fireEvent.contextMenu(view.getByRole('button', { name: '选择片段 视频' }), { clientX: 300, clientY: 80 })
  expect(view.getByRole('menuitem', { name: '删除片段（Delete）' }).getAttribute('aria-disabled')).toBe('true')
  expect(view.getByRole('menuitem', { name: '复制片段（Ctrl+C）' }).getAttribute('aria-disabled')).toBe('false')
})

it('空白菜单粘贴保留菜单打开时的播放头、剪贴板和目标轨道', async () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  fireEvent.contextMenu(view.getByRole('button', { name: '选择片段 视频' }), { clientX: 300, clientY: 80 }); fireEvent.click(view.getByRole('menuitem', { name: '复制片段（Ctrl+C）' }))
  await waitFor(() => expect(readVideoEditClipboard(owner.document.id)?.clips[0].id).toBe(ids[0]))
  act(() => setVideoEditView(owner.document.id, { frame: 100 }))
  fireEvent.contextMenu(host, { clientX: 600, clientY: 160 }); fireEvent.click(view.getByRole('menuitem', { name: '粘贴片段（Ctrl+V）' }))
  act(() => { setVideoEditView(owner.document.id, { frame: 200 }); setVideoEditTimelineView(owner.document.id, { targetTrackIds: [current().tracks[2].id], selectedClipIds: [ids[1]] }) })
  await waitFor(() => expect(current().clips).toHaveLength(3))
  const pasted = current().clips.find(clip => !ids.includes(clip.id))!
  expect(pasted).toMatchObject({ kind: 'video', track: 1, start: 100, duration: 30 }); expect(onError).not.toHaveBeenCalled()
})

it('关键帧之外的入出点拖动也消费核心吸附，关联主片段按实际点击切换', () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  act(() => { setVideoEditTimelineView(owner.document.id, { snapping: true }); setVideoEditView(owner.document.id, { frame: 40 }) })
  fireEvent.pointerDown(view.getByRole('button', { name: '裁剪视频出点' }), event(header + 60)); fireEvent.pointerMove(host, event(header + 77)); fireEvent.pointerUp(host, event(header + 77))
  expect(current().clips[0].duration).toBe(40)
  act(() => executeVideoEditTimelineEdit(owner.document.id, current().id, { kind: 'group', clipIds: ids }))
  fireEvent.pointerDown(view.getByRole('button', { name: '选择片段 代码' }), event(header + 140)); fireEvent.pointerUp(host, event(header + 140))
  expect(owner.selection).toBe(ids[1]); expect(new Set(owner.selectedClipIds)).toEqual(new Set(ids)); expect(onError).not.toHaveBeenCalled()
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
  expect(view.container.querySelector('[data-video-edit-clip="clip-50"]')).not.toBeNull()
  expect(view.container.querySelectorAll('[data-video-edit-clip]').length).toBeLessThan(10)
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

it('初始布局等待中真实wheel、pointer、key、drag与contextmenu立即冻结，非程序scroll也保留用户位置', () => {
  const tracks = mixedTracks()
  editVideoProject(owner.document.id, document => { document.sequences[0].tracks = tracks; return document })
  const clock = layoutClock()
  let resize: (() => void) | undefined
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe(): void {} disconnect(): void {} })
  for (const action of ['wheel', 'pointer', 'key', 'drag', 'contextmenu', 'scroll'] as const) {
    viewportHeight = 300
    const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' }); const initial = host.scrollTop
    expect(clock.callbacks.size).toBe(1)
    fireEvent.scroll(host) // Only the pending programmatic target is ignored.
    if (action === 'wheel') fireEvent.wheel(host, { deltaY: 10 })
    if (action === 'pointer') { fireEvent.pointerDown(view.getByRole('button', { name: '目标轨道 轨道1' }), event(100)); fireEvent.pointerUp(host, event(100)) }
    if (action === 'key') fireEvent.keyDown(host, { key: 'Shift' })
    if (action === 'drag') fireEvent.dragOver(host, { dataTransfer: { types: [] } })
    if (action === 'contextmenu') fireEvent.contextMenu(host, { clientX: header + 400, clientY: 100 })
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
