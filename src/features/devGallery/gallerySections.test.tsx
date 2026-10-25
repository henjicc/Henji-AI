/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react'
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
