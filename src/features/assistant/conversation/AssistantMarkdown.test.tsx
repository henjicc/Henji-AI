/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AssistantMarkdown } from './AssistantMarkdown'

afterEach(cleanup)

describe('AssistantMarkdown', () => {
  it('渲染标题、列表、链接和代码结构', () => {
    render(
      <AssistantMarkdown>{[
        '## 处理结果',
        '',
        '- 原因明确',
        '- [查看帮助](https://example.com/help)',
        '',
        '`错误代码`',
      ].join('\n')}</AssistantMarkdown>
    )

    expect(screen.getByRole('heading', { name: '处理结果' })).toBeTruthy()
    expect(screen.getByRole('list')).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看帮助' }).getAttribute('href')).toBe('https://example.com/help')
    expect(screen.getByText('错误代码').tagName).toBe('CODE')
  })

  it('宽表格使用独立横向滚动容器', () => {
    const rendered = render(
      <AssistantMarkdown>{[
        '| 项目 | 结果 |',
        '|---|---|',
        '| 模型 | 已选择 |',
      ].join('\n')}</AssistantMarkdown>
    )

    const table = screen.getByRole('table')
    const container = rendered.container.querySelector('[data-assistant-markdown-table]')
    expect(container?.contains(table)).toBe(true)
    expect(container?.className).toContain('overflow-x-auto')
  })
})
