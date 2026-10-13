/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { FormSection } from './gallerySections'

afterEach(cleanup)

it('表单样本由外层管理组间距，不再叠加相邻 UiGroup 的分区留白', () => {
  const view = render(<FormSection />)
  const toggle = view.getByRole('switch', { name: '快速下载' })
  expect(toggle.closest('[data-ui-group]')?.contains(view.getByRole('textbox', { name: '语言' }))).toBe(true)
  const compact = view.getByText('紧凑分组').closest('[data-ui-group]')
  expect(Boolean(compact?.previousElementSibling?.matches('[data-ui-group]'))).toBe(false)
  expect(view.container.querySelectorAll('[data-ui-group] + [data-ui-group]')).toHaveLength(0)
})

it('调色样本以百分比传入恒等曲线与色轮强度，并按同一单位接收编辑', () => {
  const view = render(<FormSection />)
  const plot = view.getByLabelText('RGB 曲线')
  expect([...plot.querySelectorAll('circle')].map(point => [point.getAttribute('cx'), point.getAttribute('cy')])).toEqual([
    ['0', '100'], ['25', '75'], ['50', '50'], ['75', '25'], ['100', '0'],
  ])
  const samples = plot.querySelector('polyline')?.getAttribute('points')?.split(' ').map(point => point.split(',').map(Number))
  expect(samples?.every(([x, y]) => Math.abs(x + y - 100) < 0.000001)).toBe(true)
  const grading = view.getByText('调色控件').closest('[data-ui-group]') as HTMLElement
  expect(within(grading).getByRole('slider', { name: '中间调' }).getAttribute('aria-valuenow')).toBe('40')
  const middle = view.getByRole('slider', { name: 'RGB 曲线 · 输入 50%' })
  fireEvent.keyDown(middle, { key: 'ArrowUp' })
  expect(middle.getAttribute('aria-valuenow')).toBe('51')
  expect(middle.getAttribute('cy')).toBe('49')
})
