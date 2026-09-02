import { describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'

const { readFastProxy } = vi.hoisted(() => ({
  readFastProxy: vi.fn(async () => ({
    resourceRef: `sha256:${'a'.repeat(64)}`,
    width: 2_048,
    height: 1_290,
    mediaType: 'image/webp',
    bytes: new ArrayBuffer(0),
  })),
}))

vi.mock('@/commands/imageEditorV3', () => ({
  createImageEditorV3RequestId: () => 'source-warmup-test',
  readImageEditorV3FastProxy: readFastProxy,
}))

import {
  IMAGE_EDITOR_SOURCE_WARMUP_MAX_DIMENSION_V3,
  ImageEditorSourcePyramidWarmupV3,
} from './imageEditorSourcePyramidWarmupV3'

const RESOURCE = `sha256:${'a'.repeat(64)}`

describe('ImageEditorSourcePyramidWarmupV3', () => {
  it('按 2K 预热大图源金字塔，使常用放大视口直接命中 mip 1', async () => {
    const warmup = new ImageEditorSourcePyramidWarmupV3()
    const document = createImageEditDocumentV3({
      width: 5_802,
      height: 3_655,
      sourceResourceId: RESOURCE,
    })

    warmup.warm(document, [])

    await vi.waitFor(() => expect(readFastProxy).toHaveBeenCalledOnce())
    expect(IMAGE_EDITOR_SOURCE_WARMUP_MAX_DIMENSION_V3).toBe(2_048)
    expect(readFastProxy).toHaveBeenCalledWith(expect.objectContaining({
      resourceRef: RESOURCE,
      maxDimension: 2_048,
    }), expect.any(AbortSignal))
    warmup.dispose()
  })
})
