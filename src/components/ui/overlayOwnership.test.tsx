/** @vitest-environment jsdom */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { isTopmostUiOverlay, UiOverlayLayerProvider, useUiOverlayLayer } from './overlayOwnership'

afterEach(cleanup)

const seen: Record<string, string> = {}

function Layer({ name, open, children }: { name: string; open: boolean; children?: React.ReactNode }): React.ReactElement {
  const layer = useUiOverlayLayer(open)
  seen[name] = layer.id
  return React.createElement('div', layer.layerProps, React.createElement(UiOverlayLayerProvider, { id: layer.id }, children))
}

describe('浮层栈顺序', () => {
  it('父子层在同一次提交里一起打开时，子层仍是栈顶（子层先执行 effect 也不例外）', () => {
    render(React.createElement(Layer, { name: 'parent', open: true },
      React.createElement(Layer, { name: 'child', open: true })))
    expect(isTopmostUiOverlay(seen.child)).toBe(true)
    expect(isTopmostUiOverlay(seen.parent)).toBe(false)
  })

  it('先开父层、后开子层时子层在栈顶；无关的兄弟层按打开顺序', () => {
    const view = render(React.createElement(React.Fragment, null,
      React.createElement(Layer, { name: 'a', open: true }, React.createElement(Layer, { name: 'a1', open: false })),
      React.createElement(Layer, { name: 'b', open: false })))
    view.rerender(React.createElement(React.Fragment, null,
      React.createElement(Layer, { name: 'a', open: true }, React.createElement(Layer, { name: 'a1', open: true })),
      React.createElement(Layer, { name: 'b', open: false })))
    expect(isTopmostUiOverlay(seen.a1)).toBe(true)
    view.rerender(React.createElement(React.Fragment, null,
      React.createElement(Layer, { name: 'a', open: true }, React.createElement(Layer, { name: 'a1', open: true })),
      React.createElement(Layer, { name: 'b', open: true })))
    expect(isTopmostUiOverlay(seen.b)).toBe(true)
  })
})

function ModalLayer({ name, open }: { name: string; open: boolean }): React.ReactElement {
  const layer = useUiOverlayLayer(open, { modal: true })
  seen[name] = layer.id
  return React.createElement('div', layer.layerProps)
}

describe('模态层盖在之前打开的浮层上（5.8）', () => {
  it('浮层打开后才弹出的全局确认框（不是浮层后代）也让浮层让开；先开的弹窗不影响之后打开的浮层', async () => {
    const { hasOpenModalUiOverlayAbove } = await import('./overlayOwnership')
    const view = render(React.createElement(React.Fragment, null,
      React.createElement(Layer, { name: 'panel', open: true }),
      React.createElement(ModalLayer, { name: 'confirm', open: false })))
    expect(hasOpenModalUiOverlayAbove(seen.panel)).toBe(false)
    view.rerender(React.createElement(React.Fragment, null,
      React.createElement(Layer, { name: 'panel', open: true }),
      React.createElement(ModalLayer, { name: 'confirm', open: true })))
    expect(hasOpenModalUiOverlayAbove(seen.panel)).toBe(true)
    view.rerender(React.createElement(React.Fragment, null,
      React.createElement(Layer, { name: 'panel', open: true }),
      React.createElement(ModalLayer, { name: 'confirm', open: false })))
    expect(hasOpenModalUiOverlayAbove(seen.panel)).toBe(false)
    cleanup()
    const later = render(React.createElement(React.Fragment, null,
      React.createElement(ModalLayer, { name: 'dialog', open: true }),
      React.createElement(Layer, { name: 'popover', open: false })))
    later.rerender(React.createElement(React.Fragment, null,
      React.createElement(ModalLayer, { name: 'dialog', open: true }),
      React.createElement(Layer, { name: 'popover', open: true })))
    expect(hasOpenModalUiOverlayAbove(seen.popover)).toBe(false)
  })
})
