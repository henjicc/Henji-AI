import { describe, expect, it } from 'vitest'

import { mapCanvasNodeMediaReferences } from './canvasNodeMediaReferences'

describe('mapCanvasNodeMediaReferences', () => {
  it('映射全景查看节点持久化的球面预览图', () => {
    const mapped = mapCanvasNodeMediaReferences({
      imageUrl: '/media/panorama.png',
      previewImageUrl: '/media/panorama-thumbnail.webp',
      panoramaPreviewImageUrl: '/media/panorama-view.png',
    }, (value) => `mapped:${value}`)

    expect(mapped).toMatchObject({
      imageUrl: 'mapped:/media/panorama.png',
      previewImageUrl: 'mapped:/media/panorama-thumbnail.webp',
      panoramaPreviewImageUrl: 'mapped:/media/panorama-view.png',
    })
  })
})
