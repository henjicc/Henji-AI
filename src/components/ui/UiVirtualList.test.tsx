// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { VirtuosoMockContext } from 'react-virtuoso'
import { UiVirtualList, UiVirtualGrid } from './UiVirtualList'
afterEach(cleanup)
const data = Array.from({ length: 1000 }, (_, id) => ({ id, label: `record-${id}` }))
it('共享列表和可变行高网格只挂载窗口，结果缩减/空态/两三列切换正确', () => {
  const select = vi.fn()
  const content = (items = data, columns: 2 | 3 = 2) => <VirtuosoMockContext.Provider value={{ viewportHeight: 240, itemHeight: 60 }}><UiVirtualGrid data={items} columns={columns} getKey={item => item.id} renderItem={item => <div onClick={() => select(item.id)}>{item.label}</div>} emptyState={<span>empty</span>} /></VirtuosoMockContext.Provider>
  const view = render(content())
  expect(view.getAllByText(/^record-/).length).toBeLessThan(50)
  view.rerender(content([data[999]], 3))
  fireEvent.click(view.getByText('record-999'))
  expect(select).toHaveBeenCalledWith(999)
  view.rerender(content([]))
  expect(view.getByText('empty')).toBeTruthy()
  view.rerender(<VirtuosoMockContext.Provider value={{ viewportHeight: 240, itemHeight: 60 }}><UiVirtualList data={data} getKey={item => item.id} renderItem={item => <div>{item.label}</div>} /></VirtuosoMockContext.Provider>)
  expect(view.getAllByText(/^record-/).length).toBeLessThan(50)
})

it('容器高度随内容（浮层）时按列表总高度自撑并封顶；容器有确定高度时铺满', () => {
  const list = <VirtuosoMockContext.Provider value={{ viewportHeight: 240, itemHeight: 60 }}><UiVirtualList data={data} getKey={item => item.id} renderItem={item => <div>{item.label}</div>} /></VirtuosoMockContext.Provider>
  // jsdom 没有布局：模拟“已经显示、但高度为 0”，等同浮层里高度随内容的容器
  const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 0)] as unknown as DOMRectList)
  const auto = render(list)
  const autoBox = auto.container.firstElementChild as HTMLElement
  expect(autoBox.className).toContain('max-h-virtual-list')
  expect(autoBox.style.height).not.toBe('')
  auto.unmount()
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  const fixed = render(list)
  const fixedBox = fixed.container.firstElementChild as HTMLElement
  expect(fixedBox.className).toContain('h-full')
  expect(fixedBox.style.height).toBe('')
  height.mockRestore()
  fixed.unmount()
  // 挂在隐藏的工作区里（没有布局）时不下结论，先按铺满排；显示出来后再判断
  // 虚拟列表内部也用 ResizeObserver，按观察的元素记下回调
  const observed = new Map<Element, () => void>()
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: () => void) {}
    observe(target: Element): void { observed.set(target, this.callback) }
    unobserve(): void {}
    disconnect(): void {}
  })
  rects.mockReturnValue([] as unknown as DOMRectList)
  const hidden = render(list)
  const hiddenBox = hidden.container.firstElementChild as HTMLElement
  expect(hiddenBox.className).toContain('h-full')
  rects.mockReturnValue([new DOMRect(0, 0, 100, 0)] as unknown as DOMRectList)
  act(() => observed.get(hiddenBox)?.())
  expect((hidden.container.firstElementChild as HTMLElement).className).toContain('max-h-virtual-list')
  rects.mockRestore()
  vi.unstubAllGlobals()
})
