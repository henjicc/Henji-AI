import { describe, expect, it, vi } from 'vitest'

import { createTileRegion, mipSize, type ImageEditSize } from '@/core/imageEdit/v3'
import type {
  ImageEditorV3PyramidDescriptor,
  ImageEditorV3SourceTile,
} from '@/platform/contracts/imageEditorV3'
import { imageEditorViewportTileCacheKeyV3 } from './viewportTilePlannerV3'
import {
  ImageEditorViewportTileSchedulerV3,
  type ImageEditorViewportRenderRequestV3,
} from './viewportTileSchedulerV3'

const RESOURCE = `sha256:${'a'.repeat(64)}` as const

function pyramid(size: ImageEditSize): ImageEditorV3PyramidDescriptor {
  const levels: ImageEditorV3PyramidDescriptor['levels'] = []
  for (let mip = 0; mip <= 30; mip += 1) {
    const dimensions = mipSize(size, mip)
    levels.push({
      mip,
      ...dimensions,
      columns: Math.ceil(dimensions.width / 512),
      rows: Math.ceil(dimensions.height / 512),
    })
    if (dimensions.width === 1 && dimensions.height === 1) break
  }
  return { tileSize: 512, levels }
}

function sourceTile(
  request: Parameters<NonNullable<ConstructorParameters<typeof ImageEditorViewportTileSchedulerV3>[0]['readSourceTile']>>[0],
  size: ImageEditSize,
): ImageEditorV3SourceTile {
  const region = createTileRegion(size, {
    mip: request.mip,
    x: request.tileX,
    y: request.tileY,
  }, request.halo)
  return {
    ...request,
    width: region.sourceRect.width,
    height: region.sourceRect.height,
    originX: region.sourceRect.x,
    originY: region.sourceRect.y,
    channels: 4,
    sampleFormat: 'uint',
    numericRange: 'unorm8',
    byteOrder: 'little-endian',
    rowStride: region.sourceRect.width * 4,
    colorSpace: 'srgb',
    transferFunction: 'srgb',
    alphaMode: 'straight',
    orientationApplied: true,
    pixels: new ArrayBuffer(region.sourceRect.width * region.sourceRect.height * 4),
  }
}

function renderRequest(
  documentSize: ImageEditSize,
  additions: Partial<ImageEditorViewportRenderRequestV3> = {},
): ImageEditorViewportRenderRequestV3 {
  return {
    resourceRef: RESOURCE,
    revision: 0,
    documentSize,
    viewport: {
      documentX: 0,
      documentY: 0,
      width: documentSize.width,
      height: documentSize.height,
      zoom: 1,
      devicePixelRatio: 1,
    },
    bitDepth: 8,
    ...additions,
  }
}

describe('图片编辑 V3 输出与源采样层级独立调度', () => {
  it('无图片源仍按输出几何生成帧且不读取伪资源', async () => {
    const describePyramid = vi.fn()
    const readSourceTile = vi.fn()
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'source-free',
      describePyramid,
      readSourceTile,
    })
    const frame = await scheduler.render(renderRequest(
      { width: 8_192, height: 4_096 },
      {
        resourceRef: undefined,
        resourceRefs: [],
        minimumMip: 3,
        viewport: {
          documentX: 0, documentY: 0, width: 1_024, height: 512,
          zoom: 1 / 8, devicePixelRatio: 1,
        },
      },
    ))
    expect(frame.plan).toMatchObject({ mip: 3, mipSize: { width: 1_024, height: 512 } })
    expect(frame.resourceTiles.size).toBe(0)
    expect(frame.sourceMipLevels.size).toBe(0)
    expect(describePyramid).not.toHaveBeenCalled()
    expect(readSourceTile).not.toHaveBeenCalled()
    frame.release()
    scheduler.dispose()
  })

  it('8192画布的安全输出停在mip3，1像素源只读取真实mip0', async () => {
    const sourceSize = { width: 1, height: 1 }
    const readSourceTile = vi.fn(async (request) => sourceTile(request, sourceSize))
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'independent-output-source-mip',
      describePyramid: async () => pyramid(sourceSize),
      readSourceTile,
    })
    const frame = await scheduler.render(renderRequest(
      { width: 8_192, height: 8_192 },
      {
        minimumMip: 3,
        coverage: 'document',
        viewport: {
          documentX: 0, documentY: 0, width: 1_024, height: 1_024,
          zoom: 1 / 8, devicePixelRatio: 1,
        },
        resolveSourceTileRequests: () => {
          const region = createTileRegion(sourceSize, { mip: 0, x: 0, y: 0 }, 0)
          const request = {
            resourceRef: RESOURCE,
            mip: 0,
            tileX: 0,
            tileY: 0,
            halo: 0,
            bitDepth: 8 as const,
            width: region.sourceRect.width,
            height: region.sourceRect.height,
            originX: region.sourceRect.x,
            originY: region.sourceRect.y,
            estimatedBytes: region.sourceRect.width * region.sourceRect.height * 4,
          }
          return [{ ...request, key: imageEditorViewportTileCacheKeyV3(request) }]
        },
      },
    ))
    expect(frame.plan).toMatchObject({ mip: 3, mipSize: { width: 1_024, height: 1_024 } })
    expect(readSourceTile).toHaveBeenCalledTimes(1)
    expect(readSourceTile).toHaveBeenCalledWith(
      expect.objectContaining({ mip: 0, tileX: 0, tileY: 0 }),
      expect.any(AbortSignal),
    )
    expect(frame.sourceMipLevels.get(RESOURCE)).toBe(0)
    frame.release()
    scheduler.dispose()
  })

  it('自定义依赖可额外读取真实mip0边界样本，但权威内容mip保持计划解析值', async () => {
    const sourceSize = { width: 1_024, height: 1 }
    const createRequest = (mip: number) => {
      const region = createTileRegion(sourceSize, { mip, x: 0, y: 0 }, 0)
      const request = {
        resourceRef: RESOURCE,
        mip,
        tileX: 0,
        tileY: 0,
        halo: 0,
        bitDepth: 8 as const,
        width: region.sourceRect.width,
        height: region.sourceRect.height,
        originX: region.sourceRect.x,
        originY: region.sourceRect.y,
        estimatedBytes: region.sourceRect.width * region.sourceRect.height * 4,
      }
      return { ...request, key: imageEditorViewportTileCacheKeyV3(request) }
    }
    const readSourceTile = vi.fn(async (request) => sourceTile(request, sourceSize))
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'explicit-fine-boundary-sample',
      describePyramid: async () => pyramid(sourceSize),
      readSourceTile,
    })
    const frame = await scheduler.render(renderRequest(sourceSize, {
      preferredMip: 10,
      viewport: {
        documentX: 0, documentY: 0, width: 1, height: 1,
        zoom: 1 / 1_024, devicePixelRatio: 1,
      },
      resolveSourceTileRequests: () => [createRequest(10), createRequest(0)],
    }))
    expect(frame.sourceMipLevels.get(RESOURCE)).toBe(10)
    expect(new Set(readSourceTile.mock.calls.map(([request]) => request.mip)))
      .toEqual(new Set([10, 0]))
    frame.release()
    scheduler.dispose()
  })
})
