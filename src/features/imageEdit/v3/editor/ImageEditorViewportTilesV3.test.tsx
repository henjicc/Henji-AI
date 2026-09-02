/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ImageEditorManagedViewportCompositeV3 } from '../execution/viewportCompositeClientV3'
import { ImageEditorViewportTilesV3 } from './ImageEditorViewportTilesV3'

function bitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap
}

describe('图片编辑 V3 视口成品瓦片表面', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('固定双表面先离屏合成再原子提交，React 不再创建逐瓦片 canvas', async () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D)
    const release = vi.fn()
    const result: ImageEditorManagedViewportCompositeV3 = {
      documentId: 'tiles',
      revision: 2,
      renderGeneration: 4,
      cameraSequence: 7,
      geometryHash: 'geometry-a',
      viewportKey: 'viewport',
      mip: 1,
      documentWidth: 1_000,
      documentHeight: 500,
      diagnostics: [],
      tiles: [{
        outputRect: { x: 256, y: 0, width: 244, height: 250 },
        bitmap: bitmap(244, 250),
      }],
      release,
    }
    const layout = {
      stageWidth: 800,
      stageHeight: 400,
      viewportKey: 'viewport',
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 800,
        height: 600,
        zoom: 0.8,
        devicePixelRatio: 1,
      },
    }
    const rendered = render(
      <ImageEditorViewportTilesV3
        result={result}
        layout={layout}
        expectedGeometryHash="geometry-a"
        label="预览"
      />,
    )

    await waitFor(() => expect(drawImage).toHaveBeenCalled())
    expect(rendered.container.querySelectorAll('canvas')).toHaveLength(2)
    const canvas = rendered.container.querySelector<HTMLCanvasElement>('[data-presentation-front-surface]')
    expect(canvas?.dataset.renderGeneration).toBe('4')
    expect(canvas?.dataset.cameraSequence).toBe('7')
    expect(canvas?.dataset.geometryHash).toBe('geometry-a')
    expect(release).not.toHaveBeenCalled()

    const calls = drawImage.mock.calls.length
    rendered.rerender(
      <ImageEditorViewportTilesV3
        result={result}
        layout={layout}
        expectedGeometryHash="geometry-a"
        label="预览"
      />,
    )
    expect(drawImage).toHaveBeenCalledTimes(calls)
    expect(release).not.toHaveBeenCalled()
    rendered.unmount()
    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()
  })
})
