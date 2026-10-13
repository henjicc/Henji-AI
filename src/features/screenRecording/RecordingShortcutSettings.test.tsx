// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { useSettingsStore } from '@/stores/settingsStore'
import { DEFAULT_RECORDING_SHORTCUTS } from '@/core/screenRecording/contracts'
import { RecordingShortcutSettings } from './RecordingShortcutSettings'

beforeAll(async () => { await i18n.changeLanguage('zh-CN') })
beforeEach(() => useSettingsStore.getState().setRecordingShortcuts(DEFAULT_RECORDING_SHORTCUTS))
afterEach(cleanup)
it('实际改键、冲突拒绝、Esc取消、清除和恢复共用正式设置', () => {
  render(<RecordingShortcutSettings />)
  fireEvent.click(screen.getByRole('button', { name: '修改开始 / 暂停录制快捷键' }))
  fireEvent.keyDown(window, { code: 'F10', key: 'F10', ctrlKey: true, shiftKey: true })
  expect(useSettingsStore.getState().recordingShortcuts).toEqual(DEFAULT_RECORDING_SHORTCUTS)
  expect(screen.getByText('这组快捷键已用于其他录制操作，请换一组')).toBeTruthy()
  fireEvent.keyDown(window, { code: 'KeyR', key: 'r', altKey: true })
  expect(useSettingsStore.getState().recordingShortcuts.toggle).toBe('Alt+R')
  fireEvent.click(screen.getByRole('button', { name: '修改停止录制快捷键' }))
  fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' })
  expect(screen.queryByText('按下快捷键，Esc 取消')).toBeNull()
  fireEvent.click(screen.getAllByRole('button', { name: '清除' })[0])
  expect(useSettingsStore.getState().recordingShortcuts.toggle).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '恢复录制默认快捷键' }))
  expect(useSettingsStore.getState().recordingShortcuts).toEqual(DEFAULT_RECORDING_SHORTCUTS)
})
it('Windows Meta 与 Ctrl 同时按下时保留两个修饰键，不错误折叠成 Ctrl', () => {
  render(<RecordingShortcutSettings />)
  fireEvent.click(screen.getByRole('button', { name: '修改开始 / 暂停录制快捷键' }))
  fireEvent.keyDown(window, { code: 'KeyR', key: 'r', ctrlKey: true, metaKey: true })
  expect(useSettingsStore.getState().recordingShortcuts.toggle).toBe('CommandOrControl+Super+R')
})
it('macOS Control 和 Command 分别录入，不把 Control 改成 Command', () => {
  const agent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh')
  try {
    render(<RecordingShortcutSettings />)
    fireEvent.click(screen.getByRole('button', { name: '修改开始 / 暂停录制快捷键' }))
    fireEvent.keyDown(window, { code: 'KeyR', key: 'r', ctrlKey: true })
    expect(useSettingsStore.getState().recordingShortcuts.toggle).toBe('Control+R')
    fireEvent.click(screen.getByRole('button', { name: '修改开始 / 暂停录制快捷键' }))
    fireEvent.keyDown(window, { code: 'KeyR', key: 'r', metaKey: true })
    expect(useSettingsStore.getState().recordingShortcuts.toggle).toBe('CommandOrControl+R')
  } finally { agent.mockRestore() }
})
