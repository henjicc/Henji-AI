/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UiIconButton } from './primitives'
import Tooltip from './Tooltip'

describe('Tooltip', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('工具栏模式让提示框左上角跟随指针，不再向左居中溢出', () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="较长的工具名称" delay={180} anchor="pointer-start">
        <UiIconButton aria-label="工具" />
      </Tooltip>,
    )
    const button = screen.getByRole('button', { name: '工具' })
    fireEvent.mouseEnter(button, { clientX: 24, clientY: 120 })
    act(() => vi.advanceTimersByTime(180))
    const tooltip = screen.getByRole('tooltip', { hidden: true })
    expect(tooltip.getAttribute('style')).toContain('top: 128px')
    expect(tooltip.getAttribute('style')).toContain('left: 32px')
    expect(tooltip.className).not.toContain('-translate-x-1/2')
  })
})
