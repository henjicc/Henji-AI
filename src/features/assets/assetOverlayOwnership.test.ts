/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UiOverlayLayerProvider, useUiOverlayLayer } from '@/components/ui/overlayOwnership'
import { hasOpenAssetChildOverlay } from './assetOverlayOwnership'

afterEach(cleanup)

function Layer({ open, panel = false, children }: { open: boolean; panel?: boolean; children?: React.ReactNode }): React.ReactElement {
  const layer = useUiOverlayLayer(open)
  return React.createElement('div', { ...layer.layerProps, ...(panel ? { 'data-asset-floating-panel': '', 'aria-hidden': !open } : {}) },
    React.createElement(UiOverlayLayerProvider, { id: layer.id }, children))
}

describe('资产面板子浮层归属', () => {
  it('只有面板层的后代浮层打开时，Escape 交给子浮层处理', () => {
    const view = render(React.createElement(Layer, { open: true, panel: true },
      React.createElement(Layer, { open: false })))
    expect(hasOpenAssetChildOverlay()).toBe(false)

    view.rerender(React.createElement(Layer, { open: true, panel: true },
      React.createElement(Layer, { open: true })))
    expect(hasOpenAssetChildOverlay()).toBe(true)
  })

  it('浮动面板已收起（仍挂载）时，工作区里打开的下拉也算子浮层，Escape 不关资产视图', () => {
    render(React.createElement(React.Fragment, null,
      React.createElement(Layer, { open: false, panel: true }),
      React.createElement(Layer, { open: true })))
    expect(hasOpenAssetChildOverlay()).toBe(true)
  })
})
