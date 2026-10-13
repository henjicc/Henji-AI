// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UiVirtualList, UiVirtualGrid } from './UiVirtualList'
const mocks = vi.hoisted(() => ({ reveal: vi.fn() }))
vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef((_props, ref) => { React.useImperativeHandle(ref, () => ({ scrollIntoView: mocks.reveal })); return null }) }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('未挂载高亮项委托虚拟器显露，网格把项索引转换成行索引', () => {
  const data = Array.from({ length: 1000 }, (_, id) => ({ id }))
  const props = { data, getKey: (item: { id: number }) => item.id, renderItem: () => null }
  const view = render(<UiVirtualList {...props} highlightedIndex={500} />)
  expect(mocks.reveal).toHaveBeenLastCalledWith({ index: 500, behavior: 'auto' })
  view.rerender(<UiVirtualGrid {...props} columns={3} highlightedIndex={500} />)
  expect(mocks.reveal).toHaveBeenLastCalledWith({ index: 166, behavior: 'auto' })
  mocks.reveal.mockClear()
  view.rerender(<UiVirtualList {...props} highlightedIndex={1000} />)
  expect(mocks.reveal).not.toHaveBeenCalled()
})
