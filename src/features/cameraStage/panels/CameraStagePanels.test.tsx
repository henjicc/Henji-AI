import { parseWorkspaceDockLayout } from '@/core/workspaceLayouts/validation'
/** @vitest-environment jsdom */
import React from 'react'
import { createPortal } from 'react-dom'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDefaultAnimation } from '../domain/animationTypes'
import { createDefaultCameraStageSceneSnapshot } from '../domain/defaultSceneSnapshot'
import { CAMERA_STAGE_PANEL_TITLES, defaultCameraStageLayout } from '../layout/dockLayout'
import { DockTab } from '../layout/DockChrome'
import { useCameraStageStore } from '../store/cameraStageStore'
import ObjectListPanel from './ObjectListPanel'
import PropertyPanel from './PropertyPanel'

/**
 * 3D 镜头参考停靠面板（界面重设计 5.5 第一批）：面板内不再重复标题带、不再抬一级底色，
 * 空状态走 UiEmpty，改名不再套描边框；旧布局里存的面板标题恢复时按统一术语回写。
 */

function loadEmptyScene(): void {
  const snapshot = createDefaultCameraStageSceneSnapshot()
  useCameraStageStore.getState().loadSnapshot({
    objects: [],
    activeCameraId: null,
    animation: createDefaultAnimation(),
    sceneSettings: snapshot.sceneSettings,
    stateKeyframes: [],
  }, { id: 'panel-test', name: '面板测试' })
}

beforeEach(() => {
  loadEmptyScene()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('3D 镜头参考停靠面板', () => {
  it('浮窗改名按所属窗口聚焦，取消编辑和卸载都取消待执行帧', () => {
    act(() => useCameraStageStore.getState().addPrimitive('box'))
    const name = useCameraStageStore.getState().objects[0].name
    const iframe = document.createElement('iframe'); document.body.append(iframe)
    const popout = iframe.contentWindow!
    const frames = new Map<number, FrameRequestCallback>(); let id = 0
    vi.spyOn(popout, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++id, callback); return id })
    vi.spyOn(popout, 'cancelAnimationFrame').mockImplementation(handle => { frames.delete(handle) })
    const view = render(createPortal(<ObjectListPanel />, popout.document.body))
    const panel = within(popout.document.body)
    const rename = (): HTMLInputElement => {
      fireEvent.doubleClick(panel.getByRole('button', { name }))
      return panel.getByRole('textbox', { name: '对象名称' }) as HTMLInputElement
    }
    const input = rename()
    expect(frames.size).toBe(1)
    act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(16)) })
    expect(popout.document.activeElement).toBe(input)
    expect(input.selectionEnd).toBe(name.length)
    expect(frames.size).toBe(0)
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.keyDown(rename(), { key: 'Escape' })
    expect(frames.size).toBe(0)
    rename(); view.unmount()
    expect(frames.size).toBe(0)
    iframe.remove()
  })
  it('场景为空时对象列表显示统一空状态，且面板内没有重复标题', () => {
    const { container } = render(<ObjectListPanel />)
    expect(screen.getByText('场景为空')).toBeTruthy()
    expect(screen.queryByText('场景对象')).toBeNull()
    expect(container.firstElementChild?.className).not.toContain('bg-raised')
  })

  it('改名时只出现输入框，不再在外面套强调色描边框', () => {
    act(() => useCameraStageStore.getState().addPrimitive('box'))
    const name = useCameraStageStore.getState().objects[0].name
    render(<ObjectListPanel />)
    fireEvent.doubleClick(screen.getByRole('button', { name }))
    const input = screen.getByRole('textbox', { name: '对象名称' }) as HTMLInputElement
    expect(input.value).toBe(name)
    expect(input.closest('.border-accent')).toBeNull()
  })

  it('未选中对象时属性面板显示场景设置分组，不再画标题带与抬升底色', () => {
    const { container } = render(<PropertyPanel />)
    expect(screen.getByText('地面')).toBeTruthy()
    expect(screen.getByText('阳光')).toBeTruthy()
    expect(screen.queryByText('场景设置')).toBeNull()
    expect(container.firstElementChild?.className).not.toContain('bg-raised')
    // 样式决定其余地面参数的含义，排在第一位
    const labels = Array.from(container.querySelectorAll('.text-xs.text-text2')).map((node) => node.textContent)
    expect(labels.indexOf('样式')).toBeLessThan(labels.indexOf('底色'))
  })

  it('选中对象时属性面板用紧凑分组展示对象与变换', () => {
    act(() => useCameraStageStore.getState().addPrimitive('box'))
    render(<PropertyPanel />)
    expect(screen.getByText('对象')).toBeTruthy()
    expect(screen.getByText('变换')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '对象名称' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: '在场景中显示' })).toBeTruthy()
  })
})

describe('停靠布局标题', () => {
  it('属性面板的标签随内容：未选中对象叫“场景设置”，选中后叫“属性”', () => {
    const api = { id: 'properties', title: '属性', onDidTitleChange: () => ({ dispose: () => undefined }) }
    const props = { api } as unknown as React.ComponentProps<typeof DockTab>
    render(<DockTab {...props} />)
    expect(screen.getByText('场景设置')).toBeTruthy()
    act(() => useCameraStageStore.getState().addPrimitive('box'))
    expect(screen.getByText('属性')).toBeTruthy()
  })

  it('恢复旧布局后把旧标题（资源管理器、时间轴）回写为统一术语', () => {
    const layout = defaultCameraStageLayout()
    layout.panels.objects.title = '资源管理器'
    layout.panels.timeline.title = '时间轴'
    const parsed = parseWorkspaceDockLayout(JSON.stringify(layout), Object.entries(CAMERA_STAGE_PANEL_TITLES).map(([id, title]) => ({ id, title })))
    expect(parsed.panels.objects.title).toBe('场景对象')
    expect(parsed.panels.timeline.title).toBe('状态关键帧')

  })
})
