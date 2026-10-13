// @vitest-environment jsdom
import React, { useRef } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useCanvasNodeFocusStore, useCanvasNodeFocusTracking } from './useCanvasNodeFocus'
function Subject(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useCanvasNodeFocusTracking(ref)
  return <div ref={ref}><div className="react-flow__node" data-id="a"><div tabIndex={0}>first</div><div tabIndex={0}>second</div></div></div>
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useCanvasNodeFocusStore.getState().setFocusedNodeId(null) })
it('同节点失焦重挂载合帧复核，重新获得焦点和卸载取消旧复核', () => {
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const view = render(<Subject />)
  act(() => view.getByText('first').focus())
  expect(useCanvasNodeFocusStore.getState().focusedNodeId).toBe('a')
  fireEvent.focusOut(view.getByText('first'))
  expect(frames.size).toBe(1)
  act(() => view.getByText('second').focus())
  expect(frames.size).toBe(0)
  expect(useCanvasNodeFocusStore.getState().focusedNodeId).toBe('a')
  fireEvent.focusOut(view.getByText('second'))
  view.unmount()
  expect(frames.size).toBe(0)
})
