import { createTileRegion } from '@/core/imageEdit/v3/tileGeometry'
import type {
  ImageEditorV3PyramidDescriptor,
  ImageEditorV3ResourceRef,
} from '@/platform/contracts/imageEditorV3'
import {
  imageEditorViewportTileCacheKeyV3,
  type ImageEditorViewportTileCandidateV3,
  type ImageEditorViewportTileRequestV3,
} from './viewportTilePlannerV3'
import type { ImageEditorViewportRenderRequestV3 } from './viewportTileSchedulerV3'

export const IMAGE_EDITOR_VIEWPORT_PROCESS_DECODE_LIMIT_V3 = 8

export function normalizeImageEditorViewportResourceRefsV3(
  request: ImageEditorViewportRenderRequestV3,
): ImageEditorV3ResourceRef[] {
  const refs = [request.resourceRef, ...(request.resourceRefs ?? [])]
  const unique = [...new Set(refs)]
  if (unique.some((resourceRef) => !/^sha256:[a-f0-9]{64}$/.test(resourceRef))) {
    throw new Error('视口图片资源引用无效')
  }
  return unique
}

export function assertCompatibleImageEditorViewportPyramidV3(
  primary: ImageEditorV3PyramidDescriptor,
  candidate: ImageEditorV3PyramidDescriptor,
): void {
  if (
    candidate.tileSize !== primary.tileSize
    || candidate.levels.length !== primary.levels.length
    || candidate.levels.some((level, index) => {
      const expected = primary.levels[index]
      return !expected
        || level.mip !== expected.mip
        || level.width !== expected.width
        || level.height !== expected.height
        || level.columns !== expected.columns
        || level.rows !== expected.rows
    })
  ) throw new Error('参与视口合成的图片资源金字塔几何不一致')
}

function expandTileRequests(
  requests: readonly ImageEditorViewportTileRequestV3[],
  resourceRefs: readonly ImageEditorV3ResourceRef[],
): ImageEditorViewportTileRequestV3[] {
  return resourceRefs.flatMap((resourceRef) => requests.map((request) => ({
    ...request,
    resourceRef,
    key: imageEditorViewportTileCacheKeyV3({ ...request, resourceRef }),
  })))
}

export function resolveImageEditorViewportTileRequestsV3(
  request: ImageEditorViewportRenderRequestV3,
  candidate: ImageEditorViewportTileCandidateV3,
  resourceRefs: readonly ImageEditorV3ResourceRef[],
): ImageEditorViewportTileRequestV3[] {
  const resolved = request.resolveSourceTileRequests?.(candidate)
    ?? expandTileRequests(candidate.tiles, resourceRefs)
  const byKey = new Map<string, ImageEditorViewportTileRequestV3>()
  for (const tile of resolved) {
    let expectedRegion
    try {
      expectedRegion = createTileRegion(
        request.sourceSize ?? request.documentSize,
        { mip: tile.mip, x: tile.tileX, y: tile.tileY },
        tile.halo,
      )
    } catch {
      throw new Error('视口 RenderPlan 返回了越界源瓦片请求')
    }
    const expectedBytes = expectedRegion.sourceRect.width * expectedRegion.sourceRect.height
      * 4 * (tile.bitDepth / 8)
    if (!resourceRefs.includes(tile.resourceRef)
      || tile.mip !== candidate.mip
      || tile.bitDepth !== request.bitDepth
      || tile.key !== imageEditorViewportTileCacheKeyV3(tile)
      || tile.originX !== expectedRegion.sourceRect.x
      || tile.originY !== expectedRegion.sourceRect.y
      || tile.width !== expectedRegion.sourceRect.width
      || tile.height !== expectedRegion.sourceRect.height
      || tile.estimatedBytes !== expectedBytes
      || !Number.isSafeInteger(expectedBytes)) {
      throw new Error('视口 RenderPlan 返回了无效源瓦片请求')
    }
    byKey.set(tile.key, tile)
  }
  return [...byKey.values()]
}

export function awaitImageEditorViewportOperationV3<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  abortError: () => Error,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (complete: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      complete()
    }
    const onAbort = (): void => finish(() => reject(abortError()))
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

class ProcessDecodeGateV3 {
  private active = 0
  private readonly waiting: Array<{
    resolve: (release: () => void) => void
    reject: (error: Error) => void
    signal: AbortSignal
    onAbort: () => void
  }> = []

  async acquire(signal: AbortSignal, abortError: () => Error): Promise<() => void> {
    if (signal.aborted) throw abortError()
    if (this.active < IMAGE_EDITOR_VIEWPORT_PROCESS_DECODE_LIMIT_V3) {
      this.active += 1
      return this.releaseFactory()
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.waiting.indexOf(waiter)
          if (index >= 0) this.waiting.splice(index, 1)
          reject(abortError())
        },
      }
      signal.addEventListener('abort', waiter.onAbort, { once: true })
      this.waiting.push(waiter)
    })
  }

  private releaseFactory(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.waiting.shift()
      if (next) {
        next.signal.removeEventListener('abort', next.onAbort)
        next.resolve(this.releaseFactory())
      } else this.active -= 1
    }
  }
}

const processDecodeGate = new ProcessDecodeGateV3()

export function acquireImageEditorViewportDecodeSlotV3(
  signal: AbortSignal,
  abortError: () => Error,
): Promise<() => void> {
  return processDecodeGate.acquire(signal, abortError)
}
