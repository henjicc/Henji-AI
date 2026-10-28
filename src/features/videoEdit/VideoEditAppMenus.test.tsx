/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getAppMenus, findAppMenuCommand } from '@/core/appMenu/appMenu'
import { VideoEditAppMenus } from './VideoEditAppMenus'

const mock = vi.hoisted(() => ({ panel: 'timeline', execute: vi.fn(async () => undefined), state: vi.fn(() => ({ enabled: false, reason: '请先选择片段。' })) }))
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: (selector: (state: { videoEditShortcuts: object }) => unknown) => selector({ videoEditShortcuts: { split: { code: 'KeyS', ctrl: true, shift: true, alt: false, meta: false } } }) }))
vi.mock('./application/videoEditService', () => ({ activeVideoEditInstance: () => ({ document: { id: 'project' }, activePanel: mock.panel }), subscribeVideoEdit: () => () => undefined, subscribeVideoEditView: () => () => undefined, videoEditRevision: () => 1, videoEditViewRevision: () => 1 }))
vi.mock('./application/videoEditCommands', () => ({ captureVideoEditCommandContext: (_projectId: string, scope: string) => ({ scope }), executeVideoEditCommand: mock.execute, videoEditCommandState: mock.state }))
vi.mock('./application/videoEditAnnotations', () => ({ subscribeVideoEditAnnotationSelection: () => () => undefined, videoEditAnnotationSelectionRevision: () => 1 }))
afterEach(cleanup)

it('挂载声明菜单并往视图菜单加安全框，读取注册表及用户改键，卸载撤回', async () => {
  const view = render(<VideoEditAppMenus />)
  // 首次登记在下一轮任务（不阻塞挂载）；之后的视图变化合并到 150ms 后一次。
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(findAppMenuCommand('videoEdit.toggle_safe_margins')).toMatchObject({ label: '安全框' })
  expect(findAppMenuCommand('videoEdit.split')).toMatchObject({ shortcut: 'Ctrl+Shift+S', disabledReason: '请先选择片段。' })
  expect(findAppMenuCommand('videoEdit.new_sequence')).toBeDefined()
  expect(findAppMenuCommand('videoEdit.prev_marker')).toBeDefined()
  // 批注菜单固定在批注作用域执行同一条命令：当前面板是时间线时，“删除选中批注”也不会删片段
  await findAppMenuCommand('videoEdit.annotations.delete')!.run()
  expect(mock.execute).toHaveBeenLastCalledWith({ scope: 'annotations' }, 'delete')
  expect(findAppMenuCommand('videoEdit.annotations.delete')).toMatchObject({ label: '删除选中批注', shortcut: 'Delete' })
  view.unmount()
  expect(getAppMenus()).toEqual([])
})

it('焦点在没有专属命令的面板时，菜单与键盘同一规则：导航命令按当前序列判断可用，编辑命令不适用', async () => {
  mock.panel = 'scenes'; mock.state.mockClear(); mock.execute.mockClear()
  try {
    const view = render(<VideoEditAppMenus />)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(mock.state).toHaveBeenCalledWith({ scope: 'timeline' }, 'next_marker')
    expect(mock.state).not.toHaveBeenCalledWith(expect.anything(), 'split')
    expect(findAppMenuCommand('videoEdit.split')).toMatchObject({ disabledReason: '此命令不适用于当前面板。' })
    await findAppMenuCommand('videoEdit.next_marker')!.run()
    expect(mock.execute).toHaveBeenLastCalledWith({ scope: 'timeline' }, 'next_marker')
    view.unmount()
  } finally { mock.panel = 'timeline' }
})
