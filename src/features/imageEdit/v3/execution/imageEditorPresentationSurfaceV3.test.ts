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
})
