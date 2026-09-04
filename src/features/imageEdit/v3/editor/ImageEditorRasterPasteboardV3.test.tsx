/** @vitest-environment jsdom */

import { createRef } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditorRasterPasteboardV3 } from './ImageEditorRasterPasteboardV3'

describe('ImageEditorRasterPasteboardV3 component', () => {
  afterEach(cleanup)

  it('独立承载不会因图片矩形裁切而丢失的完整源图', () => {
    const document = createImageEditDocumentV3({
      width: 1_600,
      height: 1_000,
      sourceResourceId: 'sha256:source',
    })
    const layer = document.layers[0]
    if (layer.type !== 'raster') throw new Error('测试文档缺少栅格图层')
    layer.transform = [1, 0, 0, 1, 100, -240]
    const rootRef = createRef<HTMLDivElement>()

    const rendered = render(
      <ImageEditorRasterPasteboardV3
        rootRef={rootRef}
        entries={[{
          layer,
          sourceUrl: 'preview.jpg',
          proxy: null,
          metadata: null,
        }]}
        documentWidth={1_600}
        frame={{ left: 25, top: 40, width: 800, height: 500 }}
        ready
        alwaysVisible
        bindLayerFeedbackRef={() => () => undefined}
        onLayerReady={() => undefined}
        onLayerFailed={() => undefined}
      />,
    )

    const pasteboard = rendered.container.querySelector('[data-raster-pasteboard-layer]')
    const root = rendered.container.querySelector('[data-raster-pasteboard-stack]')
    const image = pasteboard?.querySelector('img')
    expect(pasteboard?.getAttribute('data-move-feedback-frame')).not.toBeNull()
    expect(root?.getAttribute('data-raster-source-ready')).toBe('true')
    expect(pasteboard?.getAttribute('style')).toContain('left: 25px')
    expect(image?.style.transform).toBe('matrix(1, 0, 0, 1, 50, -120)')
  })
})
