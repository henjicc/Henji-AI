// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Bookmark, Camera, Play } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { sanitizeVideoEditMonitorButtons, VIDEO_EDIT_MONITOR_BUTTON_DEFAULTS, withVideoEditMonitorButtons } from '@/core/videoEdit/monitorButtons'
import { VideoEditMonitorButtonEditor, type VideoEditMonitorButtonSpec } from './VideoEditMonitorButtons'

const specs: VideoEditMonitorButtonSpec[] = [
  { id: 'add_marker', title: '添加标记', Icon: Bookmark },
  { id: 'play_pause', title: '播放／暂停', Icon: Play },
  { id: 'export_frame', title: '导出帧', Icon: Camera },
]
const program = (): readonly string[] | undefined => useSettingsStore.getState().videoEditMonitorButtons.program
const open = (): void => { fireEvent.click(screen.getByRole('button', { name: '按钮编辑器' })) }
/** 收起动画结束、编辑器卸载后再打开 */
const closed = (): Promise<void> => waitFor(() => expect(document.querySelector('[aria-label="按钮栏"]')).toBeNull())
const bar = (): string[] => screen.getAllByRole('listitem').map(item => item.getAttribute('aria-label')!)

beforeEach(() => { useSettingsStore.getState().setVideoEditMonitorButtons('program', ['add_marker', 'play_pause']) })
afterEach(() => { cleanup(); vi.useRealTimers(); useSettingsStore.getState().setVideoEditMonitorButtons('program', null) })

it('设置只存改过的一侧：不认识或重复的按钮丢弃，与默认相同不存', () => {
  expect(sanitizeVideoEditMonitorButtons({ program: ['lift', 'nope', 'lift'], source: 'bad', other: [] })).toEqual({ program: ['lift'] })
  expect(sanitizeVideoEditMonitorButtons(null)).toEqual({})
  expect(withVideoEditMonitorButtons({ source: [] }, 'program', [...VIDEO_EDIT_MONITOR_BUTTON_DEFAULTS.program])).toEqual({ source: [] })
  expect(withVideoEditMonitorButtons({}, 'source', ['insert', 'lift'])).toEqual({ source: ['insert'] })
})

it('按钮编辑器：点击加入／移出、取消放弃、重置布局、确定保存', async () => {
  render(<VideoEditMonitorButtonEditor kind="program" specs={specs} />)
  open()
  expect(bar()).toEqual(['添加标记', '播放／暂停'])
  fireEvent.click(screen.getByRole('button', { name: '导出帧' }))
  fireEvent.click(screen.getByRole('button', { name: '添加标记' }))
  expect(bar()).toEqual(['播放／暂停', '导出帧'])
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(program()).toEqual(['add_marker', 'play_pause'])
  await closed(); open()
  fireEvent.click(screen.getByRole('button', { name: '导出帧' }))
  fireEvent.click(screen.getByRole('button', { name: '确定' }))
  expect(program()).toEqual(['add_marker', 'play_pause', 'export_frame'])
  await closed(); open()
  fireEvent.click(screen.getByRole('button', { name: '重置布局' })); fireEvent.click(screen.getByRole('button', { name: '确定' }))
  expect(program()).toBeUndefined()
})

it('拖进按钮栏的落点插入，拖出按钮栏即移除', () => {
  vi.useFakeTimers()
  render(<VideoEditMonitorButtonEditor kind="program" specs={specs} />)
  open()
  const list = screen.getByRole('list', { name: '按钮栏' })
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 28))
  screen.getAllByRole('listitem').forEach((item, index) => vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(new DOMRect(index * 30, 0, 28, 28)))
  const data = new Map<string, string>()
  const dataTransfer = { types: ['application/x-henji-monitor-button'], getData: (type: string) => data.get(type) ?? '', setData: (type: string, value: string) => data.set(type, value), effectAllowed: 'all', dropEffect: 'none' }
  fireEvent.dragStart(screen.getByRole('button', { name: '导出帧' }), { dataTransfer })
  // jsdom 的拖放事件不带坐标，手动补上落点
  const at = (event: Event): Event => { Object.defineProperty(event, 'clientX', { value: 10 }); return event }
  fireEvent(list, at(createEvent.dragOver(list, { dataTransfer })))
  fireEvent(list, at(createEvent.drop(list, { dataTransfer })))
  expect(bar()).toEqual(['导出帧', '添加标记', '播放／暂停'])
  const first = screen.getAllByRole('listitem')[0]
  fireEvent.mouseDown(first, { button: 0, clientX: 10, clientY: 10 })
  fireEvent.mouseMove(window, { clientX: 10, clientY: 60 })
  fireEvent.mouseMove(window, { clientX: 10, clientY: 80 })
  fireEvent.mouseUp(window, { clientX: 10, clientY: 80 })
  act(() => { vi.advanceTimersByTime(200) })
  expect(bar()).toEqual(['添加标记', '播放／暂停'])
})
