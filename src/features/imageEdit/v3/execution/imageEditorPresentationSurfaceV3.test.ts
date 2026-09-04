/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ImageEditorPresentationSurfaceV3 } from './imageEditorPresentationSurfaceV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'

interface MockCanvasContext {
  clearRect: ReturnType<typeof vi.fn>
  drawImage: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  beginPath: ReturnType<typeof vi.fn>
  rect: ReturnType<typeof vi.fn>
  clip: ReturnType<typeof vi.fn>
  setTransform: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  imageSmoothingEnabled: boolean
  imageSmoothingQuality: ImageSmoothingQuality
  globalCompositeOperation: GlobalCompositeOperation
}

function context(): MockCanvasContext {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    setTransform: vi.fn(),
    restore: vi.fn(),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    globalCompositeOperation: 'source-over',
  }
}

function bitmap(): ImageBitmap {
  return { width: 512, height: 512, close: vi.fn() } as unknown as ImageBitmap
}

function result(): ImageEditorManagedViewportCompositeV3 {
  return {
    documentId: 'document',
    revision: 1,
    renderGeneration: 1,
    cameraSequence: 1,
    geometryHash: 'geometry',
    geometry: {
      width: 1_024,
      height: 512,
      orientation: { rotate: 0, mirrored: false },
      crop: null,
    },
    viewportKey: 'viewport',
    coverage: 'document',
    mip: 0,
    documentWidth: 1_024,
    documentHeight: 512,
    diagnostics: [],
    tiles: [
      { bitmap: bitmap(), outputRect: { x: 0, y: 0, width: 512, height: 512 } },
      { bitmap: bitmap(), outputRect: { x: 512, y: 0, width: 512, height: 512 } },
    ],
    release: vi.fn(),
  }
}

describe('ImageEditorPresentationSurfaceV3', () => {
  const contexts = new Map<HTMLCanvasElement, MockCanvasContext>()

  beforeEach(() => {
    contexts.clear()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(
      this: HTMLCanvasElement,
    ) {
      let value = contexts.get(this)
      if (!value) {
        value = context()
        contexts.set(this, value)
      }
      return value as unknown as CanvasRenderingContext2D
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('先在 mip 像素坐标拼成连续帧，再用一次缩放绘制呈现，避免逐瓦片采样缝隙', () => {
    const surface = new ImageEditorPresentationSurfaceV3()
    const front = document.createElement('canvas')
    const safety = document.createElement('canvas')
    surface.attach({ surfaceId: 'surface', front, safety })
    const rendered = result()

    surface.present(rendered, null, {
      stageWidth: 1_024,
      stageHeight: 512,
      viewportKey: 'viewport',
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 1_024,
        height: 512,
        zoom: 1,
        devicePixelRatio: 1,
      },
    }, 1, rendered.geometry, rendered.geometryHash)

    const calls = [...contexts.values()].flatMap((value) => value.drawImage.mock.calls)
    const continuousFrameDraws = calls.filter((call) => (
      call.length === 9
      && call[0] instanceof HTMLCanvasElement
      && call[0].width === 1_024
      && call[0].height === 512
      && call[3] === 1_024
      && call[4] === 512
      && call[7] === 1_024
      && call[8] === 512
    ))
    expect(continuousFrameDraws).toHaveLength(1)

    const assembly = [...contexts.values()].find((value) => (
      value.drawImage.mock.calls.length === 2
      && value.drawImage.mock.calls.every((call) => call.length === 9)
    ))
    expect(assembly?.drawImage.mock.calls.map((call) => call[5])).toEqual([0, 512])
    surface.dispose()
  })

  it('每一帧都从空 staging 重建，不把旧安全画面再次烘焙进新帧', () => {
    const surface = new ImageEditorPresentationSurfaceV3()
    const front = document.createElement('canvas')
    const safety = document.createElement('canvas')
    const rendered = result()
    const currentLayout = {
      stageWidth: 1_024,
      stageHeight: 512,
      viewportKey: 'viewport',
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 1_024,
        height: 512,
        zoom: 1,
        devicePixelRatio: 1,
      },
    }
    surface.attach({ surfaceId: 'surface', front, safety })
    surface.present(rendered, null, currentLayout, 1, rendered.geometry, rendered.geometryHash)
    for (const value of contexts.values()) value.drawImage.mockClear()

    surface.present(rendered, null, currentLayout, 1, rendered.geometry, rendered.geometryHash)

    const allCalls = [...contexts.values()].flatMap((value) => value.drawImage.mock.calls)
    expect(allCalls.some((call) => call[0] === safety)).toBe(false)
    surface.dispose()
  })

  it('同代同坐标的新结果仍上传自己的像素，清晰帧不会复用草稿 atlas 内容', () => {
    const surface = new ImageEditorPresentationSurfaceV3()
    const front = document.createElement('canvas')
    const safety = document.createElement('canvas')
    const first = result()
    const second = result()
    const secondBitmap = second.tiles[0]?.bitmap
    const currentLayout = {
      stageWidth: 1_024,
      stageHeight: 512,
      viewportKey: 'viewport',
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 1_024,
        height: 512,
        zoom: 1,
        devicePixelRatio: 1,
      },
    }
    surface.attach({ surfaceId: 'surface', front, safety })
    surface.present(first, null, currentLayout, 1, first.geometry, first.geometryHash)
    for (const value of contexts.values()) value.drawImage.mockClear()

    surface.present(second, null, currentLayout, 1, second.geometry, second.geometryHash)

    const allCalls = [...contexts.values()].flatMap((value) => value.drawImage.mock.calls)
    expect(allCalls.some((call) => call[0] === secondBitmap)).toBe(true)
    surface.dispose()
  })

  it('GPU ImageBitmap 尺寸匹配时先完整落到 staging，再交换安全表面和前表面', () => {
    const surface = new ImageEditorPresentationSurfaceV3()
    const front = document.createElement('canvas')
    const safety = document.createElement('canvas')
    surface.attach({ surfaceId: 'surface', front, safety })
    const gpuFrame = { width: 320, height: 240, close: vi.fn() } as unknown as ImageBitmap

    const presented = surface.presentGpuBitmap(gpuFrame, {
      stageWidth: 320,
      stageHeight: 240,
      viewportKey: 'gpu-viewport',
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 320,
        height: 240,
        zoom: 1,
        devicePixelRatio: 1,
      },
    }, 4, 5, 6)

    expect(presented).toBe(true)
    const allCalls = [...contexts.values()].flatMap((value) => value.drawImage.mock.calls)
    expect(allCalls.filter((call) => call[0] === gpuFrame)).toHaveLength(1)
    expect(contexts.get(safety)!.drawImage.mock.invocationCallOrder.at(-1))
      .toBeLessThan(contexts.get(front)!.drawImage.mock.invocationCallOrder.at(-1)!)
    expect(front.dataset).toMatchObject({
      renderGeneration: '4', cameraSequence: '5', interactionSequence: '6',
    })
    surface.dispose()
  })

  it('GPU ImageBitmap 尺寸不匹配时不改写最后稳定表面', () => {
    const surface = new ImageEditorPresentationSurfaceV3()
    const front = document.createElement('canvas')
    const safety = document.createElement('canvas')
    surface.attach({ surfaceId: 'surface', front, safety })
    const presented = surface.presentGpuBitmap(bitmap(), {
      stageWidth: 320,
      stageHeight: 240,
      viewportKey: 'gpu-viewport',
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 320,
        height: 240,
        zoom: 1,
        devicePixelRatio: 1,
      },
    }, 1, 1, 1)

    expect(presented).toBe(false)
    expect(contexts.has(front)).toBe(false)
    expect(contexts.has(safety)).toBe(false)
    surface.dispose()
  })

  it('可见GPU canvas只转移一次，并在首个匹配Surface帧前保持隐藏', () => {
    const surface = new ImageEditorPresentationSurfaceV3()
    const front = document.createElement('canvas')
    const safety = document.createElement('canvas')
    const gpu = document.createElement('canvas')
    const offscreen = { width: 300, height: 150 } as OffscreenCanvas
    const transfer = vi.fn(() => offscreen)
    Object.defineProperty(gpu, 'transferControlToOffscreen', { value: transfer })

    expect(surface.attach({ surfaceId: 'direct', front, safety, gpu })).toEqual({
      surfaceGeneration: 1,
      canvas: offscreen,
    })
    expect(gpu.style.visibility).toBe('hidden')
    expect(surface.attach({ surfaceId: 'direct', front, safety, gpu })).toBeNull()
    expect(transfer).toHaveBeenCalledOnce()

    const accepted = surface.presentGpuSurface({
      stageWidth: 320,
      stageHeight: 240,
      viewportKey: 'direct',
      viewport: {
        documentX: 0, documentY: 0, width: 320, height: 240,
        zoom: 1, devicePixelRatio: 2,
      },
    }, 8, 9, 10, 1, 640, 480, null, {
      uploadCount: 1, pipelineCompileCount: 2, frameCount: 3,
      diagnosticReadbackCount: 0, transientUniformUpdateCount: 4,
      residentTileCount: 1, atlasPageCount: 1, allocatedAtlasBytes: 1,
      minimumPlannedMip: 0, maximumPlannedMip: 0,
      surfaceFrameCount: 1, imageBitmapFrameCount: 0, directSurfaceFailureCount: 0,
    })

    expect(accepted).toBe(true)
    expect(contexts.size).toBe(0)
    expect(gpu.style.visibility).toBe('visible')
    expect(front.dataset).toMatchObject({
      renderGeneration: '8', cameraSequence: '9', interactionSequence: '10',
      gpuReadbackCount: '0', gpuSurfaceFrameCount: '1', gpuImageBitmapFrameCount: '0',
    })
    surface.dispose()
  })

  it('旧Surface代次或旧DPR尺寸不能覆盖稳定表面，回退先恢复CPU帧再隐藏GPU', () => {
    const surface = new ImageEditorPresentationSurfaceV3()
    const front = document.createElement('canvas')
    const safety = document.createElement('canvas')
    const gpu = document.createElement('canvas')
    Object.defineProperty(gpu, 'transferControlToOffscreen', {
      value: vi.fn(() => ({ width: 300, height: 150 } as OffscreenCanvas)),
    })
    surface.attach({ surfaceId: 'direct', front, safety, gpu })
    const directLayout = {
      stageWidth: 320,
      stageHeight: 240,
      viewportKey: 'direct',
      viewport: {
        documentX: 0, documentY: 0, width: 320, height: 240,
        zoom: 1, devicePixelRatio: 1,
      },
    }
    expect(surface.presentGpuSurface(directLayout, 1, 1, 1, 0, 320, 240, null)).toBe(false)
    expect(surface.presentGpuSurface(directLayout, 1, 1, 1, 1, 640, 480, null)).toBe(false)
    expect(gpu.style.visibility).toBe('hidden')
    expect(contexts.size).toBe(0)

    expect(surface.presentGpuSurface(directLayout, 1, 1, 1, 1, 320, 240, null)).toBe(true)
    const order: string[] = []
    surface.fallbackToStableFrame(() => {
      order.push(`cpu:${gpu.style.visibility}`)
    })
    order.push(`gpu:${gpu.style.visibility}`)
    expect(order).toEqual(['cpu:visible', 'gpu:hidden'])
    surface.dispose()
  })
})
