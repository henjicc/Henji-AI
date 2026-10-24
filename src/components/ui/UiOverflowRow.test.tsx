/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UiOverflowRow } from './UiOverflowRow'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('父组件以相同项重渲染（新数组）时不重新读取布局；项集合变化才重测', () => {
  const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
  const items = (ids: string[]) => ids.map((id, index) => ({ id, priority: index, node: <span>{id}</span> }))
  const view = render(<UiOverflowRow items={items(['a', 'b'])} renderOverflow={() => null} />)
  const afterMount = measure.mock.calls.length
  expect(afterMount).toBeGreaterThan(0)
  for (let frame = 0; frame < 5; frame++) view.rerender(<UiOverflowRow items={items(['a', 'b'])} renderOverflow={() => null} />)
  expect(measure.mock.calls.length).toBe(afterMount)
  view.rerender(<UiOverflowRow items={items(['a', 'b', 'c'])} renderOverflow={() => null} />)
  expect(measure.mock.calls.length).toBeGreaterThan(afterMount)
})

it('growIntoParent：行宽只剩内容宽度时，按父级行的空余宽度决定能放回几项', () => {
  const widthOf = (element: Element): number => {
    if (element.hasAttribute('data-overflow-item') || element.hasAttribute('data-ui-overflow-row')) return 30
    if (element.hasAttribute('data-overflow-menu')) return 24
    return Number(element.getAttribute('data-w') ?? 0)
  }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: widthOf(this), height: 0, x: 0, y: 0, top: 0, left: 0, right: widthOf(this), bottom: 0, toJSON: () => ({}) } as DOMRect
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-ui-overflow-row')) return 30
    return Number(this.getAttribute('data-client-w') ?? 0)
  })
  const items = ['a', 'b', 'c'].map((id, index) => ({ id, priority: 3 - index, node: <span>{id}</span> }))
  const renderRow = (growIntoParent: boolean) => render(
    <div data-client-w="200">
      <UiOverflowRow items={items} growIntoParent={growIntoParent} renderOverflow={() => <span>更多</span>} />
      <span data-w="40" />
    </div>,
  )
  const narrow = renderRow(false)
  expect(narrow.container.querySelectorAll('[data-overflow-item]').length).toBe(0)
  narrow.unmount()
  // 父级 200 − 行 30 − 旁边控件 40 = 130 空余，可用 160，三项（90）都放得下
  const wide = renderRow(true)
  expect(wide.container.querySelectorAll('[data-overflow-item]').length).toBe(3)
})
