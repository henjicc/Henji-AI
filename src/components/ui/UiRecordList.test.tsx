/** @vitest-environment jsdom */
import { createRef } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { UiRecordItem, UiRecordList } from './UiRecordList'

afterEach(cleanup)
it('虚拟窗口从中间开始时仍按完整索引画分隔，测量 ref 指向含留白的记录根节点', () => {
  const ref = createRef<HTMLDivElement>()
  const view = render(<UiRecordList><UiRecordItem ref={ref} index={25} title="记录" meta={['今天', '图片']} status={<span>失败</span>} actions={<span>重试</span>}>结果</UiRecordItem></UiRecordList>)
  expect(ref.current?.getAttribute('data-ui-record-divider')).toBe('true')
  expect(ref.current?.textContent).toBe('记录今天 · 图片结果失败重试')
  view.rerender(<UiRecordList><UiRecordItem index={0} title="记录">结果</UiRecordItem></UiRecordList>)
  expect(screen.getByRole('listitem').getAttribute('data-ui-record-divider')).toBe('false')
})
