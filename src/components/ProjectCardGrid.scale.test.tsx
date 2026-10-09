/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VirtuosoGridMockContext, VirtuosoMockContext } from 'react-virtuoso'
import { ProjectCardGrid } from './ProjectCardGrid'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLElement.prototype.scrollTo = () => undefined
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('项目列表虚拟化', () => {
  it.each(['grid', 'list'] as const)('%s 的 5000 项 DOM 受视口约束，选择和打开仍走稳定 ID', async (layout) => {
    const items = Array.from({ length: 5000 }, (_, index) => ({ id: `project-${index}`, name: `项目${index}` }))
    const toggle = vi.fn(); const onOpen = vi.fn()
    const props = {
      items, layout, onOpen,
      selection: { active: false, count: 0, isSelected: () => false, isAllSelected: false, enter: vi.fn(), exit: vi.fn(), toggle, toggleAll: vi.fn() },
      labels: { open: '打开', more: '操作', selectItem: '选中', deselectItem: '取消选中' },
      columns: { name: '名称', location: '位置', modified: '修改', created: '创建', size: '大小' },
      emptyTitle: '没有项目', showMenu: vi.fn(), showMenuAt: vi.fn(),
    }
    const content = (height: number, active = false) => <VirtuosoGridMockContext.Provider value={{ viewportHeight: height, viewportWidth: 720, itemHeight: 180, itemWidth: 240 }}>
      <VirtuosoMockContext.Provider value={{ viewportHeight: height, itemHeight: 36 }}>
        <ProjectCardGrid {...props} selection={{ ...props.selection, active }} />
      </VirtuosoMockContext.Provider>
    </VirtuosoGridMockContext.Provider>
    const view = render(content(360))
    const count = () => view.container.querySelectorAll('[data-project-id]').length
    await waitFor(() => expect(count()).toBeGreaterThan(0))
    expect(count()).toBeLessThan(50)
    fireEvent.click(view.container.querySelector('[data-project-id="project-0"]')!)
    expect(onOpen).toHaveBeenCalledWith(items[0])
    view.rerender(content(360, true))
    fireEvent.click(view.container.querySelector('[data-project-id="project-0"]')!)
    expect(toggle).toHaveBeenCalledWith('project-0')
    view.rerender(content(720, true))
    await waitFor(() => expect(count()).toBeLessThan(80))
  })
})
