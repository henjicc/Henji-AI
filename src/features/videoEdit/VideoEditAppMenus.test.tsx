/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getAppMenus, findAppMenuCommand } from '@/core/appMenu/appMenu'
import { VideoEditAppMenus } from './VideoEditAppMenus'

const mock = vi.hoisted(() => ({ execute: vi.fn(async () => undefined), state: vi.fn(() => ({ enabled: false, reason: '请先选择片段。' })) }))
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: (selector: (state: { videoEditShortcuts: object }) => unknown) => selector({ videoEditShortcuts: { split: { code: 'KeyS', ctrl: true, shift: true, alt: false, meta: false } } }) }))
vi.mock('./application/videoEditService', () => ({ activeVideoEditInstance: () => ({ document: { id: 'project' }, activePanel: 'timeline' }), subscribeVideoEdit: () => () => undefined, subscribeVideoEditView: () => () => undefined, videoEditRevision: () => 1, videoEditViewRevision: () => 1 }))
vi.mock('./application/videoEditCommands', () => ({ captureVideoEditCommandContext: () => ({}), executeVideoEditCommand: mock.execute, videoEditCommandState: mock.state }))
afterEach(cleanup)

it('挂载声明菜单并往视图菜单加安全框，读取注册表及用户改键，卸载撤回', async () => {
  const view = render(<VideoEditAppMenus />)
  // 首次登记在下一轮任务（不阻塞挂载）；之后的视图变化合并到 150ms 后一次。
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(findAppMenuCommand('videoEdit.toggle_safe_margins')).toMatchObject({ label: '安全框' })
  expect(findAppMenuCommand('videoEdit.split')).toMatchObject({ shortcut: 'Ctrl+Shift+S', disabledReason: '请先选择片段。' })
  expect(findAppMenuCommand('videoEdit.new_sequence')).toBeDefined()
  expect(findAppMenuCommand('videoEdit.prev_marker')).toBeDefined()
  view.unmount()
  expect(getAppMenus()).toEqual([])
})
