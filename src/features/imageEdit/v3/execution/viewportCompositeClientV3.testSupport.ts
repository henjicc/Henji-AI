import { expect, vi } from 'vitest'

import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type {
  ImageEditorViewportCompositeBitmapTileV3,
  ImageEditorViewportCompositeWorkerEventV3,
  ImageEditorViewportCompositeWorkerPortV3,
  ImageEditorViewportCompositeWorkerRequestV3,
} from './viewportCompositeProtocolV3'
import { planImageEditorViewportTilesV3 } from './viewportTilePlannerV3'
import type { ImageEditorViewportFrameV3 } from './viewportTileSchedulerV3'

export const RESOURCE = `sha256:${'e'.repeat(64)}` as const
export const RENDER_IDENTITY = {
  renderGeneration: 1,
  cameraSequence: 1,
  geometryHash: '20000:10000:0:0:0:0:20000:10000',
}

export class FakeViewportWorker implements ImageEditorViewportCompositeWorkerPortV3 {
  onmessage: ((event: MessageEvent<ImageEditorViewportCompositeWorkerEventV3>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: ImageEditorViewportCompositeWorkerRequestV3[] = []
  readonly transfers: Transferable[][] = []
  readonly terminate = vi.fn()

  postMessage(message: ImageEditorViewportCompositeWorkerRequestV3, transfer: Transferable[] = []): void {
    this.messages.push(message)
    this.transfers.push(transfer)
  }

  emit(event: ImageEditorViewportCompositeWorkerEventV3): void {
    this.onmessage?.({ data: event } as MessageEvent<ImageEditorViewportCompositeWorkerEventV3>)
  }
}

function pyramid(width: number, height: number) {
  const levels = []
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
  return { tileSize: 512 as const, levels }
}

export function createFrame(width = 20_000, height = 10_000): ImageEditorViewportFrameV3 {
  const plan = planImageEditorViewportTilesV3({
    resourceRef: RESOURCE,
    documentSize: { width, height },
    pyramid: pyramid(width, height),
    viewport: {
      documentX: 0,
      documentY: 0,
      width: 1_440,
      height: 900,
      zoom: 1_440 / width,
      devicePixelRatio: 1,
    },
    bitDepth: 8,
  })
  const tiles = plan.tiles.map((request): ImageEditorV3SourceTile => ({
    resourceRef: RESOURCE,
    mip: request.mip,
    tileX: request.tileX,
    tileY: request.tileY,
    halo: request.halo,
    width: request.width,
    height: request.height,
    channels: 4,
    bitDepth: 8,
    sampleFormat: 'uint',
    numericRange: 'unorm8',
    byteOrder: 'little-endian',
    rowStride: request.width * 4,
    colorSpace: 'srgb',
    transferFunction: 'srgb',
    alphaMode: 'straight',
    orientationApplied: true,
    originX: request.originX,
    originY: request.originY,
    pixels: new ArrayBuffer(request.width * request.height * 4),
  }))
  return {
    sequence: 1,
    revision: 0,
    plan,
    tiles,
    resourceTiles: new Map([[RESOURCE, tiles]]),
    release: vi.fn(),
  }
}

export function bitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap
}

export async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) await Promise.resolve()
  expect(predicate()).toBe(true)
}

export function emitCompletedFrame(
  worker: FakeViewportWorker,
  request: Extract<ImageEditorViewportCompositeWorkerRequestV3, { type: 'render' }>,
  metadata: { revision: number; mip: number; width: number; height: number },
  tiles: ImageEditorViewportCompositeBitmapTileV3[],
): void {
  for (const [tileIndex, tile] of tiles.entries()) {
    worker.emit({
      type: 'tile-rendered', requestId: request.requestId, sequence: request.sequence,
      renderGeneration: request.renderGeneration, cameraSequence: request.cameraSequence,
      geometryHash: request.geometryHash, revision: metadata.revision, mip: metadata.mip,
      tileIndex, tile,
    })
  }
  worker.emit({
    type: 'rendered', requestId: request.requestId, sequence: request.sequence,
    renderGeneration: request.renderGeneration, cameraSequence: request.cameraSequence,
    geometryHash: request.geometryHash, revision: metadata.revision, mip: metadata.mip,
    documentWidth: metadata.width, documentHeight: metadata.height,
    diagnostics: [], completedTiles: tiles.length,
  })
}
