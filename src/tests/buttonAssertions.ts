import { fireEvent } from '@testing-library/react'
import { expect } from 'vitest'

/** 共享按钮以 aria-disabled 表达不可用；有说明时保留焦点并取消点击。 */
export function expectButtonDisabled(button: HTMLElement): void {
  // 未提供反馈说明的原生禁用控件仍采用 disabled（例如开关和空态动作）。
  if (button.matches(':disabled')) {
    expect(button).toHaveProperty('disabled', true)
    return
  }
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(fireEvent.click(button)).toBe(false)
}

/** 等待可操作状态时同时检查原生和 ARIA，避免把可聚焦的阻断按钮误认成已就绪。 */
export function expectButtonEnabled(button: HTMLElement): void {
  expect(button.matches(':disabled')).toBe(false)
  expect(button.getAttribute('aria-disabled')).not.toBe('true')
}
