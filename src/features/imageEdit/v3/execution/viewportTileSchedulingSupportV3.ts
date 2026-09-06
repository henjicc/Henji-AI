import { resolveImageEditInverseSourceRectV3 } from '@/core/imageEdit/v3/execution/affineTransform'
import {
  IMAGE_EDIT_STORAGE_TILE_SIZE,
  createTileRegion,
  enumerateTilesForRect,
  mipSize,
  type ImageEditRect,
  type ImageEditSize,
} from '@/core/imageEdit/v3/tileGeometry'
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
  const candidates = [request.resourceRef, ...(request.resourceRefs ?? [])]
  if (candidates.some((resourceRef) => (
    resourceRef !== undefined && typeof resourceRef !== 'string'
  ))) throw new Error('视口图片资源引用无效')
  const refs = candidates.filter(
    (resourceRef): resourceRef is ImageEditorV3ResourceRef => typeof resourceRef === 'string',
  )
  const unique = [...new Set(refs)]
  if (unique.some((resourceRef) => !/^sha256:[a-f0-9]{64}$/.test(resourceRef))) {
    throw new Error('视口图片资源引用无效')
  }
  return unique
}

export function createImageEditorViewportOutputPyramidV3(
  size: ImageEditSize,
): ImageEditorV3PyramidDescriptor {
  const levels: ImageEditorV3PyramidDescriptor['levels'] = []
  for (let mip = 0; mip <= 30; mip += 1) {
    const dimensions = mipSize(size, mip)
    levels.push({
      mip,
      ...dimensions,
      columns: Math.ceil(dimensions.width / IMAGE_EDIT_STORAGE_TILE_SIZE),
      rows: Math.ceil(dimensions.height / IMAGE_EDIT_STORAGE_TILE_SIZE),
    })
    if (dimensions.width === 1 && dimensions.height === 1) break
  }
  return { tileSize: IMAGE_EDIT_STORAGE_TILE_SIZE, levels }
}

/** 选择源真实存在的最接近输出 mip，绝不合成金字塔层级。 */
export function resolveImageEditorViewportSourceMipV3(
  descriptor: ImageEditorV3PyramidDescriptor,
  outputMip: number,
): number {
  let resolved = descriptor.levels[0]?.mip
  for (const level of descriptor.levels) {
    if (level.mip > outputMip) break
    resolved = level.mip
  }
  if (resolved === undefined) throw new Error('图片源金字塔缺少 mip 0')
  return resolved
}

/** 把输出 mip 的逻辑源区域映射到真实可读取的源 mip。 */
export function resolveImageEditorViewportActualSourceRegionV3(
  region: ImageEditRect,
  outputMip: number,
  sourceMip: number,
  sourceSize: ImageEditSize,
): ImageEditRect {
  if (sourceMip === outputMip) return region
  const transform = resolveImageEditorViewportSourceMipTransformV3(
    outputMip,
    sourceMip,
  )
  return resolveImageEditInverseSourceRectV3(
    region,
    transform,
    mipSize(sourceSize, sourceMip),
  )
}

export function resolveImageEditorViewportSourceMipTransformV3(
  outputMip: number,
  sourceMip: number,
): readonly [number, number, number, number, 0, 0] {
  const scale = 2 ** (sourceMip - outputMip)
  return [scale, 0, 0, scale, 0, 0]
}

export function assertCompatibleImageEditorViewportPyramidV3(
  primary: ImageEditorV3PyramidDescriptor,
  candidate: ImageEditorV3PyramidDescriptor,
): void {
  if (candidate.tileSize !== primary.tileSize) {
    throw new Error('参与视口合成的图片资源瓦片规格不一致')
  }
}

function expandTileRequests(
  requests: ReadonlyArray<ImageEditorViewportTileCandidateV3['tiles'][number]>,
  resourceRefs: readonly ImageEditorV3ResourceRef[],
  descriptors: ReadonlyMap<ImageEditorV3ResourceRef, ImageEditorV3PyramidDescriptor>,
  documentSize: ImageEditSize,
): ImageEditorViewportTileRequestV3[] {
  const byKey = new Map<string, ImageEditorViewportTileRequestV3>()
  for (const resourceRef of resourceRefs) {
    const descriptor = descriptors.get(resourceRef)
    const sourceSize = descriptor?.levels.find(({ mip }) => mip === 0)
    if (!descriptor || !sourceSize) throw new Error('视口图片资源缺少 mip 0 几何')
    for (const request of requests) {
      const sourceMip = resolveImageEditorViewportSourceMipV3(descriptor, request.mip)
      const outputMipSize = mipSize(documentSize, request.mip)
      const sourceMipSize = mipSize(sourceSize, sourceMip)
      if (sourceMip === request.mip
        && outputMipSize.width === sourceMipSize.width
        && outputMipSize.height === sourceMipSize.height) {
        const normalized = { ...request, resourceRef }
        byKey.set(imageEditorViewportTileCacheKeyV3(normalized), {
          ...normalized,
          key: imageEditorViewportTileCacheKeyV3(normalized),
        })
        continue
      }
      const actualRegion = resolveImageEditorViewportActualSourceRegionV3(
        {
          x: request.originX,
          y: request.originY,
          width: request.width,
          height: request.height,
        },
        request.mip,
        sourceMip,
        sourceSize,
      )
      for (const coordinate of enumerateTilesForRect(sourceSize, sourceMip, actualRegion)) {
        const region = createTileRegion(sourceSize, coordinate, 0)
        const normalized = {
          resourceRef,
          mip: sourceMip,
          tileX: coordinate.x,
          tileY: coordinate.y,
          halo: 0,
          bitDepth: request.bitDepth,
          width: region.sourceRect.width,
          height: region.sourceRect.height,
          originX: region.sourceRect.x,
          originY: region.sourceRect.y,
          estimatedBytes: region.sourceRect.width * region.sourceRect.height
            * 4 * (request.bitDepth / 8),
        }
        byKey.set(imageEditorViewportTileCacheKeyV3(normalized), {
          ...normalized,
          key: imageEditorViewportTileCacheKeyV3(normalized),
        })
      }
    }
  }
  return [...byKey.values()]
}

export function resolveImageEditorViewportTileRequestsV3(
  request: ImageEditorViewportRenderRequestV3,
  candidate: ImageEditorViewportTileCandidateV3,
  resourceRefs: readonly ImageEditorV3ResourceRef[],
  descriptors: ReadonlyMap<ImageEditorV3ResourceRef, ImageEditorV3PyramidDescriptor>,
): ImageEditorViewportTileRequestV3[] {
  const resolved = request.resolveSourceTileRequests?.(candidate, descriptors)
    ?? expandTileRequests(candidate.tiles, resourceRefs, descriptors, request.documentSize)
  const byKey = new Map<string, ImageEditorViewportTileRequestV3>()
  for (const tile of resolved) {
    let expectedRegion
    const descriptor = descriptors.get(tile.resourceRef)
    const sourceLevel = descriptor?.levels.find(({ mip }) => mip === tile.mip)
    const sourceGeometry = descriptor?.levels.find(({ mip }) => mip === 0)
    try {
      if (!sourceLevel || !sourceGeometry) throw new Error('missing mip')
      expectedRegion = createTileRegion(
        { width: sourceGeometry.width, height: sourceGeometry.height },
        { mip: tile.mip, x: tile.tileX, y: tile.tileY },
        tile.halo,
      )
    } catch {
      throw new Error('视口 RenderPlan 返回了越界源瓦片请求')
    }
    const expectedBytes = expectedRegion.sourceRect.width * expectedRegion.sourceRect.height
      * 4 * (tile.bitDepth / 8)
    if (!resourceRefs.includes(tile.resourceRef)
      || tile.mip > candidate.mip
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
