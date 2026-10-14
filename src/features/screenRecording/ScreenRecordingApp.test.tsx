// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { VideoViewerModalProps } from '@/components/mediaViewer/VideoViewerModal'
import type { RecordingControlSnapshot } from '@/core/screenRecording/contracts'
import type { RecordingDocument } from '@/core/screenRecording/document'
import { createRecordingDocument } from '@/core/screenRecording/document'
import i18n from '@/i18n/config'

const fixture = vi.hoisted(() => ({
  view: { documentId: null as string | null, content: null as RecordingDocument | null, snapshot: null as RecordingControlSnapshot | null, busy: false, error: null, destination: null },
  viewer: vi.fn((props: VideoViewerModalProps): void => { void props }), control: vi.fn(),
}))
vi.mock('./application/recordingService', () => ({ recordingView: () => fixture.view, subscribeRecording: () => () => {}, controlRecording: fixture.control, recoverRecording: vi.fn(), setRecordingDestination: vi.fn(), startRecording: vi.fn() }))
vi.mock('@/platform', () => ({ getPlatform: () => ({ screenRecording: { sources: async () => [
  { id: 'screen:1:0', name: '屏幕 1', kind: 'screen', thumbnailUrl: 'data:image/png;base64,AA==' },
  { id: 'window:2:0', name: '很长的窗口标题 · 痕迹AI', kind: 'window', thumbnailUrl: 'data:image/png;base64,AA==' },
] } }) }))
vi.mock('./RecordingSessionPrivacy', () => ({ RecordingSessionPrivacy: () => <div /> }))
// 脚本面板有独立测试（4.1）；这里只验会话页聚合、跳转与成片入口。
vi.mock('./RecordingScriptPanel', () => ({ RecordingScriptPanel: () => <div /> }))
vi.mock('./RecordingRedubPanel', () => ({ RecordingRedubPanel: () => <div /> }))
vi.mock('./RecordingDirectorPanel', () => ({ RecordingDirectorPanel: () => <div /> }))
vi.mock('./tracks/devices', () => ({ recordingDevices: async () => [] }))
vi.mock('@/features/navigation', () => ({ openApplicationSurface: vi.fn() }))
vi.mock('@/components/mediaViewer/VideoViewerModal', () => ({ VideoViewerModal: (props: VideoViewerModalProps) => { fixture.viewer(props); return <div data-testid="shared-viewer" /> } }))
import ScreenRecordingApp from './ScreenRecordingApp'
import { NotificationProvider } from '@/contexts/NotificationContext'

beforeAll(async () => { await i18n.changeLanguage('zh-CN') })
beforeEach(() => {
  fixture.view = { documentId: null, content: null, snapshot: null, busy: false, error: null, destination: null }; fixture.viewer.mockClear(); fixture.control.mockClear()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.textContent?.includes('很长的窗口标题') ? 300 : 100 })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('来源缩略图与标题分栏，设置固定左侧标签列，关闭设备即隐藏选择', async () => {
  render(<NotificationProvider><ScreenRecordingApp onBack={vi.fn()} /></NotificationProvider>)
  await screen.findByRole('button', { name: '屏幕 1' })
  const source = screen.getByRole('button', { name: '很长的窗口标题 · 痕迹AI' })
  const image = source.querySelector('img')!
  const title = source.querySelector('[data-recording-source-title]')!
  expect(image.parentElement).not.toBe(title.parentElement)
  expect(title.classList.contains('truncate')).toBe(true)
  await waitFor(() => expect(source.getAttribute('aria-describedby')).toBeTruthy())
  expect(screen.getByRole('button', { name: '屏幕 1' }).getAttribute('aria-describedby')).toBeNull()
  const mic = screen.getByRole('switch', { name: '麦克风' })
  expect(mic.closest('[data-ui-form-row]')?.getAttribute('data-ui-form-row')).toBe('panel')
  expect(mic.closest('[data-ui-form-row]')?.getAttribute('data-label-width')).toBe('120')
  expect(screen.getByLabelText('麦克风设备')).toBeTruthy()
  fireEvent.click(mic)
  expect(screen.queryByLabelText('麦克风设备')).toBeNull()
  expect(screen.queryByLabelText('摄像头设备')).toBeNull()
  fireEvent.click(screen.getByRole('switch', { name: '摄像头' }))
  expect(screen.getByLabelText('摄像头设备')).toBeTruthy()
})
it('会话按轨道聚合完整分片，标记与步骤跳转，成片入口可用', async () => {
  const document = createRecordingDocument()
  document.sessionId = '00000000-0000-4000-8000-000000000001'; document.status = 'stopped'
  document.media = [
    { id: 's0', kind: 'screen', path: '/first.mp4', monoUs: 100000, durationUs: 5000000 },
    { id: 'mic', kind: 'microphone', path: '/mic.wav', monoUs: 100000, durationUs: 11000000 },
    { id: 's5', kind: 'screen', path: '/last.mp4', monoUs: 6100000, durationUs: 5000000 },
  ]
  document.markers = [{ id: 'marker', monoUs: 9800000, note: '重点演示' }]
  document.understanding.steps = [{ id: 'step', startUs: 6100000, endUs: 11100000, title: '完成设置', description: '', signal: 'marker', eventIds: [] }]
  fixture.view = { ...fixture.view, documentId: document.sessionId, content: document }
  render(<NotificationProvider><ScreenRecordingApp onBack={vi.fn()} /></NotificationProvider>)
  await waitFor(() => expect(fixture.viewer).toHaveBeenCalled())
  const latest = (): VideoViewerModalProps => fixture.viewer.mock.calls.at(-1)![0]
  expect(latest().presentation).toBe('inline')
  expect(latest().timeline?.duration).toBe(11)
  expect(latest().timeline?.segments).toHaveLength(2)
  expect(screen.getByLabelText('预览轨道').textContent).toContain('屏幕')
  expect(screen.queryByText('屏幕 5')).toBeNull()
  expect((screen.getByRole('button', { name: '生成成片' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.queryByText(/下一阶段|第二阶段/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /9.7 s.*重点演示/ }))
  expect(latest().seekRequest).toEqual({ seconds: 9.7, request: 1 })
  fireEvent.click(screen.getByRole('button', { name: /完成设置/ }))
  expect(latest().seekRequest).toEqual({ seconds: 6, request: 2 })
  await act(async () => {})
})
