// @vitest-environment jsdom
import { useRef } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import type { ImageEditorV3Controller } from './types'
import { useImageEditorExplanationV3 } from './useImageEditorExplanationV3'

const adapter = vi.hoisted(() => ({ snapshot: () => ({ session: { state: 'recording' } }), hasPendingPick: vi.fn(() => false), acceptPick: vi.fn(), recordPointer: vi.fn(), pause: vi.fn(async () => {}), detach: vi.fn(async () => {}) }))
const capture = vi.hoisted(() => vi.fn(async () => ({ dataUrl: 'data:image/png;base64,AA==', width: 540, height: 360 })))
vi.mock('../application/imageEditExplanation', () => ({ imageEditExplanation: () => adapter }))
vi.mock('./layerPickingV3', () => ({ pickImageEditorLayerV3: () => 'subject' }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ window: { getContentSize: async () => ({ width: 900, height: 720 }) }, media: { captureApplicationSurface: capture }, imageEditorV3: { ingestSource: async () => ({ resource: { resourceRef: 'sha256:fixture', byteLength: 1 } }) } }) }))
beforeEach(() => { vi.clearAllMocks(); adapter.hasPendingPick.mockReturnValue(false) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const image = createImageEditDocumentV3({ documentId: 'capture-test', width: 600, height: 400 })
const bus = { getSnapshot: () => ({ previewOverrides: {} }) } as unknown as ImageEditCommandBusV3
const controller = { document: image, profile: { id: 'full' } } as unknown as ImageEditorV3Controller
function Host({ ready = true }: { ready?: boolean }): JSX.Element {
  const surface = useRef<HTMLDivElement>(null)
  useImageEditorExplanationV3({ bus, controller, surface, ready, selected: ['subject'], maps: new Map(), layout: { stageWidth: 600, stageHeight: 400, viewportKey: 'fixed', viewport: { width: 600, height: 400, documentX: 0, documentY: 0, zoom: 1, devicePixelRatio: 1, interacting: false } } })
  return <div onPointerDownCapture={event => event.stopPropagation()}><div ref={surface} data-testid="preview" data-preview-output-width="600" data-preview-output-height="400"><div data-testid="private" data-observation-sensitive /></div><div data-testid="outside" /></div>
}
const down = (target: Element): void => { const event = new MouseEvent('pointerdown', { bubbles: true, clientX: 120, clientY: 80 }); fireEvent(target, event) }
it('在 React 工具截断捕获传播前记录真实作品命中，保留原选中集合', () => {
  const view = render(<Host />); down(view.getByTestId('preview'))
  expect(adapter.recordPointer).toHaveBeenCalledWith(expect.objectContaining({ phase: 'down', point: [.2, .2], refs: [expect.objectContaining({ id: expect.stringContaining('subject') })], selectedRefs: [expect.objectContaining({ id: expect.stringContaining('subject') })] }))
})
it('不采集作品区域外、敏感区域或未呈现的作品；卸载移除监听', () => {
  const view = render(<Host />); down(view.getByTestId('outside')); down(view.getByTestId('private')); expect(adapter.recordPointer).not.toHaveBeenCalled()
  view.rerender(<Host ready={false} />); down(view.getByTestId('preview')); expect(adapter.recordPointer).not.toHaveBeenCalled()
  const preview = view.getByTestId('preview'); view.unmount(); down(preview); expect(adapter.detach).toHaveBeenCalledTimes(1); expect(adapter.recordPointer).not.toHaveBeenCalled()
})
it('90% 界面缩放下把作品 CSS 裁切转为窗口 DIP，不带入旁边面板', async () => {
  vi.stubGlobal('innerWidth', 1000); vi.stubGlobal('innerHeight', 800)
  const view = render(<Host />), preview = view.getByTestId('preview')
  vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 80, 600, 400))
  down(preview)
  const input = adapter.recordPointer.mock.calls[0][0] as { capture: () => Promise<{ point: [number, number] }> }
  const result = await input.capture()
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({ rect: { x: 90, y: 72, width: 540, height: 360 } }))
  expect(result.point).toEqual([20 / 600, 0])
})

it('画面点选仅校正指代，不录制指针也不把点击传给编辑工具', () => {
  adapter.hasPendingPick.mockReturnValue(true)
  const view = render(<Host />); down(view.getByTestId('preview'))
  expect(adapter.acceptPick).toHaveBeenCalledWith([.2, .2], expect.arrayContaining([expect.objectContaining({ label: undefined })]), expect.any(Array))
  expect(adapter.recordPointer).not.toHaveBeenCalled()
})

it('浮层遮住作品时不采集带界面的缩略图', async () => {
  const view = render(<Host />), preview = view.getByTestId('preview')
  vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400))
  const panel = document.createElement('div'); panel.dataset.panelPlacement = 'below'; document.body.append(panel)
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(400, 0, 300, 200))
  down(preview)
  const input = adapter.recordPointer.mock.calls[0][0] as { capture: () => Promise<unknown> }
  expect(await input.capture()).toBeNull(); expect(capture).not.toHaveBeenCalled()
  panel.remove()
})
