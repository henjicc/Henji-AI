import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'

const { readFastProxy } = vi.hoisted(() => ({
  readFastProxy: vi.fn(async (_request: { resourceRef: string }) => ({
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
  IMAGE_EDITOR_SOURCE_WARMUP_CONCURRENCY_V3,
  IMAGE_EDITOR_SOURCE_WARMUP_MAX_DIMENSION_V3,
  ImageEditorSourcePyramidWarmupV3,
} from './imageEditorSourcePyramidWarmupV3'

const RESOURCE = `sha256:${'a'.repeat(64)}`

describe('ImageEditorSourcePyramidWarmupV3', () => {
  beforeEach(() => {
    readFastProxy.mockReset().mockResolvedValue({
      resourceRef: RESOURCE,
      width: 2_048,
      height: 1_290,
      mediaType: 'image/webp',
      bytes: new ArrayBuffer(0),
    })
  })

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

  it('多图层文档只并发两个后台预热，并在完成后继续排队资源', async () => {
    const releases: Array<() => void> = []
    readFastProxy.mockImplementation((request: { resourceRef: string }) => new Promise((resolve) => {
      releases.push(() => resolve({
        resourceRef: request.resourceRef,
        width: 2_048,
        height: 1_290,
        mediaType: 'image/webp',
        bytes: new ArrayBuffer(0),
      }))
    }))
    const refs = Array.from({ length: 5 }, (_, index) => (
      `sha256:${String(index + 1).repeat(64)}` as const
    ))
    const document = createImageEditDocumentV3({ width: 2_672, height: 1_504 })
    document.layers = refs.map((resourceRef, index) => (
      createImageEditRasterLayerV3(`layer-${index}`, `图层 ${index}`, resourceRef)
    ))
    const warmup = new ImageEditorSourcePyramidWarmupV3()

    warmup.warm(document, [])

    await vi.waitFor(() => expect(readFastProxy).toHaveBeenCalledTimes(2))
    expect(IMAGE_EDITOR_SOURCE_WARMUP_CONCURRENCY_V3).toBe(2)
    releases[0]?.()
    await vi.waitFor(() => expect(readFastProxy).toHaveBeenCalledTimes(3))
    releases[1]?.()
    await vi.waitFor(() => expect(readFastProxy).toHaveBeenCalledTimes(4))
    releases[2]?.()
    await vi.waitFor(() => expect(readFastProxy).toHaveBeenCalledTimes(5))
    releases.slice(3).forEach((release) => release())
    warmup.dispose()
  })
})
