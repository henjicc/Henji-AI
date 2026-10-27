// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EdgeDisconnectButton } from './EdgeDisconnectButton'

describe('EdgeDisconnectButton', () => {
  it('点击断开且不冒泡到画布', () => {
    const onDisconnect = vi.fn()
    const onPaneClick = vi.fn()
    const { getByRole } = render(
      <div onClick={onPaneClick}>
        <EdgeDisconnectButton label="断开连线" onDisconnect={onDisconnect} />
      </div>,
    )
    const button = getByRole('button', { name: '断开连线' })
    fireEvent.click(button)
    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(onPaneClick).not.toHaveBeenCalled()
  })
})
