import { describe, expect, it, vi } from 'vitest'

import type { ImageEditorV3PyramidDescriptor } from '@/platform/contracts/imageEditorV3'
import {
  ImageEditorViewportAdmissionErrorV3,
  planImageEditorViewportTilesV3,
} from './viewportTilePlannerV3'

const resourceRef = `sha256:${'a'.repeat(64)}` as const

function pyramid(width: number, height: number): ImageEditorV3PyramidDescriptor {
  const levels: ImageEditorV3PyramidDescriptor['levels'] = []
  for (let mip = 0; mip <= 30; mip += 1) {
    const levelWidth = Math.max(1, Math.ceil(width / (2 ** mip)))
    const levelHeight = Math.max(1, Math.ceil(height / (2 ** mip)))
    levels.push({
      mip,
      width: levelWidth,
      height: levelHeight,
      columns: Math.ceil(levelWidth / 512),
      rows: Math.ceil(levelHeight / 512),
    })
    if (levelWidth === 1 && levelHeight === 1) break
  }
  return { tileSize: 512, levels }
}

describe('图片编辑 V3 视口瓦片规划', () => {
  it('200MP 高位深适配视口只规划 15 个相交瓦片，不请求完整表面', () => {
    const plan = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 20_000, height: 10_000 },
      pyramid: pyramid(20_000, 10_000),
      bitDepth: 32,
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 1_440,
        height: 900,
        zoom: 1_440 / 20_000,
        devicePixelRatio: 1,
      },
    })

    expect(plan).toMatchObject({
      mip: 3,
      idealMip: 3,
      degradedForBudget: false,
      mipSize: { width: 2_500, height: 1_250 },
    })
    expect(plan.tiles).toHaveLength(15)
    expect(plan.tiles.every((tile) => tile.bitDepth === 32)).toBe(true)
    expect(plan.tiles.length).toBeLessThan(40 * 20)
    expect(plan.estimatedBytes).toBeLessThan(20_000 * 10_000 * 4)
    expect(plan.physicalPixelsPerMipPixel).toBeLessThanOrEqual(1)
  })

  it('devicePixelRatio、缩放和平移会选择目标 mip 并只覆盖可见范围', () => {
    const highDpi = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 20_000, height: 10_000 },
      pyramid: pyramid(20_000, 10_000),
      bitDepth: 8,
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 1_440,
        height: 900,
        zoom: 1_440 / 20_000,
        devicePixelRatio: 2,
      },
    })
    expect(highDpi.mip).toBe(2)
    expect(highDpi.tiles).toHaveLength(50)
    expect(highDpi.physicalPixelsPerMipPixel).toBeLessThanOrEqual(1)

    const panned = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 4_096, height: 4_096 },
      pyramid: pyramid(4_096, 4_096),
      bitDepth: 8,
      viewport: {
        documentX: 600,
        documentY: 700,
        width: 512,
        height: 512,
        zoom: 1,
        devicePixelRatio: 1,
      },
    })
    expect(panned.tiles.map(({ tileX, tileY }) => [tileX, tileY])).toEqual([
      [1, 1], [1, 2], [2, 1], [2, 2],
    ])

    const zoomed = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 4_096, height: 4_096 },
      pyramid: pyramid(4_096, 4_096),
      bitDepth: 8,
      viewport: {
        documentX: 600,
        documentY: 700,
        width: 512,
        height: 512,
        zoom: 2,
        devicePixelRatio: 1,
      },
    })
    expect(zoomed.tiles.map(({ tileX, tileY }) => [tileX, tileY])).toEqual([[1, 1]])
  })

  it('极端长宽比在粗 mip 只产生沿长边的少量瓦片', () => {
    const plan = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 100_000, height: 100 },
      pyramid: pyramid(100_000, 100),
      bitDepth: 8,
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 1_000,
        height: 500,
        zoom: 0.01,
        devicePixelRatio: 1,
      },
    })

    expect(plan).toMatchObject({ mip: 6, mipSize: { width: 1_563, height: 2 } })
    expect(plan.tiles).toHaveLength(4)
    expect(new Set(plan.tiles.map((tile) => tile.tileY))).toEqual(new Set([0]))
  })

  it('halo 从文档坐标缩放到 mip，并纳入边缘裁剪后的字节估算', () => {
    const plan = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 2_048, height: 2_048 },
      pyramid: pyramid(2_048, 2_048),
      bitDepth: 16,
      viewport: {
        documentX: 512,
        documentY: 512,
        width: 512,
        height: 512,
        zoom: 1,
        devicePixelRatio: 1,
      },
      haloDocumentPixels: 60,
    })

    expect(plan.tiles).toHaveLength(1)
    expect(plan.tiles[0]).toMatchObject({
      mip: 0,
      tileX: 1,
      tileY: 1,
      halo: 60,
      width: 632,
      height: 632,
      originX: 452,
      originY: 452,
    })
    expect(plan.tiles[0].estimatedBytes).toBe(632 * 632 * 4 * 2)
  })

  it('位深必须显式提供，halo 在进入主进程前限制为 2048 文档像素', () => {
    const base = {
      resourceRef,
      documentSize: { width: 4_096, height: 4_096 },
      pyramid: pyramid(4_096, 4_096),
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 512,
        height: 512,
        zoom: 1,
        devicePixelRatio: 1,
      },
    }
    expect(() => planImageEditorViewportTilesV3({
      ...base,
      bitDepth: undefined as never,
    })).toThrow('位深无效')

    const boundary = planImageEditorViewportTilesV3({
      ...base,
      bitDepth: 8,
      haloDocumentPixels: 2_048,
    })
    expect(boundary.tiles[0]?.halo).toBe(2_048)
    expect(() => planImageEditorViewportTilesV3({
      ...base,
      bitDepth: 8,
      haloDocumentPixels: 2_049,
    })).toThrow('不能超过 2048')
  })

  it('admission 拒绝时逐级降画质，最粗层仍超预算则明确失败', () => {
    const admit = vi.fn((candidate: { mip: number }) => candidate.mip >= 1)
    const plan = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 2_048, height: 2_048 },
      pyramid: pyramid(2_048, 2_048),
      bitDepth: 8,
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 1_024,
        height: 1_024,
        zoom: 1,
        devicePixelRatio: 1,
      },
      admit,
    })

    expect(plan).toMatchObject({ mip: 1, idealMip: 0, degradedForBudget: true })
    expect(plan.tiles).toHaveLength(1)
    expect(plan.physicalPixelsPerMipPixel).toBe(2)
    expect(admit.mock.calls.map(([candidate]) => candidate.mip)).toEqual([0, 1])

    expect(() => planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 2_048, height: 2_048 },
      pyramid: pyramid(2_048, 2_048),
      bitDepth: 8,
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 1_024,
        height: 1_024,
        zoom: 1,
        devicePixelRatio: 1,
      },
      admit: () => false,
    })).toThrow(ImageEditorViewportAdmissionErrorV3)
  })

  it('视口完全位于图片外时不请求瓦片，非法金字塔会被拒绝', () => {
    const offscreen = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 1_024, height: 1_024 },
      pyramid: pyramid(1_024, 1_024),
      bitDepth: 8,
      viewport: {
        documentX: 2_000,
        documentY: 2_000,
        width: 400,
        height: 300,
        zoom: 1,
        devicePixelRatio: 1,
      },
    })
    expect(offscreen.tiles).toEqual([])

    const invalid = pyramid(1_024, 1_024)
    invalid.levels[0] = { ...invalid.levels[0], columns: 3 }
    expect(() => planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 1_024, height: 1_024 },
      pyramid: invalid,
      bitDepth: 8,
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 512,
        height: 512,
        zoom: 1,
        devicePixelRatio: 1,
      },
    })).toThrow('与文档尺寸不一致')
  })

  it('静止预取半个视口，运动时再沿前进方向预取一个视口', () => {
    const base = {
      resourceRef,
      documentSize: { width: 4_096, height: 2_048 },
      pyramid: pyramid(4_096, 2_048),
      bitDepth: 8 as const,
      overscanViewports: 0.5,
      forwardPrefetchViewports: 1,
    }
    const still = planImageEditorViewportTilesV3({
      ...base,
      viewport: {
        documentX: 1_024,
        documentY: 512,
        width: 512,
        height: 512,
        zoom: 1,
        devicePixelRatio: 1,
      },
    })
    expect(still.demandDocumentRect).toEqual({ x: 768, y: 256, width: 1_024, height: 1_024 })

    const moving = planImageEditorViewportTilesV3({
      ...base,
      viewport: {
        documentX: 1_024,
        documentY: 512,
        width: 512,
        height: 512,
        zoom: 1,
        devicePixelRatio: 1,
        velocityX: 1_000,
        velocityY: 0,
        interacting: true,
      },
    })
    expect(moving.demandDocumentRect).toEqual({ x: 768, y: 256, width: 1_536, height: 1_024 })
  })

  it('在清晰度滞回带内保持 mip，并能规划完整文档最粗兜底', () => {
    const descriptor = pyramid(8_192, 4_096)
    const held = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 8_192, height: 4_096 },
      pyramid: descriptor,
      bitDepth: 8,
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 1_024,
        height: 512,
        zoom: 0.14,
        devicePixelRatio: 1,
      },
      previousMip: 3,
    })
    expect(held.mip).toBe(3)

    const baselinePyramid = pyramid(5_802, 3_655)
    const commonZoom = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 5_802, height: 3_655 },
      pyramid: baselinePyramid,
      bitDepth: 8,
      viewport: {
        documentX: 800,
        documentY: 500,
        width: 1_440,
        height: 900,
        zoom: 0.36,
        devicePixelRatio: 2,
      },
      previousMip: 1,
    })
    expect(commonZoom).toMatchObject({ mip: 1, idealMip: 0 })
    const highZoom = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 5_802, height: 3_655 },
      pyramid: baselinePyramid,
      bitDepth: 8,
      viewport: {
        documentX: 1_200,
        documentY: 700,
        width: 1_440,
        height: 900,
        zoom: 0.45,
        devicePixelRatio: 2,
      },
      previousMip: 1,
    })
    expect(highZoom).toMatchObject({ mip: 0, idealMip: 0 })

    const coarsest = descriptor.levels.at(-1)?.mip ?? 0
    const fallback = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 8_192, height: 4_096 },
      pyramid: descriptor,
      bitDepth: 8,
      viewport: {
        documentX: 2_000,
        documentY: 1_000,
        width: 1_024,
        height: 512,
        zoom: 1,
        devicePixelRatio: 1,
      },
      preferredMip: coarsest,
      coverage: 'document',
    })
    expect(fallback.mip).toBe(coarsest)
    expect(fallback.demandDocumentRect).toEqual({ x: 0, y: 0, width: 8_192, height: 4_096 })
    expect(fallback.tiles).toHaveLength(1)
  })

  it('输出几何与源金字塔尺寸独立校验', () => {
    const plan = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize: { width: 1_000, height: 800 },
      sourceSize: { width: 4_000, height: 3_000 },
      pyramid: pyramid(4_000, 3_000),
      bitDepth: 8,
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 500,
        height: 400,
        zoom: 1,
        devicePixelRatio: 1,
      },
    })
    expect(plan.mipSize).toEqual({ width: 1_000, height: 800 })
  })
})
