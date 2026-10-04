/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UiOverlayLayerProvider, useUiOverlayLayer } from '@/components/ui/overlayOwnership'
import { hasOpenAssetChildOverlay } from './assetOverlayOwnership'

afterEach(cleanup)

function Layer({ open, panel = false, children }: { open: boolean; panel?: boolean; children?: React.ReactNode }): React.ReactElement {
  const layer = useUiOverlayLayer(open)
  return React.createElement('div', { ...layer.layerProps, ...(panel ? { 'data-asset-floating-panel': '' } : {}) },
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
})
