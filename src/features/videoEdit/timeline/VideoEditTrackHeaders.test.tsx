// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { useSettingsStore } from '@/stores/settingsStore'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditView, subscribeVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditTimelineCanvas } from './VideoEditTimelineCanvas'

const metrics = vi.hoisted(() => ({ renders: 0 }))
vi.mock('@/core/videoEdit/trackHeaderButtons', async importOriginal => {
  const original = await importOriginal<typeof import('@/core/videoEdit/trackHeaderButtons')>()
  return { ...original, videoEditTrackHeaderButtons: (...args: Parameters<typeof original.videoEditTrackHeaderButtons>) => { metrics.renders++; return original.videoEditTrackHeaderButtons(...args) } }
})
vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

let owner: VideoEditInstance
let onError: ReturnType<typeof vi.fn>
function View(): React.ReactElement {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  return <VideoEditTimelineCanvas instance={owner} sequence={getActiveVideoEditSequence(owner)} pixels={2} onError={onError} />
}
const current = () => getActiveVideoEditSequence(owner)
const pointer = (clientY = 200) => ({ pointerId: 1, clientX: 100, clientY, button: 0 })
const headerOf = (id: string) => document.querySelector<HTMLElement>(`[data-video-edit-track-header="${id}"]`)
const scrollAudio = (host: HTMLElement, deltaY: number) => fireEvent.wheel(host, { deltaY, ctrlKey: true, clientX: 400, clientY: 250 })

beforeEach(async () => {
  installHarnessNativeStorage(); onError = vi.fn()
  vi.stubGlobal('PointerEvent', class extends MouseEvent { readonly pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const row = this.closest<HTMLElement>('[data-video-edit-track]')
    const control = row && this.matches('button, input, [role="separator"]')
    const height = control ? this.getAttribute('role') === 'separator' ? 4 : 28 : 300
    const rowHeight = row ? Number.parseFloat(row.style.height) : 0
    const offset = this.getAttribute('role') === 'separator' ? rowHeight - height : (rowHeight - height) / 2
    const top = control ? Number.parseFloat(row.parentElement!.style.top) + Number.parseFloat(row.style.top) + offset : 0
    return { left: 0, top, right: 900, bottom: top + height, width: 900, height, x: 0, y: top, toJSON: () => ({}) }
  })
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: () => undefined },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: () => undefined },
  })
  owner = await createVideoEditTestProject()
  editVideoProject(owner.document.id, document => {
    const sequence = document.sequences[0]; const base = sequence.tracks[0]
    sequence.tracks = Array.from({ length: 1000 }, (_, index) => ({ ...base, id: `track-${index}`, index, kind: index % 2 ? 'video' as const : 'audio' as const, name: `轨道${index}`, height: 32 + index % 3 * 8 }))
    return document
  })
})
afterEach(async () => { cleanup(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

it('1000 条可变高度轨道只挂载可见轨道头及缓冲，两个区域独立滚动后替换挂载行', () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  expect(current().tracks).toHaveLength(1000)
  expect(view.container.querySelectorAll('[data-video-edit-track-header]').length).toBeLessThan(20)
  expect(headerOf('track-0')).not.toBeNull(); expect(headerOf('track-1')).not.toBeNull(); expect(headerOf('track-999')).toBeNull()
  const initial = [...view.container.querySelectorAll('[data-video-edit-track-header]')].map(row => row.getAttribute('data-video-edit-track-header'))
  scrollAudio(host, 4000)
  expect(headerOf('track-0')).toBeNull(); expect(headerOf('track-1')).not.toBeNull()
  expect(view.container.querySelectorAll('[data-video-edit-track-header]').length).toBeLessThan(20)
  expect([...view.container.querySelectorAll('[data-video-edit-track-header]')].map(row => row.getAttribute('data-video-edit-track-header'))).not.toEqual(initial)
  scrollAudio(host, -4000); expect(headerOf('track-0')).not.toBeNull()
  expect(onError).not.toHaveBeenCalled()
})

it('回放每帧与实际播放头拖动不重新渲染轨道头', () => {
  const previous = useSettingsStore.getState().videoEditSelectionFollowsPlayhead
  useSettingsStore.setState({ videoEditSelectionFollowsPlayhead: false })
  try {
    const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
    act(() => setVideoEditView(owner.document.id, { playing: true }))
    metrics.renders = 0
    for (let frame = 1; frame <= 30; frame++) act(() => { setVideoEditView(owner.document.id, { frame }, true) })
    expect(metrics.renders).toBe(0)
    const ruler = view.getByRole('slider', { name: '剪辑时间定位' })
    fireEvent.pointerDown(ruler, { ...pointer(14), clientX: 252 })
    metrics.renders = 0
    for (let frame = 1; frame <= 30; frame++) fireEvent.pointerMove(host, { ...pointer(14), clientX: 252 + frame * 2 })
    expect(owner.frame).toBe(40); expect(metrics.renders).toBe(0)
    fireEvent.pointerUp(host, { ...pointer(14), clientX: 312 })
    expect(onError).not.toHaveBeenCalled()
  } finally { useSettingsStore.setState({ videoEditSelectionFollowsPlayhead: previous }) }
})

it('离屏后保留键盘焦点，焦点进入缓冲行时滚入可见区域，移出焦点后释放旧行', () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  const target = view.getByRole('button', { name: '目标轨道 轨道0' })
  act(() => target.focus()); scrollAudio(host, 4000)
  expect(document.activeElement).toBe(target); expect(headerOf('track-0')).not.toBeNull()
  act(() => host.focus()); expect(headerOf('track-0')).toBeNull()
  scrollAudio(host, -4000)
  const buffer = view.getByRole('button', { name: '目标轨道 轨道8' })
  act(() => buffer.focus())
  const rect = buffer.getBoundingClientRect()
  expect(rect.top).toBeGreaterThanOrEqual(168); expect(rect.bottom).toBeLessThanOrEqual(300)
  expect(document.activeElement).toBe(buffer); expect(onError).not.toHaveBeenCalled()
  act(() => editVideoProject(owner.document.id, document => { document.sequences[0].tracks[8].height = 160; return document }))
  const separator = view.getByRole('separator', { name: '调整轨道8高度' })
  act(() => separator.focus())
  expect(separator.getBoundingClientRect().top).toBeGreaterThanOrEqual(168)
  expect(separator.getBoundingClientRect().bottom).toBeLessThanOrEqual(300)
  act(() => buffer.focus())
  expect(buffer.getBoundingClientRect().top).toBeGreaterThanOrEqual(168)
  expect(buffer.getBoundingClientRect().bottom).toBeLessThanOrEqual(300)
})

it('滚动后的轨道头目标、锁定、右键重命名与键盘高度仍走同一领域操作', async () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  scrollAudio(host, 4000)
  const row = view.container.querySelector<HTMLElement>('[data-video-edit-track-region="audio"] [data-video-edit-track-header]')!
  const id = row.getAttribute('data-video-edit-track-header')!; const track = current().tracks.find(value => value.id === id)!
  const controls = within(row)
  fireEvent.click(controls.getByRole('button', { name: `目标轨道 ${track.name}` }))
  expect(owner.targetTrackIds).toContain(id)
  fireEvent.click(controls.getByRole('button', { name: `${track.name}锁定` }))
  expect(current().tracks.find(value => value.id === id)?.locked).toBe(true)
  const separator = controls.getByRole('separator', { name: `调整${track.name}高度` })
  fireEvent.keyDown(separator, { key: 'ArrowDown' })
  expect(current().tracks.find(value => value.id === id)?.height).toBe(track.height! + 4)
  fireEvent.contextMenu(row, { clientX: 40, clientY: 200 }); fireEvent.click(view.getByText('重命名'))
  const input = await view.findByRole('textbox', { name: '轨道名称' })
  scrollAudio(host, 4000); expect(input.isConnected).toBe(true)
  fireEvent.change(input, { target: { value: '新轨道名' } }); fireEvent.keyDown(input, { key: 'Enter' })
  expect(current().tracks.find(value => value.id === id)?.name).toBe('新轨道名')
  expect(onError).not.toHaveBeenCalled()
})

it('高度拖动开始即保留源轨道，滚出视口仍可预览并在释放时提交一次', () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' }); const history = owner.past.length
  fireEvent.pointerDown(view.getByRole('separator', { name: '调整轨道0高度' }), pointer())
  scrollAudio(host, 4000); expect(headerOf('track-0')).not.toBeNull()
  fireEvent.pointerMove(host, pointer(220))
  expect(current().tracks[0].height).toBe(32); expect(owner.past).toHaveLength(history)
  fireEvent.pointerUp(host, pointer(220))
  expect(current().tracks[0].height).toBe(52); expect(owner.past).toHaveLength(history + 1)
  expect(headerOf('track-0')).toBeNull(); expect(onError).not.toHaveBeenCalled()
})

it('按钮编辑器打开期间保留轨道头锚点，滚动离屏后仍可关闭并释放旧行', async () => {
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  const anchor = headerOf('track-0')!
  fireEvent.contextMenu(anchor, { clientX: 40, clientY: 200 }); fireEvent.click(view.getByText('自定义…'))
  const confirm = await view.findByRole('button', { name: '确定' })
  scrollAudio(host, 4000); expect(anchor.isConnected).toBe(true)
  fireEvent.click(confirm); expect(headerOf('track-0')).toBeNull()
  expect(onError).not.toHaveBeenCalled()
})
