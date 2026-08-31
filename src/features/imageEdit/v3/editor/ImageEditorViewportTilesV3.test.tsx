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

  it('按文档坐标摆放小画布，显示层不接管 Bitmap 租约', async () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D)
    const release = vi.fn()
    const result: ImageEditorManagedViewportCompositeV3 = {
      documentId: 'tiles',
      revision: 2,
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
    const rendered = render(<ImageEditorViewportTilesV3 result={result} label="预览" />)

    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(1))
    const canvas = rendered.container.querySelector<HTMLCanvasElement>('[data-viewport-tile]')
    expect(canvas?.style.left).toBe('51.2%')
    expect(canvas?.style.width).toBe('48.8%')
    expect(canvas?.style.backgroundColor).toBe('')
    expect(release).not.toHaveBeenCalled()

    rendered.rerender(<ImageEditorViewportTilesV3 result={result} label="预览" />)
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()
    rendered.unmount()
    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()
  })
})
