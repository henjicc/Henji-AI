/** @vitest-environment jsdom */
import '@/tests/imageEditDocumentFixture'
import { fireEvent, render, cleanup, act } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { getImageEditorHostProfileV3 } from '../application/imageEditorHostProfiles'
import { useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorSelectionOverlayV3 } from './ImageEditorSelectionOverlayV3'
import type { ImageEditorV3Controller } from './types'

vi.mock('../execution/selectionRasterClientV3', () => ({ ImageEditSelectionRasterClientV3: class {
  async rasterize() { return new Float32Array(32 * 16) }
  dispose() {}
} }))
beforeEach(() => { useImageEditorSessionStoreV3.setState({ sessions: {} }); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function setup(tool: 'select-rect' | 'select-polygon' | 'select-brush') {
  const document = createImageEditDocumentV3({ width: 32, height: 16, documentId: 'selection-gesture' })
  document.layers = [createImageEditRasterLayerV3('r', '原图')]
  const bus = new ImageEditCommandBusV3(document)
  useImageEditorSessionStoreV3.getState().ensureSession('test-selection', [tool], 'r', tool)
  function Editor() {
    const [snapshot, setSnapshot] = useState(bus.getSnapshot())
    useEffect(() => bus.subscribe(() => setSnapshot(bus.getSnapshot())), [])
    const controller = { sessionId: 'test-selection', document: snapshot.document, profile: getImageEditorHostProfileV3('full') } as ImageEditorV3Controller
    return <div data-image-editor-v3><ImageEditorSelectionOverlayV3 controller={controller} bus={bus} /></div>
  }
  const result = render(<Editor />), overlay = result.container.querySelector('svg')!
  vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 160, width: 320, height: 160, toJSON: () => ({}) })
  return { bus, overlay, root: result.container.firstElementChild! }
}
it('框选只在抬手提交比例坐标，作品和原蒙版不变；一个手势一次撤销', () => {
  const { bus, overlay } = setup('select-rect')
  fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 80, clientY: 40 })
  expect(bus.getSnapshot().selection).toBeNull()
  fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 240, clientY: 120 })
  expect(bus.getSnapshot().selection?.operations[0].shape).toEqual({ type: 'rectangle', x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
  expect(bus.getSnapshot().document.layers[0].mask).toBeNull(); expect(bus.getSnapshot().document.revision).toBe(0)
  expect(bus.getSnapshot().history.undoCount).toBe(1)
  act(() => { bus.undo() }); expect(bus.getSnapshot().selection).toBeNull()
  bus.dispose()
})
it('多边形单击添点、回车闭合；画笔取消指针不产生历史', () => {
  const polygon = setup('select-polygon')
  for (const [clientX, clientY] of [[80, 40], [240, 40], [160, 120]]) fireEvent.pointerDown(polygon.overlay, { button: 0, clientX, clientY })
  expect(polygon.bus.getSnapshot().selection).toBeNull()
  fireEvent.keyDown(polygon.root, { key: 'Enter' })
  expect(polygon.bus.getSnapshot().selection?.operations[0].shape.type).toBe('lasso')
  polygon.bus.dispose(); cleanup()
  const brush = setup('select-brush')
  fireEvent.pointerDown(brush.overlay, { button: 0, pointerId: 4, clientX: 100, clientY: 100 })
  fireEvent.pointerCancel(brush.overlay, { pointerId: 4 })
  expect(brush.bus.getSnapshot().selection).toBeNull(); expect(brush.bus.getSnapshot().history.undoCount).toBe(0)
  brush.bus.dispose()
})
