// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { AppMenuVisibilityContext } from '@/components/appMenu/appMenuVisibility'
import { findAppMenuCommand } from '@/core/appMenu/appMenu'
import type { CaptureSessionState } from '@/features/audioCapture/captureSession'
import { AudioEditRecordingControls } from './AudioEditRecordingControls'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), start: vi.fn(), stop: vi.fn(), pause: vi.fn(), error: vi.fn(), clear: vi.fn() }))
const store = createStore<CaptureSessionState>(() => ({ placement: null, visible: false, phase: 'idle', busy: false, status: null, outputPath: null, settings: null, error: '', notice: null }))
const workspace = { project: { id: 'draft', source: { durationFrames: 0 } }, disabled: true, waveSelection: null as null | { startFrame: number; endFrame: number }, togglePlayback: vi.fn(), notifyError: mocks.error, setWaveSelection: mocks.clear }
vi.mock('./audioEditWorkspaceContext', () => ({ useAudioEditWorkspace: () => workspace }))
vi.mock('../application/audioEditSpliceService', () => ({ prepareAudioEditTake: mocks.prepare }))
vi.mock('@/features/audioCapture', async () => ({ getAudioCaptureSession: () => ({ store, start: mocks.start, stop: mocks.stop, togglePause: mocks.pause }), AudioCaptureSettingsForm: () => null, AudioCaptureLive: () => null, isCaptureShortcut: (await import('@/features/audioCapture/captureLiveModel')).isCaptureShortcut }))
beforeEach(() => {
  vi.clearAllMocks()
  store.setState({ placement: null, phase: 'idle', busy: false, outputPath: null })
  workspace.project.source.durationFrames = 0; workspace.disabled = true; workspace.waveSelection = null
  useAudioEditPlaybackStore.setState({ sourceFrame: 0, playing: false })
  mocks.prepare.mockImplementation(async (projectId, startFrame, endFrame) => ({ projectId, startFrame, endFrame, revision: 1, spliceId: 'take' }))
  mocks.start.mockResolvedValue(undefined); mocks.stop.mockResolvedValue(undefined); mocks.pause.mockResolvedValue(undefined)
})
afterEach(cleanup)

it('空草稿允许快捷键录音；输入框、重复按键和隐藏工作区不抢键', async () => {
  const view = render(<AudioEditRecordingControls />)
  fireEvent.keyDown(window, { key: ' ', shiftKey: true })
  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
  expect(mocks.prepare).toHaveBeenCalledWith('draft', 0, 0)
  const input = document.createElement('textarea'); document.body.append(input)
  fireEvent.keyDown(input, { key: 'r', bubbles: true })
  fireEvent.keyDown(window, { key: 'r', repeat: true })
  expect(mocks.start).toHaveBeenCalledTimes(1)
  input.remove()
  view.rerender(<AppMenuVisibilityContext.Provider value={false}><AudioEditRecordingControls /></AppMenuVisibilityContext.Provider>)
  fireEvent.keyDown(window, { key: 'r' })
  expect(mocks.start).toHaveBeenCalledTimes(1)
  expect(findAppMenuCommand('audioCapture.startStop')).toBeUndefined()
})

it('选区覆盖、录音中停止与暂停、暂停后按当前播放头续录', async () => {
  workspace.project.source.durationFrames = 5000; workspace.disabled = false; workspace.waveSelection = { startFrame: 1000, endFrame: 2000 }
  render(<AudioEditRecordingControls />)
  fireEvent.keyDown(window, { key: 'r' })
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledWith('draft', 1000, 2000))
  act(() => { store.setState({ phase: 'recording', placement: { projectId: 'draft', startFrame: 1000, endFrame: 2000, revision: 1, spliceId: 'take' } }); workspace.disabled = true })
  fireEvent.click(screen.getByRole('button', { name: '暂停录音' }))
  expect(mocks.pause).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(window, { key: 'r' })
  expect(mocks.stop).toHaveBeenCalledTimes(1)
  act(() => { store.setState({ phase: 'paused' }); useAudioEditPlaybackStore.setState({ sourceFrame: 3500 }) })
  fireEvent.click(screen.getByRole('button', { name: '继续录音' }))
  await waitFor(() => expect(mocks.prepare).toHaveBeenLastCalledWith('draft', 3500, 3500))
  act(() => store.setState({ busy: true }))
  fireEvent.keyDown(window, { key: 'r' })
  expect(mocks.stop).toHaveBeenCalledTimes(1)
})
