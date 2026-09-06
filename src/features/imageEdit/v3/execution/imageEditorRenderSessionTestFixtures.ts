import { afterEach, beforeEach, vi } from 'vitest'
import type { ImageEditorManagedViewportCompositeV3, ImageEditorViewportCompositeRequestV3 } from './viewportCompositeTypesV3'

export function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let complete: ((value: T) => void) | undefined
  return {
    promise: new Promise<T>((resolve) => { complete = resolve }),
    resolve: (value) => complete?.(value),
  }
}

export function result(
  request: ImageEditorViewportCompositeRequestV3,
  release = vi.fn(),
): ImageEditorManagedViewportCompositeV3 {
  const mip = request.preferredMip ?? 0
  const outputWidth = Math.ceil(request.document.geometry.width / (2 ** mip))
  const outputHeight = Math.ceil(request.document.geometry.height / (2 ** mip))
  const tiles = []
  for (let y = 0; y < outputHeight; y += 512) {
    for (let x = 0; x < outputWidth; x += 512) {
      const width = Math.min(512, outputWidth - x)
      const height = Math.min(512, outputHeight - y)
      tiles.push({
        bitmap: {
          width,
          height,
          close: vi.fn(),
        } as unknown as ImageBitmap,
        outputRect: { x, y, width, height },
      })
    }
  }
  return {
    documentId: request.document.id,
    revision: request.document.revision,
    renderGeneration: request.renderGeneration,
    cameraSequence: request.cameraSequence,
    geometryHash: request.geometryHash,
    geometry: {
      ...request.document.geometry,
      orientation: { ...request.document.geometry.orientation },
      crop: request.document.geometry.crop ? { ...request.document.geometry.crop } : null,
    },
    viewportKey: request.viewportKey,
    coverage: request.coverage ?? 'viewport',
    mip,
    documentWidth: request.document.geometry.width,
    documentHeight: request.document.geometry.height,
    diagnostics: [],
    tiles,
    release,
  }
}

export const layout = {
  stageWidth: 800,
  stageHeight: 500,
  viewportKey: 'viewport-1',
  viewport: {
    documentX: 0,
    documentY: 0,
    width: 800,
    height: 500,
    zoom: 0.5,
    devicePixelRatio: 1,
  },
}

export function installImageEditorRenderSessionTestSurface(): void {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      setTransform: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

}
