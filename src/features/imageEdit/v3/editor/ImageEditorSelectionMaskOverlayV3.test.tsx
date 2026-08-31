/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import i18n from '@/i18n/config'
import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorV3 } from './ImageEditorV3'

const bridge = vi.hoisted(() => ({ persistBrushTiles: vi.fn() }))

vi.mock('@/commands/imageEditorV3', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/commands/imageEditorV3')>()
  return { ...original, persistImageEditorV3BrushTiles: bridge.persistBrushTiles }
})

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function installPointerCapture(overlay: SVGSVGElement) {
  const captured = new Set<number>()
  Object.defineProperties(overlay, {
    hasPointerCapture: {
      configurable: true,
      value: (pointerId: number) => captured.has(pointerId),
    },
    releasePointerCapture: {
      configurable: true,
      value: (pointerId: number) => captured.delete(pointerId),
    },
    setPointerCapture: {
      configurable: true,
      value: (pointerId: number) => captured.add(pointerId),
    },
  })
}

function ControlledSelectionEditor({
  onDocumentChange,
  profileId = 'full',
}: {
  onDocumentChange: (document: ImageEditDocumentV3) => void
  profileId?: 'full' | 'quick'
}): JSX.Element {
  const initial = createImageEditDocumentV3({ width: 64, height: 64, documentId: 'selection-ui' })
  initial.layers = [createImageEditRasterLayerV3('raster', '选区目标')]
  const [document, setDocument] = useState(initial)
  return (
    <div style={{ width: 600, height: 500 }}>
      <ImageEditorV3
        sourceImageUrl="preview.png"
        document={document}
        profileId={profileId}
        onDocumentChange={(next) => {
          onDocumentChange(next)
          setDocument(next)
        }}
        previewRenderer={() => ({
          kind: 'content',
          content: <div data-testid="selection-preview" style={{ width: 320, height: 320 }} />,
        })}
      />
    </div>
  )
}

describe('ImageEditorSelectionMaskOverlayV3', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    useImageEditorSessionStoreV3.setState({ sessions: {} })
    useImageEditorInteractionStoreV3.setState({
      layerDragBySession: {},
      viewportZoomBySession: {},
      viewportPanBySession: {},
      annotationSelectionBySession: {},
    })
    bridge.persistBrushTiles.mockReset().mockImplementation(async ({ tiles }) => ({
      tiles: tiles.map((tile: { tileKey: string }) => ({
        tileKey: tile.tileKey,
        resourceId: `sha256:${'f'.repeat(64)}`,
        byteSize: 64 * 64 * 4,
      })),
    }))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('pointer-up 把瞬态矩形选区一次写成 default0 稀疏蒙版', async () => {
    const changes: ImageEditDocumentV3[] = []
    const rendered = render(
      <ControlledSelectionEditor onDocumentChange={(document) => changes.push(document)} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: '矩形选择' }))
    expect((screen.getByRole('button', { name: '添加' }) as HTMLButtonElement).disabled).toBe(true)
    const overlay = await waitFor(() => (
      rendered.container.querySelector('[data-selection-mask-overlay]') as SVGSVGElement
    ))
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 320,
      width: 320, height: 320, toJSON: () => ({}),
    })
    installPointerCapture(overlay)

    fireEvent.pointerDown(overlay, { button: 0, pointerId: 7, clientX: 80, clientY: 80 })
    fireEvent.pointerMove(overlay, { pointerId: 7, clientX: 160, clientY: 160 })
    expect(overlay.querySelector('rect')).toBeTruthy()
    expect(changes).toHaveLength(0)
    fireEvent.pointerUp(overlay, { pointerId: 7, clientX: 160, clientY: 160 })

    await waitFor(() => expect(bridge.persistBrushTiles).toHaveBeenCalledOnce())
    await waitFor(() => expect(changes.at(-1)?.revision).toBe(1))
    expect(changes.at(-1)?.layers[0].mask).toMatchObject({
      kind: 'sparse-mask',
      storage: 'mask-float32',
      defaultValue: 0,
      tiles: { '0/0/0': `sha256:${'f'.repeat(64)}` },
    })
    await waitFor(() => expect(
      (screen.getByRole('button', { name: '添加' }) as HTMLButtonElement).disabled,
    ).toBe(false))
  })

  it('quick 宿主不渲染选择工具，full 同时提供矩形、椭圆与套索', async () => {
    const quick = render(<ControlledSelectionEditor profileId="quick" onDocumentChange={() => undefined} />)
    await screen.findByRole('button', { name: '裁剪' })
    expect(quick.container.querySelector('[data-tool-id="select-rect"]')).toBeNull()
    quick.unmount()

    const full = render(<ControlledSelectionEditor onDocumentChange={() => undefined} />)
    for (const toolId of ['select-rect', 'select-ellipse', 'select-lasso']) {
      expect(full.container.querySelector<HTMLButtonElement>(`[data-tool-id="${toolId}"]`)?.disabled)
        .toBe(false)
    }
  })
})
