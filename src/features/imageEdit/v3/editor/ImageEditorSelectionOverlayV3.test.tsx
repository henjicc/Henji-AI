/** @vitest-environment jsdom */
import '@/tests/imageEditDocumentFixture'
import { fireEvent, render, cleanup, act } from '@testing-library/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { getImageEditorHostProfileV3 } from '../application/imageEditorHostProfiles'
import { useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorSelectionOverlayV3 } from './ImageEditorSelectionOverlayV3'
import type { ImageEditorV3Controller } from './types'
import type { ToolKeyboardBinding, ToolKeyboardHandler } from '../toolFramework/types'
import { appendImageEditSelectionV3 } from '@/core/imageEdit/v3/selection/session'
import { projectImageEditorPreviewDocumentV3 } from '../execution/previewDocumentV3'
import type { SelectionRasterRequestV3 } from '../execution/selectionRaster.worker'

const subjectView = vi.hoisted(() => ({ busy: false, candidates: [], run: vi.fn(async () => undefined) }))
vi.mock('./ImageEditorSubjectContextV3', () => ({ useImageEditorSubjectV3: () => subjectView }))
const repairView = vi.hoisted(() => ({ busy: false, run: vi.fn(async () => undefined) }))
vi.mock('./ImageEditorRepairContextV3', () => ({ useImageEditorRepairV3: () => repairView }))

const rasterize = vi.hoisted(() => vi.fn(async (request: SelectionRasterRequestV3) => new Float32Array(request.region.width * request.region.height)))
vi.mock('../execution/selectionRasterClientV3', () => ({ ImageEditSelectionRasterClientV3: class {
  rasterize = rasterize
  dispose() {}
} }))
beforeEach(() => { rasterize.mockClear(); repairView.busy = false; repairView.run.mockClear(); subjectView.busy = false; subjectView.run.mockClear(); useImageEditorSessionStoreV3.setState({ sessions: {} }); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function setup(tool: 'select-rect' | 'select-polygon' | 'select-brush' | 'remove' | 'repair' | 'select-subject' | 'select-subject-box') {
  const document = createImageEditDocumentV3({ width: 32, height: 16, documentId: 'selection-gesture' })
  document.layers = [createImageEditRasterLayerV3('r', '原图')]
  const bus = new ImageEditCommandBusV3(document)
  useImageEditorSessionStoreV3.getState().ensureSession('test-selection', [tool], 'r', tool)
  function Editor() {
    const keyboard = useRef<ToolKeyboardHandler>()
    const bindKeyboard = useCallback<ToolKeyboardBinding>((_slot, handler) => { keyboard.current = handler; return () => { keyboard.current = undefined } }, [])
    const [snapshot, setSnapshot] = useState(bus.getSnapshot())
    useEffect(() => bus.subscribe(() => setSnapshot(bus.getSnapshot())), [])
    const controller = { sessionId: 'test-selection', document: snapshot.document, profile: getImageEditorHostProfileV3('full') } as ImageEditorV3Controller
    return <div data-image-editor-v3 onKeyDown={event => keyboard.current?.(event.nativeEvent)}><ImageEditorSelectionOverlayV3 controller={controller} bus={bus} bindKeyboard={bindKeyboard} projectedDocument={projectImageEditorPreviewDocumentV3(snapshot)} /></div>
  }
  const result = render(<Editor />), overlay = result.container.querySelector('svg')!
  vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 160, width: 320, height: 160, toJSON: () => ({}) })
  return { bus, overlay, root: result.container.firstElementChild! }
}
it('尺寸预览按新网格显示映射选区，取消恢复原稿与临时选区且不写历史', async () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  const { bus, overlay } = setup('select-rect')
  const original = appendImageEditSelectionV3(null, { type: 'rectangle', x: .25, y: 0, width: .5, height: 1 }, 'replace')
  await act(async () => { bus.setSelection(original) })
  const document = bus.getSnapshot().document, history = bus.getSnapshot().history.undoCount
  const mapped = appendImageEditSelectionV3(null, { type: 'rectangle', x: .625, y: 0, width: .25, height: 1 }, 'replace')
  await act(async () => { bus.setPreview({ id: 'document-geometry', kind: 'document-geometry', targetId: document.id,
    baseRevision: document.revision, value: { ...document, geometry: { ...document.geometry, width: 64 } }, selectionPreview: mapped }) })
  expect(overlay.getAttribute('viewBox')).toBe('0 0 64 16')
  expect(rasterize).toHaveBeenLastCalledWith(expect.objectContaining({ selection: mapped, size: { width: 64, height: 16 } }), expect.any(AbortSignal))
  expect(bus.getSnapshot().document).toBe(document); expect(bus.getSnapshot().selection).toEqual(original)
  await act(async () => { bus.clearPreview('document-geometry') })
  expect(overlay.getAttribute('viewBox')).toBe('0 0 32 16')
  expect(rasterize).toHaveBeenLastCalledWith(expect.objectContaining({ selection: original, size: { width: 32, height: 16 } }), expect.any(AbortSignal))
  expect(bus.getSnapshot().history.undoCount).toBe(history); bus.dispose()
})
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
it('移除画笔松手调用同源作业，取消笔迹不调用且不污染独立选区历史', () => {
  const { bus, overlay } = setup('remove')
  fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 80, clientY: 40 })
  fireEvent.pointerCancel(overlay, { pointerId: 1 }); expect(repairView.run).not.toHaveBeenCalled()
  fireEvent.pointerDown(overlay, { button: 0, pointerId: 2, clientX: 80, clientY: 40 })
  fireEvent.pointerUp(overlay, { pointerId: 2, clientX: 160, clientY: 80 })
  expect(repairView.run).toHaveBeenCalledWith(expect.objectContaining({ action: 'remove', selection: expect.objectContaining({ operations: expect.any(Array) }) }))
  expect(bus.getSnapshot().selection).toBeNull(); expect(bus.getSnapshot().history.undoCount).toBe(0); bus.dispose()
})
it('修补要求既有选区，拖动到来源仅传比例偏移，不改变选区', () => {
  const { bus, overlay } = setup('repair')
  fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 80, clientY: 40 })
  fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 240, clientY: 120 }); expect(repairView.run).not.toHaveBeenCalled()
  const selection = appendImageEditSelectionV3(null, { type: 'rectangle', x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 'replace')
  act(() => bus.setSelection(selection))
  fireEvent.pointerDown(overlay, { button: 0, pointerId: 2, clientX: 80, clientY: 40 })
  fireEvent.pointerUp(overlay, { pointerId: 2, clientX: 240, clientY: 120 })
  expect(repairView.run).toHaveBeenCalledWith({ action: 'repair', sourceOffset: { x: 0.5, y: 0.5 } })
  expect(bus.getSnapshot().selection).toEqual(selection); bus.dispose()
})

it('主体点选与框选只向同源作业传画面比例，取消手势不写选区', () => {
  const point = setup('select-subject')
  fireEvent.pointerDown(point.overlay, { button: 0, pointerId: 1, clientX: 80, clientY: 40 })
  fireEvent.pointerUp(point.overlay, { pointerId: 1, clientX: 80, clientY: 40 })
  expect(subjectView.run).toHaveBeenCalledWith({ kind: 'point', points: [{ x: 0.25, y: 0.25, foreground: true }] })
  expect(point.bus.getSnapshot().selection).toBeNull(); point.bus.dispose(); cleanup()
  const box = setup('select-subject-box')
  fireEvent.pointerDown(box.overlay, { button: 0, pointerId: 2, clientX: 240, clientY: 120 })
  fireEvent.pointerUp(box.overlay, { pointerId: 2, clientX: 80, clientY: 40 })
  expect(subjectView.run).toHaveBeenLastCalledWith({ kind: 'box', x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
  subjectView.run.mockClear()
  fireEvent.pointerDown(box.overlay, { button: 0, pointerId: 3, clientX: 80, clientY: 40 })
  fireEvent.pointerCancel(box.overlay, { pointerId: 3 })
  expect(subjectView.run).not.toHaveBeenCalled(); expect(box.bus.getSnapshot().history.undoCount).toBe(0); box.bus.dispose()
})
