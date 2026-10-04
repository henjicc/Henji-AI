// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EdgeDisconnectButton } from './EdgeDisconnectButton'

describe('EdgeDisconnectButton', () => {
  it('随主题的玻璃包静默危险图标按钮，点击断开且不冒泡到画布', () => {
    const onDisconnect = vi.fn()
    const onPaneClick = vi.fn()
    const { getByRole } = render(
      <div onClick={onPaneClick}>
        <EdgeDisconnectButton label="断开连线" onDisconnect={onDisconnect} />
      </div>,
    )
    const button = getByRole('button', { name: '断开连线' })
    expect(button.closest('.ui-glass')).not.toBeNull()
    // 画布底随主题：不用固定深色的媒体叠层档
    expect(button.className).not.toContain('ui-btn-media')
    fireEvent.click(button)
    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(onPaneClick).not.toHaveBeenCalled()
  })
})
