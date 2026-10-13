// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
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
