// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { RecordingControlSnapshot } from '@/core/screenRecording/contracts'
import type { RecordingDocument } from '@/core/screenRecording/document'
import i18n from '@/i18n/config'

const fixture = vi.hoisted(() => ({
  view: { documentId: null as string | null, content: null as RecordingDocument | null, snapshot: null as RecordingControlSnapshot | null, busy: false, opening: false, error: null, destination: null },
  control: vi.fn(), start: vi.fn(async (..._args: unknown[]) => 'session'),
}))
vi.mock('./application/recordingService', () => ({ recordingView: () => fixture.view, subscribeRecording: () => () => {}, controlRecording: fixture.control, setRecordingDestination: vi.fn(), startRecording: fixture.start }))
vi.mock('@/platform', () => ({ getPlatform: () => ({ screenRecording: { sources: async () => [
  { id: 'screen:1:0', name: '屏幕 1', kind: 'screen', thumbnailUrl: 'data:image/png;base64,AA==' },
  { id: 'window:2:0', name: '很长的窗口标题 · 痕迹AI', kind: 'window', thumbnailUrl: 'data:image/png;base64,AA==' },
] , capture: async () => ['auto', 'software'] } }) }))
vi.mock('./RecordingDirectorPanel', () => ({ RecordingDirectorGoal: () => <div />, RecordingDirectorScript: () => <div /> }))
vi.mock('./tracks/devices', () => ({ recordingDevices: async () => [] }))
vi.mock('@/features/navigation', () => ({ openApplicationSurface: vi.fn() }))
import ScreenRecordingApp from './ScreenRecordingApp'
import { NotificationProvider } from '@/contexts/NotificationContext'

beforeAll(async () => { await i18n.changeLanguage('zh-CN') })
beforeEach(() => {
  fixture.view = { documentId: null, content: null, snapshot: null, busy: false, opening: false, error: null, destination: null }; fixture.control.mockClear(); fixture.start.mockClear(); localStorage.clear()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.textContent?.includes('很长的窗口标题') ? 300 : 100 })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('先选录制范围：屏幕按位置排布、窗口单独成网格，设置在右侧固定标签列，关闭设备即隐藏选择', async () => {
  render(<NotificationProvider><ScreenRecordingApp onBack={vi.fn()} /></NotificationProvider>)
  const display = await screen.findByRole('button', { name: '屏幕 1' })
  expect(display.closest('[data-recording-source-picker]')?.getAttribute('data-recording-source-picker')).toBe('screen')
  expect(screen.queryByRole('button', { name: '很长的窗口标题 · 痕迹AI' })).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: '单个窗口' }))
  const source = await screen.findByRole('button', { name: '很长的窗口标题 · 痕迹AI' })
  const image = source.querySelector('img')!
  const title = source.querySelector('[data-recording-source-title]')!
  expect(image.parentElement).not.toBe(title.parentElement)
  expect(title.classList.contains('truncate')).toBe(true)
  const mic = screen.getByRole('switch', { name: '麦克风' })
  expect(mic.closest('[data-ui-form-row]')?.getAttribute('data-ui-form-row')).toBe('panel')
  expect(mic.closest('[data-ui-form-row]')?.getAttribute('data-label-width')).toBe('96')
  expect(screen.getByRole('button', { name: /录音设置/ })).toBeTruthy()
  fireEvent.click(mic)
  expect(screen.queryByRole('button', { name: /录音设置/ })).toBeNull()
  expect(screen.queryByLabelText('摄像头设备')).toBeNull()
  fireEvent.click(screen.getByRole('switch', { name: '摄像头' }))
  expect(screen.getByLabelText('摄像头设备')).toBeTruthy()
})
it('停止后不再有回看工作台：打开剪辑期间只显示进度，之后回到录前设置；开始录制会把结果交给剪辑', async () => {
  fixture.view = { ...fixture.view, opening: true }
  const { rerender } = render(<NotificationProvider><ScreenRecordingApp onBack={vi.fn()} /></NotificationProvider>)
  expect(screen.getByText('正在打开剪辑…')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '开始录制' })).toBeNull()
  expect(screen.queryByRole('button', { name: '生成成片' })).toBeNull()
  fixture.view = { ...fixture.view, opening: false }
  rerender(<NotificationProvider><ScreenRecordingApp onBack={vi.fn()} /></NotificationProvider>)
  await screen.findByRole('button', { name: '屏幕 1' })
  fireEvent.click(screen.getByRole('button', { name: '开始录制' }))
  await waitFor(() => expect(fixture.start).toHaveBeenCalled())
  expect(fixture.start.mock.calls[0][0]).toMatchObject({ sourceId: 'screen:1:0', fps: 60 })
  expect(fixture.start.mock.calls[0].at(-1)).toBe(true)
  await act(async () => {})
})
