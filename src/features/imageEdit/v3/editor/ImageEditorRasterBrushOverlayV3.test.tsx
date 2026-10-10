/** @vitest-environment jsdom */

import '@/tests/imageEditDocumentFixture'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import i18n from '@/i18n/config'
import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorV3 } from './ImageEditorV3'

const bridge = vi.hoisted(() => ({ persistBrushTiles: vi.fn() }))

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function installPointerCapture(overlay: SVGSVGElement) {
  const captured = new Set<number>()
  const setPointerCapture = vi.fn((pointerId: number) => { captured.add(pointerId) })
  const releasePointerCapture = vi.fn((pointerId: number) => { captured.delete(pointerId) })
  Object.defineProperties(overlay, {
    hasPointerCapture: { configurable: true, value: (pointerId: number) => captured.has(pointerId) },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
    setPointerCapture: { configurable: true, value: setPointerCapture },
  })
  return { releasePointerCapture, setPointerCapture }
}

vi.mock('@/commands/imageEditorV3', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/commands/imageEditorV3')>()
  return { ...original, persistImageEditorV3BrushTiles: bridge.persistBrushTiles }
})

vi.mock('../tools/paint/workerClient', async () => {
  const { rasterizePaintDabs, rasterizePaintFill } = await import('@/core/imaging/paint');
  const { rasterizeRetouchDabs } = await import('@/core/imaging/retouch');
  return { PaintWorkerClient: class {
    rasterize = async (...args: Parameters<typeof rasterizePaintDabs>) => rasterizePaintDabs(...args);
    fill = async (...args: Parameters<typeof rasterizePaintFill>) => rasterizePaintFill(...args);
    retouch = async (...args: Parameters<typeof rasterizeRetouchDabs>) => rasterizeRetouchDabs(...args);
    dispose(): void {}
  } };
});

class ImageDataStub {
  readonly colorSpace = 'srgb'
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

function ControlledRasterEditor({
  onDocumentChange,
  onPersistenceChange,
  profileId = 'mask',
}: {
  onDocumentChange: (document: ImageEditDocumentV3) => void
  onPersistenceChange: () => void
  profileId?: 'full' | 'canvas-edit' | 'mask'
}): JSX.Element {
  const initial = createImageEditDocumentV3({ width: 64, height: 64, documentId: 'brush-ui' })
  initial.layers = [createImageEditRasterLayerV3('raster', '可绘制图层')]
  const [layoutWorkspaceId] = useState(() => `test-brush-${crypto.randomUUID()}`)
  const [document, setDocument] = useState(initial)
  return (
    <div style={{ width: 600, height: 500 }}>
      <ImageEditorV3
        sourceImageUrl="preview.png"
        document={document}
        profileId={profileId}
        layoutWorkspaceId={layoutWorkspaceId}
        onDocumentChange={(next) => {
          onDocumentChange(next)
          setDocument(next)
        }}
        onPersistenceChange={onPersistenceChange}
        previewRenderer={() => ({
          kind: 'content',
          content: <div data-testid="brush-preview" style={{ width: 320, height: 320 }} />,
        })}
      />
    </div>
  )
}

describe('ImageEditorRasterBrushOverlayV3', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useImageEditorSessionStoreV3.setState({ sessions: {} })
    useImageEditorInteractionStoreV3.setState({
      layerDragBySession: {},
      viewportZoomBySession: {},
      viewportPanBySession: {},
      annotationSelectionBySession: {},
      annotationPreviewBySession: {},
    })
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 500))
    vi.stubGlobal('ImageData', ImageDataStub)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: vi.fn(() => ({ width: 0 })),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    bridge.persistBrushTiles.mockReset().mockImplementation(async ({ tiles }) => ({
      tiles: tiles.map((tile: { tileKey: string }) => ({
        tileKey: tile.tileKey,
        resourceId: `sha256:${'f'.repeat(64)}`,
        byteSize: 96,
      })),
    }))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('图章 UI Alt 取样不提交，对齐跨笔保留偏移，不对齐每笔回到供体，取消释放手势', async () => {
    const rendered = render(<ControlledRasterEditor profileId="full" onDocumentChange={() => undefined} onPersistenceChange={() => undefined} />)
    await screen.findByRole('button', { name: '修饰' })
    const sessionId = Object.keys(useImageEditorSessionStoreV3.getState().sessions)[0]
    act(() => useImageEditorSessionStoreV3.getState().setActiveTool(sessionId, 'clone-stamp'))
    const overlay = rendered.container.querySelector('[data-raster-brush-overlay]') as SVGSVGElement
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 320, 320))
    const capture = installPointerCapture(overlay)
    const session = () => Object.values(useImageEditorSessionStoreV3.getState().sessions)[0]
    fireEvent.pointerDown(overlay, { button: 0, clientX: 80, clientY: 80, pointerId: 1 })
    expect(screen.getByText('请先 Alt 点击干净来源，或点取样后在画面中选择来源')).toBeTruthy()
    fireEvent.pointerUp(overlay, { clientX: 80, clientY: 80, pointerId: 1 })
    const sampleEvent = new MouseEvent('pointerdown', { bubbles: true, button: 0, altKey: true, clientX: 80, clientY: 80 })
    Object.defineProperties(sampleEvent, { pointerId: { value: 2 }, pointerType: { value: 'mouse' } })
    fireEvent(overlay, sampleEvent)
    fireEvent.pointerUp(overlay, { clientX: 80, clientY: 80, pointerId: 2 })
    expect(session().toolSettings.retouchSource).toMatchObject({ documentId: 'brush-ui', layerId: 'raster', x: 16, y: 16 })
    expect(capture.setPointerCapture).not.toHaveBeenCalled(); expect(bridge.persistBrushTiles).not.toHaveBeenCalled()
    const stroke = async (x: number, id: number, expected: number) => {
      fireEvent.pointerDown(overlay, { button: 0, clientX: x, clientY: 80, pointerId: id })
      expect(session().toolSettings.retouchOffset?.x).toBe(expected)
      fireEvent.pointerUp(overlay, { clientX: x, clientY: 80, pointerId: id })
      await waitFor(() => expect(capture.releasePointerCapture).toHaveBeenCalledWith(id))
    }
    await stroke(240, 3, -32); await stroke(160, 4, -32)
    fireEvent.click(screen.getByRole('switch', { name: '对齐供体' }))
    await stroke(160, 5, -16); await stroke(200, 6, -24)
    fireEvent.pointerDown(overlay, { button: 0, clientX: 160, clientY: 80, pointerId: 7 })
    fireEvent.pointerCancel(overlay, { pointerId: 7 }); expect(capture.releasePointerCapture).toHaveBeenCalledWith(7)
    expect(bridge.persistBrushTiles).not.toHaveBeenCalled()
  })

  it.each(['mask', 'full', 'canvas-edit'] as const)('%s pointer 手势先显示 dirty tile，抬笔后只持久化一次且撤销重做恢复引用', async (profileId) => {
    const changes: ImageEditDocumentV3[] = []
    const persistentChanges = vi.fn()
    const rendered = render(
      <ControlledRasterEditor
        profileId={profileId}
        onDocumentChange={(document) => changes.push(document)}
        onPersistenceChange={persistentChanges}
      />,
    )
    const tool = await screen.findByRole('button', { name: '栅格画笔' })
    expect((tool as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(tool)
    const overlay = await waitFor(() => (
      rendered.container.querySelector('[data-raster-brush-overlay]') as SVGSVGElement
    ))
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: 320,
      width: 320,
      height: 320,
      toJSON: () => ({}),
    })
    const pointerCapture = installPointerCapture(overlay)

    fireEvent.pointerDown(overlay, { button: 0, clientX: 80, clientY: 80, pointerId: 7 })
    expect(pointerCapture.setPointerCapture).toHaveBeenCalledWith(7)
    await waitFor(() => expect(
      rendered.container.querySelectorAll('foreignObject'),
    ).toHaveLength(1))
    expect(rendered.container.querySelector('foreignObject canvas')?.className).not.toContain('bg-gap')
    expect(persistentChanges).not.toHaveBeenCalled()

    fireEvent.pointerUp(overlay, { clientX: 96, clientY: 80, pointerId: 7 })
    await waitFor(() => expect(bridge.persistBrushTiles).toHaveBeenCalledOnce())
    await waitFor(() => expect(changes.at(-1)?.revision).toBe(1))
    await waitFor(() => expect(
      rendered.container.querySelectorAll('foreignObject'),
    ).toHaveLength(0))
    expect(pointerCapture.releasePointerCapture).toHaveBeenCalledWith(7)
    expect(persistentChanges).toHaveBeenCalledOnce()
    expect(changes.at(-1)?.layers[0]).toMatchObject({
      tiles: { '0/0/0': `sha256:${'f'.repeat(64)}` },
    })

    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(changes.at(-1)?.layers[0]).toMatchObject({ tiles: {} }))
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    await waitFor(() => expect(changes.at(-1)?.layers[0]).toMatchObject({
      tiles: { '0/0/0': `sha256:${'f'.repeat(64)}` },
    }))
  })

  it('蒙版工具把一次 pointer 手势提交为一条稀疏 mask-float32 瓦片历史', async () => {
    const changes: ImageEditDocumentV3[] = []
    const persistentChanges = vi.fn()
    const rendered = render(
      <ControlledRasterEditor
        onDocumentChange={(document) => changes.push(document)}
        onPersistenceChange={persistentChanges}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: '添加蒙版' }))
    await waitFor(() => expect(changes.at(-1)?.layers[0].mask).toMatchObject({
      kind: 'sparse-mask',
      storage: 'mask-float32',
      tileSize: 512,
      defaultValue: 1,
      tiles: {},
    }))

    fireEvent.click(screen.getByRole('button', { name: '编辑蒙版' }))
    fireEvent.click(screen.getByRole('button', { name: '绘制' }))
    fireEvent.click(screen.getByRole('option', { name: '擦除' }))
    const overlay = await waitFor(() => (
      rendered.container.querySelector('[data-raster-brush-overlay]') as SVGSVGElement
    ))
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: 320,
      width: 320,
      height: 320,
      toJSON: () => ({}),
    })
    installPointerCapture(overlay)
    fireEvent.pointerDown(overlay, { button: 0, clientX: 72, clientY: 72, pointerId: 21 })
    await waitFor(() => expect(
      rendered.container.querySelectorAll('foreignObject'),
    ).toHaveLength(1))
    fireEvent.pointerUp(overlay, { clientX: 88, clientY: 72, pointerId: 21 })

    await waitFor(() => expect(bridge.persistBrushTiles).toHaveBeenCalledOnce())
    await waitFor(() => expect(changes.at(-1)?.revision).toBe(2))
    expect(changes.at(-1)?.layers[0].mask).toMatchObject({
      kind: 'sparse-mask',
      tiles: { '0/0/0': `sha256:${'f'.repeat(64)}` },
    })
    expect(persistentChanges).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(changes.at(-1)?.layers[0].mask).toMatchObject({
      kind: 'sparse-mask',
      tiles: {},
    }))
  })

  it('严格绑定 pointerId，持久化完成前拒绝第二笔，并在 pointercancel 时释放 capture', async () => {
    const gate = deferred<{
      tiles: Array<{ tileKey: string; resourceId: string; byteSize: number }>
    }>()
    bridge.persistBrushTiles.mockImplementationOnce(async () => gate.promise)
    const changes: ImageEditDocumentV3[] = []
    const rendered = render(
      <ControlledRasterEditor
        onDocumentChange={(document) => changes.push(document)}
        onPersistenceChange={() => undefined}
      />,
    )
    fireEvent.click(await rendered.findByRole('button', { name: '栅格画笔' }))
    const overlay = await waitFor(() => (
      rendered.container.querySelector('[data-raster-brush-overlay]') as SVGSVGElement
    ))
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: 320,
      width: 320,
      height: 320,
      toJSON: () => ({}),
    })
    const pointerCapture = installPointerCapture(overlay)

    fireEvent.pointerDown(overlay, { button: 0, clientX: 48, clientY: 48, pointerId: 11 })
    fireEvent.pointerUp(overlay, { clientX: 56, clientY: 48, pointerId: 99 })
    expect(bridge.persistBrushTiles).not.toHaveBeenCalled()
    fireEvent.pointerUp(overlay, { clientX: 56, clientY: 48, pointerId: 11 })
    await waitFor(() => expect(bridge.persistBrushTiles).toHaveBeenCalledOnce())

    fireEvent.pointerDown(overlay, { button: 0, clientX: 96, clientY: 96, pointerId: 12 })
    expect(pointerCapture.setPointerCapture).toHaveBeenCalledTimes(1)
    gate.resolve({
      tiles: [{
        tileKey: '0/0/0',
        resourceId: `sha256:${'e'.repeat(64)}`,
        byteSize: 96,
      }],
    })
    await waitFor(() => expect(changes.at(-1)?.revision).toBe(1))

    fireEvent.pointerDown(overlay, { button: 0, clientX: 96, clientY: 96, pointerId: 12 })
    expect(pointerCapture.setPointerCapture).toHaveBeenLastCalledWith(12)
    fireEvent.pointerCancel(overlay, { pointerId: 99 })
    expect(pointerCapture.releasePointerCapture).not.toHaveBeenCalledWith(12)
    fireEvent.pointerCancel(overlay, { pointerId: 12 })
    expect(pointerCapture.releasePointerCapture).toHaveBeenCalledWith(12)
    expect(bridge.persistBrushTiles).toHaveBeenCalledOnce()
  })
})
