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
