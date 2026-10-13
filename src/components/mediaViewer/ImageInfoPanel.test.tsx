// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settingsStore'
vi.mock('@/commands/image', () => ({ readImageInfo: async () => ({ width: 100, height: 100, fileSizeBytes: 10, createdAt: null }) }))
import { ImageInfoPanel } from './ImageInfoPanel'
beforeEach(() => { useSettingsStore.setState({ enableImageViewerInfoPanel: true, imageViewerInfoPanelCollapsed: false }) })
afterEach(cleanup)
it.each([false, true])('Tab 保留焦点导航，shift=%s', async shiftKey => {
  const { container } = render(<ImageInfoPanel open imageSource="image.png" />)
  await act(async () => {})
  const button = container.querySelector('button')!
  button.focus()
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  act(() => { button.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(false)
  expect(useSettingsStore.getState().imageViewerInfoPanelCollapsed).toBe(false)
})
it('I 折叠；编辑区、组合键和已处理事件不触发', async () => {
  const { container } = render(<ImageInfoPanel open imageSource="image.png" />)
  await act(async () => {})
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' })) })
  expect(useSettingsStore.getState().imageViewerInfoPanelCollapsed).toBe(true)
  const editable = document.createElement('div')
  editable.setAttribute('contenteditable', 'true')
  container.append(editable)
  act(() => {
    editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'I', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', ctrlKey: true }))
    const event = new KeyboardEvent('keydown', { key: 'i', cancelable: true })
    event.preventDefault()
    window.dispatchEvent(event)
  })
  expect(useSettingsStore.getState().imageViewerInfoPanelCollapsed).toBe(true)
})
