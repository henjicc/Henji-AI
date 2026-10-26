// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UiActionGroup, UiToolbar } from './layout'
import { UiButton } from './primitives'
afterEach(cleanup)

describe('动作组与表面预算', () => {
  it('嵌套按钮继承组档位和尺寸，显式冲突告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<UiActionGroup tier="secondary" size="sm"><div><UiButton>打开</UiButton></div><UiButton variant="quiet">刷新</UiButton></UiActionGroup>)
    expect(screen.getByText('打开').getAttribute('data-variant')).toBe('secondary')
    expect(screen.getByText('打开').getAttribute('data-size')).toBe('sm')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
  it('开了界面开发检查时，只对可见且同一表面的第二个主动作标记，分支切换清理', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    window.history.replaceState(null, '', '/?henjiDevChecks=1')
    const view = render(<UiToolbar variant="command"><UiButton variant="primary">保存</UiButton><UiButton variant="primary">导出</UiButton></UiToolbar>)
    await waitFor(() => expect(screen.getByText('导出').hasAttribute('data-primary-overflow')).toBe(true))
    view.rerender(<UiToolbar variant="command"><UiButton variant="primary">保存</UiButton><div hidden><UiButton variant="primary">导出</UiButton></div></UiToolbar>)
    await waitFor(() => expect(screen.getByText('导出').hasAttribute('data-primary-overflow')).toBe(false))
    window.history.replaceState(null, '', '/')
    warn.mockRestore()
  })
  it('默认开发运行不跑主动作预算检查', () => {
    render(<UiToolbar variant="command"><UiButton variant="primary">保存</UiButton><UiButton variant="primary">导出</UiButton></UiToolbar>)
    expect(screen.getByText('导出').hasAttribute('data-primary-overflow')).toBe(false)
  })
})
