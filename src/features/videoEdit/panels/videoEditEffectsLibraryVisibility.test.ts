// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { VideoEditInstance } from '../application/videoEditService'
import { useVideoEditEffectLibraryStore } from '../application/videoEditEffectPresets'
import { VideoEditEffectsLibraryPanel } from './VideoEditEffectsLibraryPanel'

vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({ showNotification: vi.fn() }) }))
afterEach(() => cleanup())

it('空文件夹无论是否搜索都隐藏，有条目的分类仍可搜索和显示', () => {
  useVideoEditEffectLibraryStore.setState({ favorites: [], presets: [] })
  const instance = { selectedClipIds: [] } as unknown as VideoEditInstance
  const { container, getByRole } = render(createElement(VideoEditEffectsLibraryPanel, { instance, onError: vi.fn() }))
  for (const folder of container.querySelectorAll('[data-video-edit-effects-folder][aria-expanded="true"]')) expect(folder.querySelector('[data-video-edit-effects-entry]')).not.toBeNull()
  for (const id of ['favorites', 'presets', 'generator']) expect(container.querySelector(`[data-video-edit-effects-folder="${id}"]`)).toBeNull()
  expect(container.querySelector('[data-video-edit-effects-folder="video_effect"]')).not.toBeNull()
  fireEvent.change(getByRole('textbox', { name: '搜索效果' }), { target: { value: '完全不存在的效果' } })
  expect(container.querySelector('[data-video-edit-effects-folder]')).toBeNull()
  fireEvent.change(getByRole('textbox', { name: '搜索效果' }), { target: { value: '模糊' } })
  expect(container.querySelector('[data-video-edit-effects-folder="video_effect"]')).not.toBeNull()
  for (const folder of container.querySelectorAll('[data-video-edit-effects-folder]')) expect(folder.querySelector('[data-video-edit-effects-entry]')).not.toBeNull()
})
