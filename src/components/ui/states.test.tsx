/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { UiEmpty, UiError } from './states'

afterEach(cleanup)

describe('UiError（任务 5.8，B-36）', () => {
  it('不传标题时有一行危险色缺省标题“操作未完成”，正文是原因', () => {
    render(<UiError message="磁盘空间不足" />)
    const alert = screen.getByRole('alert')
    const title = alert.firstElementChild as HTMLElement
    expect(title.textContent).toBe('操作未完成')
    expect(title.className).toContain('text-danger-text')
    expect(alert.textContent).toContain('磁盘空间不足')
  })

  it('调用点传了更具体的标题就用调用点的', () => {
    render(<UiError title="节目画面无法显示" message="" />)
    expect(screen.getByRole('alert').textContent).toBe('节目画面无法显示')
  })
})

describe('UiEmpty 节点档（任务 5.8，5.4-36）', () => {
  it('铺满节点内容区，图标为辅助文字色、标题为 12 号次要文字', () => {
    const { container } = render(<UiEmpty size="node" icon={<span data-testid="icon" />} title="等待结果" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('h-full')
    expect(root.className).toContain('w-full')
    expect(screen.getByTestId('icon').parentElement?.className).toContain('text-text3')
    expect(screen.getByText('等待结果').className).toContain('text-xs')
    expect(screen.getByText('等待结果').className).toContain('text-text2')
  })
})
