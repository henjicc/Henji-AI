/** @vitest-environment jsdom */
import { createRef } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { UiFormRow, UiGroup } from './layout'
import { UiInput, UiSelect, UiTextArea } from './primitives'
import { VideoEditExportField } from '@/features/videoEdit/panels/VideoEditExportFields'

afterEach(cleanup)

it('面板继承列宽，普通表单保持纵向，显式 auto 可退出面板布局', () => {
  render(<><UiGroup labelWidth={96}><UiGroup><UiFormRow label="面板"><UiInput /></UiFormRow></UiGroup>
    <UiFormRow label="长文" labelColumn="auto"><UiTextArea /></UiFormRow></UiGroup>
    <UiGroup><UiFormRow label="表单"><UiInput /></UiFormRow></UiGroup></>)
  expect(screen.getByRole('textbox', { name: '面板' }).closest('[data-ui-form-row="panel"]')?.getAttribute('data-label-width')).toBe('96')
  expect(screen.getByRole('textbox', { name: '长文' }).closest('[data-ui-form-row="panel"]')).toBeNull()
  expect(screen.getByRole('textbox', { name: '表单' }).closest('[data-ui-form-row="panel"]')).toBeNull()
})

it('导出字段继承面板列宽，锁定动作不占控件填充列，无锁行保留尾槽', () => {
  render(<UiGroup labelWidth={72}>
    <VideoEditExportField label="帧率" lock={<span>锁定</span>}><UiInput /></VideoEditExportField>
    <VideoEditExportField label="画幅"><UiInput /></VideoEditExportField>
  </UiGroup>)
  const input = screen.getByRole('textbox', { name: '帧率' })
  expect(input.closest('[data-ui-form-control]')?.textContent).not.toContain('锁定')
  expect(screen.getByText('锁定').closest('[data-ui-form-trailing]')).not.toBeNull()
  expect(document.querySelectorAll('[data-ui-form-trailing]')).toHaveLength(2)
  expect(input.closest('[data-ui-form-row]')?.className).not.toContain('!grid')
})

it('统一文本域和选择框 ref 指向实际可聚焦控件', () => {
  const text = createRef<HTMLTextAreaElement>()
  const select = createRef<HTMLSelectElement>()
  render(<><UiTextArea ref={text} aria-label="正文" /><UiSelect ref={select} aria-label="格式"><option>PNG</option></UiSelect></>)
  expect(text.current).toBe(screen.getByRole('textbox'))
  expect(select.current).toBe(screen.getByRole('combobox'))
  text.current?.focus()
  expect(document.activeElement).toBe(text.current)
})
