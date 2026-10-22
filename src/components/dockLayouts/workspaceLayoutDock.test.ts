// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDockview, type DockviewApi } from 'dockview-react'
import { waitFor } from '@testing-library/react'
import { installHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { defaultVideoEditLayout, VIDEO_EDIT_PANELS } from '@/features/videoEdit/layout/videoEditDockLayout'
import { registerWorkspaceLayout } from '@/services/workspaceLayouts/workspaceLayoutService'
import { bindWorkspaceLayoutDock } from './useWorkspaceLayoutPresets'

let api: DockviewApi
let host: HTMLDivElement
let release: (() => void) | undefined
beforeEach(() => {
  installHarnessNativeStorage()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 860))
  host = document.createElement('div'); document.body.append(host)
  api = createDockview(host, { disableAutoResizing: true, createComponent: () => ({ element: document.createElement('div'), init(): void {} }) })
  api.layout(1440, 860)
})
afterEach(() => { release?.(); api.dispose(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('共享 Dock 绑定切换和重置保持预览实例；当前布局修改可另存并恢复', async () => {
  const workspaceId = `dock-test-${crypto.randomUUID()}`
  const base = defaultVideoEditLayout()
  const controller = registerWorkspaceLayout({ workspaceId, panels: VIDEO_EDIT_PANELS, builtinPresets: [{ id: 'default', name: '默认', layout: base }] })
  const error = vi.fn(), beforeApply = vi.fn()
  release = bindWorkspaceLayoutDock(workspaceId, api, { onError: error, beforeApply })
  await controller.load()
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(controller.getSnapshot().dirty).toBe(false)
  const program = api.getPanel('program')!
  api.getPanel('timeline')!.api.moveTo({ group: program.group, position: 'center' })
  await waitFor(() => expect(controller.getSnapshot().dirty).toBe(true))
  const id = await controller.saveAs('双标签')
  expect(controller.getSnapshot().dirty).toBe(false)
  await controller.apply('default')
  expect(api.getPanel('program')).toBe(program)
  expect(api.getPanel('timeline')!.group).not.toBe(program.group)
  await controller.apply(id)
  expect(api.getPanel('timeline')!.group).toBe(program.group)
  await controller.resetActive()
  expect(controller.getSnapshot().activeId).toBe(id)
  expect(beforeApply).toHaveBeenCalledTimes(3)
  expect(error).not.toHaveBeenCalled()
})

it('读取完成前卸载不把迟到布局应用到已销毁 Dock', async () => {
  const workspaceId = `disposed-${crypto.randomUUID()}`
  const controller = registerWorkspaceLayout({ workspaceId, panels: VIDEO_EDIT_PANELS, builtinPresets: [{ id: 'default', name: '默认', layout: defaultVideoEditLayout() }] })
  const apply = vi.spyOn(api, 'fromJSON'), error = vi.fn()
  const detach = bindWorkspaceLayoutDock(workspaceId, api, { onError: error })
  detach()
  await controller.load()
  expect(apply).toHaveBeenCalledTimes(1)
  expect(error).not.toHaveBeenCalled()
})
