/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  useAssistantPanelInteraction,
  clampAssistantFloatingPosition,
  clampAssistantPanelSize,
  dockEdgeForLayout,
  getAssistantWorkspaceInsets,
  resizeAssistantPanelLayout,
} from './useAssistantPanelInteraction'

describe('assistant panel interaction geometry', () => {
  it('把悬浮面板约束在标题栏下方和可视区内', () => {
    expect(clampAssistantFloatingPosition(
      { x: -100, y: 2 },
      { width: 420, height: 680 },
      { width: 1280, height: 900 }
    )).toEqual({ x: 12, y: 48 })

    expect(clampAssistantFloatingPosition(
      { x: 2_000, y: 2_000 },
      { width: 420, height: 680 },
      { width: 1280, height: 900 }
    )).toEqual({ x: 848, y: 208 })
  })

  it('按停靠方向解释内侧边缘拖动并限制宽度', () => {
    const layout = { position: { x: 12, y: 48 }, size: { width: 420, height: 680 } }
    const viewport = { width: 1280, height: 900 }
    expect(resizeAssistantPanelLayout('left', 'width', layout, { x: 100, y: 0 }, viewport).size.width).toBe(520)
    expect(resizeAssistantPanelLayout('right', 'width', layout, { x: -100, y: 0 }, viewport).size.width).toBe(520)
    expect(resizeAssistantPanelLayout('right', 'width', layout, { x: 500, y: 0 }, viewport).size.width).toBe(320)
  })

  it('悬浮态可同时调整宽高且不会越过右下边界', () => {
    const layout = { position: { x: 100, y: 60 }, size: { width: 420, height: 500 } }
    expect(resizeAssistantPanelLayout(
      'floating',
      'both',
      layout,
      { x: 100, y: 100 },
      { width: 1280, height: 900 }
    ).size).toEqual({ width: 520, height: 600 })

    expect(clampAssistantPanelSize(
      'floating',
      { width: 1_200, height: 1_200 },
      { x: 700, y: 400 },
      { width: 1280, height: 900 }
    )).toEqual({ width: 568, height: 488 })
  })

  it('小窗口下仍保留可拖动的安全位置', () => {
    expect(clampAssistantFloatingPosition(
      { x: 300, y: 300 },
      { width: 420, height: 680 },
      { width: 360, height: 500 }
    )).toEqual({ x: 12, y: 48 })
  })

  it('按面板边沿而不是指针位置判定吸附', () => {
    const viewport = { width: 1280, height: 900 }
    const size = { width: 420, height: 680 }

    // 推到右边缘：右沿只剩 12px 间隙就该吸附，哪怕指针还停在屏幕中间
    expect(dockEdgeForLayout({ position: { x: 848, y: 60 }, size }, viewport)).toBe('right')
    expect(dockEdgeForLayout({ position: { x: 12, y: 60 }, size }, viewport)).toBe('left')
    // 两侧都远离边缘时保持悬浮
    expect(dockEdgeForLayout({ position: { x: 400, y: 60 }, size }, viewport)).toBeNull()
    // 阈值是 48：恰好 48 触发，49 不触发
    expect(dockEdgeForLayout({ position: { x: 48, y: 60 }, size }, viewport)).toBe('left')
    expect(dockEdgeForLayout({ position: { x: 49, y: 60 }, size }, viewport)).toBeNull()
    // 宽面板两侧都够得着时取更近的一边
    expect(dockEdgeForLayout(
      { position: { x: 20, y: 60 }, size: { width: 1_220, height: 680 } },
      viewport
    )).toBe('left')
  })

  it('停靠态只更新对应工作区内边距', () => {
    expect(getAssistantWorkspaceInsets('left', 480)).toEqual({ left: 480, right: 0 })
    expect(getAssistantWorkspaceInsets('right', 520)).toEqual({ left: 0, right: 520 })
    expect(getAssistantWorkspaceInsets('floating', 600)).toEqual({ left: 0, right: 0 })
  })
})

describe('assistant panel viewport resize', () => {
  it('窗口缩小再放大后恢复面板尺寸，且不回写被夹紧的布局', () => {
    const setViewport = (width: number, height: number): void => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    }
    setViewport(1920, 1080)
    const onCommitPosition = vi.fn()
    const onCommitSize = vi.fn()
    const { result } = renderHook(() => useAssistantPanelInteraction({
      enabled: true,
      mode: 'right',
      position: { x: 0, y: 0 },
      size: { width: 900, height: 600 },
      workspaceRef: createRef<HTMLDivElement>(),
      onCommitPosition,
      onCommitSize,
      onCommitMode: vi.fn(),
    }))
    const panel = document.createElement('div')
    act(() => result.current.panelRef(panel))
    expect(panel.style.width).toBe('900px')

    act(() => { setViewport(1000, 700); window.dispatchEvent(new Event('resize')) })
    expect(Number.parseInt(panel.style.width, 10)).toBeLessThan(900)

    act(() => { setViewport(1920, 1080); window.dispatchEvent(new Event('resize')) })
    expect(panel.style.width).toBe('900px')
    expect(onCommitSize).not.toHaveBeenCalled()
    expect(onCommitPosition).not.toHaveBeenCalled()
  })
})
