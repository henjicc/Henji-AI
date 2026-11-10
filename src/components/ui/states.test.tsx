/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { UiEmpty, UiError } from './states'

afterEach(cleanup)

describe('UiError', () => {
  it('不传标题时有缺省标题“操作未完成”；危险色只给图标，标题是主要文字色', () => {
    render(<UiError message="磁盘空间不足" />)
    const alert = screen.getByRole('alert')
    const title = screen.getByText('操作未完成')
    expect(title.className).toContain('text-text1')
    expect(title.className).not.toContain('danger')
    expect(alert.querySelector('svg')?.getAttribute('class')).toContain('text-danger-text')
    expect(alert.textContent).toContain('磁盘空间不足')
  })

  it('详情默认收起，点开后可见原始信息；非失败语气不报 alert', () => {
    render(<UiError appearance="overlay" tone="warning" title="画面可能不完整" detail="GPU device lost" />)
    const toggle = screen.getByRole('button', { name: '查看详情' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('GPU device lost').closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '收起详情' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').getAttribute('data-ui-error')).toBe('overlay')
  })

  it('调用点传了更具体的标题就用调用点的', () => {
    render(<UiError title="节目画面无法显示" message="" />)
    expect(screen.getByRole('alert').textContent).toBe('节目画面无法显示')
  })
})

describe('UiEmpty 节点档', () => {
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
