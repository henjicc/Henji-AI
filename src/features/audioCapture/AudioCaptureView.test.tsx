// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CaptureSession } from './captureSession'
import { captureFixture } from './captureTestFixture'
import { AudioCaptureView } from './AudioCaptureView'
import { isCaptureShortcut } from './captureLiveModel'

const current = vi.hoisted(() => ({ session: null as CaptureSession | null }))
vi.mock('./captureApplicationService', () => ({ getAudioCaptureSession: () => current.session }))
vi.mock('./AudioCaptureSettingsForm', () => ({ AudioCaptureSettingsForm: () => null }))
vi.mock('./AudioCaptureLive', () => ({ AudioCaptureLive: () => null }))
vi.mock('@/core/appMenu/appMenu', () => ({ contributeAppMenus: () => () => {} }))
afterEach(cleanup)
it('Shift+空格/R 控制开始与停止，修饰键、长按和输入场景不触发', async () => {
  const { api } = captureFixture()
  current.session = new CaptureSession(api, vi.fn(async () => {}), vi.fn(async () => true))
  await current.session.open()
  render(<AudioCaptureView />)
  fireEvent.keyDown(window, { key: ' ', shiftKey: true })
  await screen.findByRole('button', { name: '停止' })
  fireEvent.click(screen.getByRole('button', { name: '暂停' }))
  await screen.findByRole('button', { name: '继续' })
  fireEvent.keyDown(window, { key: 'r', repeat: true }); expect(api.stop).not.toHaveBeenCalled()
  fireEvent.keyDown(window, { key: 'r', ctrlKey: true }); expect(api.stop).not.toHaveBeenCalled()
  const input = document.createElement('textarea'); document.body.append(input)
  fireEvent.keyDown(input, { key: 'r' }); expect(api.stop).not.toHaveBeenCalled(); input.remove()
  await act(async () => { fireEvent.keyDown(window, { key: 'R' }) })
  await waitFor(() => expect(api.stop).toHaveBeenCalledTimes(1))
  expect(isCaptureShortcut({ key: ' ', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false })).toBe(false)
})
