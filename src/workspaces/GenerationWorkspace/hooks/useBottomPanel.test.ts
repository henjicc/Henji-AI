/** @vitest-environment jsdom */
import { createElement } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shouldUseCompactGenerationLayout } from '@/core/layout/uiAvailableSpace'
import { COLLAPSE_SETTING_CHANGED_EVENT } from '@/hooks/useLocalStorageSetting'
import { useNavigationStore } from '@/stores/navigationStore'
import { useBottomPanel } from './useBottomPanel'

vi.mock('@/stores/navigationStore', async () => {
  const { create } = await import('zustand')
  return { useNavigationStore: create(() => ({ activeWorkspace: 'nodes' })) }
})

const hitTest = vi.fn<[number, number], Element[]>(() => [])
const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  hitTest.mockReset().mockReturnValue([])
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: hitTest })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  useNavigationStore.setState({ activeWorkspace: 'nodes' })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  if (originalHitTest) Object.defineProperty(document, 'elementsFromPoint', originalHitTest)
  else Reflect.deleteProperty(document, 'elementsFromPoint')
})

function fixture() {
  const list = document.createElement('div')
  Object.defineProperties(list, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 } })
  list.scrollTop = 100
  const listContainerRef = { current: list }
  let result: ReturnType<typeof useBottomPanel>
  function Harness() {
    result = useBottomPanel({ listContainerRef })
    return createElement('div', { ref: result.inputContainerRef, 'data-testid': 'panel' })
  }
  const view = render(createElement(Harness))
  return { ...view, list, state: () => result }
}

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const navigate = (workspace: 'generation' | 'nodes' | 'tools') => act(() => {
  useNavigationStore.setState({ activeWorkspace: workspace })
})

it('自动收起关闭时停止检测，重新启用时恢复', () => {
  localStorage.setItem('enable_auto_collapse', 'false')
  navigate('generation')
  fixture()
  advance(2000)
  expect(hitTest).not.toHaveBeenCalled()
  act(() => {
    localStorage.setItem('enable_auto_collapse', 'true')
    window.dispatchEvent(new Event(COLLAPSE_SETTING_CHANGED_EVENT))
  })
  advance(500)
  expect(hitTest).toHaveBeenCalledTimes(1)
  act(() => {
    localStorage.setItem('enable_auto_collapse', 'false')
    window.dispatchEvent(new Event(COLLAPSE_SETTING_CHANGED_EVENT))
  })
  advance(2000)
  expect(hitTest).toHaveBeenCalledTimes(1)
})

it('隐藏期间零命中检测，反复切回只恢复一份检测，卸载后停止', () => {
  const view = fixture()
  advance(2000)
  expect(hitTest).not.toHaveBeenCalled()
  for (let round = 0; round < 3; round++) {
    navigate('generation')
    advance(1000)
    expect(hitTest).toHaveBeenCalledTimes((round + 1) * 2)
    navigate(round % 2 ? 'tools' : 'nodes')
    advance(2000)
    expect(hitTest).toHaveBeenCalledTimes((round + 1) * 2)
  }
  navigate('generation')
  view.unmount()
  advance(2000)
  expect(hitTest).toHaveBeenCalledTimes(6)
})

it('切回后使用隐藏期间的最新鼠标坐标，悬浮保护及离开后的滚动收起仍生效', () => {
  const view = fixture()
  fireEvent.mouseMove(document, { clientX: 80, clientY: 90 })
  hitTest.mockReturnValue([view.getByTestId('panel')])
  navigate('generation')
  advance(500)
  expect(hitTest).toHaveBeenLastCalledWith(80, 90)
  view.list.scrollTop = 120
  fireEvent.scroll(view.list)
  expect(view.state().isCollapsing).toBe(false)
  expect(view.state().isPanelCollapsed).toBe(false)

  navigate('nodes')
  fireEvent.mouseMove(document, { clientX: 160, clientY: 180 })
  hitTest.mockReturnValue([])
  navigate('generation')
  advance(500)
  expect(hitTest).toHaveBeenLastCalledWith(160, 180)
  view.list.scrollTop = 140
  fireEvent.scroll(view.list)
  expect(view.state().isCollapsing).toBe(true)
  advance(600)
  expect(view.state().isPanelCollapsed).toBe(true)
})

describe('shouldUseCompactGenerationLayout', () => {
  it('按缩放后的实际工作区高度进入紧凑模式', () => {
    expect(shouldUseCompactGenerationLayout(1470, 848)).toBe(true)
    expect(shouldUseCompactGenerationLayout(1470, 1000)).toBe(false)
  })

  it('窄工作区为参数换行预留更多历史区域', () => {
    expect(shouldUseCompactGenerationLayout(1100, 1000)).toBe(true)
    expect(shouldUseCompactGenerationLayout(1100, 1100)).toBe(false)
  })
})
