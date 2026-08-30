// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalRedrawSettingsRows } from './LocalRedrawSettingsRows'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

describe('局部重绘节点设置行', () => {
  it('展示全部本地裁剪、对齐与遮罩设置，并可切换对齐档位', () => {
    const onChange = vi.fn()
    render(
      <LocalRedrawSettingsRows
        nodeId="local-redraw"
        settings={{
          contextScale: 2,
          aspectRatio: 'auto',
          registrationQuality: 'precise',
          featherPixels: 12,
          forceRegistration: false,
        }}
        onChange={onChange}
      />,
    )

    expect(screen.getByText(/上下文范围|Context range/)).toBeTruthy()
    expect(screen.getByText(/裁剪比例|Crop ratio/)).toBeTruthy()
    expect(screen.getByText(/对齐精度|Alignment quality/)).toBeTruthy()
    expect(screen.getByText(/遮罩羽化|Mask feather/)).toBeTruthy()
    expect(screen.getByText(/强制对齐|Force alignment/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /精细|Precise/ }))
    fireEvent.click(screen.getByRole('option', { name: /极致|Extreme/ }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ registrationQuality: 'extreme' }))
  })
})
