/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
}: {
  onDocumentChange: (document: ImageEditDocumentV3) => void
  onPersistenceChange: () => void
}): JSX.Element {
  const initial = createImageEditDocumentV3({ width: 64, height: 64, documentId: 'brush-ui' })
  initial.layers = [createImageEditRasterLayerV3('raster', '可绘制图层')]
  const [document, setDocument] = useState(initial)
  return (
    <div style={{ width: 600, height: 500 }}>
      <ImageEditorV3
        sourceImageUrl="preview.png"
        document={document}
        profileId="mask"
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

  it('pointer 手势先显示 dirty tile，抬笔后只持久化一次且撤销重做恢复引用', async () => {
    const changes: ImageEditDocumentV3[] = []
    const persistentChanges = vi.fn()
    const rendered = render(
      <ControlledRasterEditor
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
    expect(rendered.container.querySelector('foreignObject canvas')?.className).not.toContain('bg-bg-dark')
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
    fireEvent.click(screen.getByRole('button', { name: '擦除' }))
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
