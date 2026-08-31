import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  IMAGE_EDIT_RENDER_PRIORITY,
  ImageEditRenderScheduler,
  ImageEditResourceBudget,
  applyDiffusionV4,
  convertFloat32TileColorDomainV3,
  createFloat32PremultipliedRgbaTile,
  createBuiltInImageEditRenderNodeRegistry,
  createTileRegion,
  collectImageEditCpuRegionRequirementsV3,
  executeImageEditCpuRenderRegionPlanV3,
  planTileExecution,
  tileGridSize,
  type Float32PremultipliedRgbaTile,
  type ImageEditMemoryLease,
  type ImageEditRenderPlanNode,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3RenderedExportTile } from '@/commands/imageEditorV3Export'
import { createLogger } from '@/core/logging'
import { rasterizeImageEditorV3ExportAnnotations } from './annotations'
import {
  prepareImageEditorV3ExportRender,
  resolveImageEditorV3ExportReferenceWhiteNits,
  resolveImageEditorV3ExportSourceBitDepth,
} from './capabilities'
import {
  buildImageEditorV3DiffusionAnalyses,
} from './diffusionAnalysis'
import {
  ImageEditorV3ExportCapabilityError,
  type ImageEditorV3ExportRenderDependencies,
  type ImageEditorV3ExportRenderRegion,
  type ImageEditorV3ExportTileStream,
  type RenderImageEditorV3ExportTilesRequest,
} from './contracts'
import {
  resolveImageEditorV3ExportGeometry,
  resolveImageEditorV3ExportNeighborhood,
  resolveImageEditorV3SourceRegion,
} from './geometry'
import {
  encodeImageEditorV3RenderedOutputTile,
  projectImageEditorV3RenderedRegionToOutput,
} from './outputTile'
import {
  applyImageEditorV3SparseRasterRegion,
  createImageEditorV3SparseRasterPlan,
  type ImageEditorV3SparseRasterPlan,
} from './brushRegion'
import {
  imageEditorV3SourceRegionToMask,
  loadImageEditorV3SourceRegion,
} from './sourceRegion'
import { createImageEditorSparseMaskPlanV3 } from '../execution/sparseMaskResourcesV3'
import {
  acquireImageEditorSessionResourceBudgetV3,
  type ImageEditorSessionResourceBudgetLeaseV3,
} from '../execution/imageEditorSessionResourceBudgetV3'
import { loadImageEditorV3SparseMaskRegion } from './maskRegion'

const logger = createLogger('features.image_edit.v3.export')
const registry = createBuiltInImageEditRenderNodeRegistry()
const DEFAULT_TILE_SIZE = 512
const TOTAL_BUDGET_BYTES = 1_342_177_280

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = signal.reason instanceof Error ? signal.reason : new Error('图片分块导出已取消')
  if (error.name === 'Error') error.name = 'AbortError'
  throw error
}

function validateTileSize(value = DEFAULT_TILE_SIZE): number {
  if (!Number.isSafeInteger(value) || value < 16 || value > 1024 || value % 16 !== 0) {
    throw new Error('导出瓦片尺寸必须是 16～1024 之间的 16 倍数')
  }
  return value
}

function createSessionId(requested?: string): string {
  if (requested?.trim()) return requested
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `image-edit-export:${suffix}`
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rasterResourceId(node: ImageEditRenderPlanNode): string | null {
  const source = isRecord(node.parameters.source) ? node.parameters.source : null
  return source?.kind === 'resource' && typeof source.resourceId === 'string'
    ? source.resourceId
    : null
}

function transparentRegion(
  region: ImageEditorV3ExportRenderRegion,
  workingSpace: 'srgb' | 'display-p3' | 'rec2020',
  transferFunction: 'srgb' | 'linear' | 'pq' | 'hlg',
  referenceWhiteNits: number,
): Float32PremultipliedRgbaTile {
  return createFloat32PremultipliedRgbaTile(
    region.width,
    region.height,
    'linear-light',
    new Float32Array(region.width * region.height * 4),
    workingSpace,
    transferFunction,
    referenceWhiteNits,
  )
}

function safeWorkingSetBytes(region: ImageEditorV3ExportRenderRegion, nodeCount: number): number {
  const bytes = region.width * region.height * 4 * 4 * Math.max(3, nodeCount + 2)
  if (!Number.isSafeInteger(bytes)) {
    throw new ImageEditorV3ExportCapabilityError(
      'WORKING_SET_EXCEEDED',
      '单个导出瓦片的工作集超出安全整数范围',
    )
  }
  return bytes
}

interface RenderedLeasedTile {
  tile: ImageEditorV3RenderedExportTile
  transferLease: ImageEditMemoryLease
}

function acquireOrThrow(
  budget: ImageEditResourceBudget,
  category: 'in-flight' | 'transfer',
  bytes: number,
): ImageEditMemoryLease {
  const lease = budget.acquire(category, bytes)
  if (lease) return lease
  const snapshot = budget.snapshot()
  throw new ImageEditorV3ExportCapabilityError(
    'WORKING_SET_EXCEEDED',
    `图片导出资源账本拒绝 ${Math.ceil(bytes / 1024 / 1024)}MiB ${category} 工作集；当前已使用 ${Math.ceil(snapshot.totalBytes / 1024 / 1024)}MiB`,
  )
}

export function renderImageEditorV3ExportTiles(
  request: RenderImageEditorV3ExportTilesRequest,
  dependencies: ImageEditorV3ExportRenderDependencies = {},
): ImageEditorV3ExportTileStream {
  if (request.signal?.aborted) throwIfAborted(request.signal)
  const prepared = prepareImageEditorV3ExportRender(request.document, request.description)
  const geometry = resolveImageEditorV3ExportGeometry(prepared.document, request.description)
  const sparseRasterPlan = createImageEditorV3SparseRasterPlan(
    prepared.plan,
    { width: geometry.sourceWidth, height: geometry.sourceHeight },
    request.resourceDescriptors,
  )
  const sparseMaskPlan = createImageEditorSparseMaskPlanV3(
    prepared.plan,
    { width: geometry.sourceWidth, height: geometry.sourceHeight },
    request.resourceDescriptors,
  )
  return renderTiles(request, dependencies, prepared, geometry, sparseRasterPlan, sparseMaskPlan)
}

async function* renderTiles(
  request: RenderImageEditorV3ExportTilesRequest,
  dependencies: ImageEditorV3ExportRenderDependencies,
  prepared: ReturnType<typeof prepareImageEditorV3ExportRender>,
  geometry: ReturnType<typeof resolveImageEditorV3ExportGeometry>,
  sparseRasterPlan: ImageEditorV3SparseRasterPlan,
  sparseMaskPlan: ReturnType<typeof createImageEditorSparseMaskPlanV3>,
): AsyncGenerator<ImageEditorV3RenderedExportTile> {
  const { document, plan } = prepared
  const sourceBitDepth = resolveImageEditorV3ExportSourceBitDepth(document)
  const referenceWhiteNits = resolveImageEditorV3ExportReferenceWhiteNits(document)
  const neighborhood = resolveImageEditorV3ExportNeighborhood(plan)
  const tileSize = validateTileSize(request.tileSize)
  const scheduler = dependencies.scheduler ?? new ImageEditRenderScheduler({ cpuConcurrency: 2 })
  const currentSessionId = createSessionId(request.sessionId)
  let globalBudgetLease: ImageEditorSessionResourceBudgetLeaseV3 | null = null
  const budget = dependencies.resourceBudget ?? (() => {
    globalBudgetLease = acquireImageEditorSessionResourceBudgetV3(currentSessionId, {
      consumerId: `${currentSessionId}:export-render`,
    })
    return globalBudgetLease.budget
  })()
  const controller = new AbortController()
  const onAbort = (): void => {
    controller.abort(request.signal?.reason)
    scheduler.cancelSession(currentSessionId)
  }
  request.signal?.addEventListener('abort', onAbort, { once: true })
  if (request.signal?.aborted) onAbort()
  const outputSize = { width: geometry.outputWidth, height: geometry.outputHeight }
  const grid = tileGridSize(outputSize, 0, tileSize)
  const total = grid.width * grid.height
  let completed = 0
  let diffusionAnalysisSet: Awaited<ReturnType<typeof buildImageEditorV3DiffusionAnalyses>> | null = null
  logger.info('开始渲染图片编辑 V3 分块导出', {
    event: 'image_editor_v3.export.render.start',
    requestId: currentSessionId,
    context: {
      documentId: document.id,
      revision: document.revision,
      width: geometry.outputWidth,
      height: geometry.outputHeight,
      tileSize,
      tileCount: total,
      halo: plan.nodes.reduce((total, node) => (
        total + Math.max(0, Math.ceil(registry.get(node.definitionId)?.localHalo?.(node.parameters, 0) ?? 0))
      ), 0),
    },
  })
  try {
    throwIfAborted(controller.signal)
    diffusionAnalysisSet = await buildImageEditorV3DiffusionAnalyses(
      document,
      plan,
      controller.signal,
      dependencies,
      budget,
      sparseMaskPlan,
    )
    const diffusionAnalyses = diffusionAnalysisSet.analyses
    if (tileSize === DEFAULT_TILE_SIZE) {
      try {
        planTileExecution(
          { width: geometry.sourceWidth, height: geometry.sourceHeight },
          0,
          {
            halo: neighborhood.halo,
            bytesPerPixel: 16,
            workingSurfaceCount: Math.max(3, plan.nodes.length + 2),
            maxWorkingSetBytes: TOTAL_BUDGET_BYTES,
            preferSupertile: false,
          },
        )
      } catch (error) {
        throw new ImageEditorV3ExportCapabilityError(
          'WORKING_SET_EXCEEDED',
          '当前效果 halo 无法在 1.25GiB 资源上限内完成一个 512 瓦片',
          { cause: error },
        )
      }
    }
    for (let tileY = 0; tileY < grid.height; tileY += 1) {
      for (let tileX = 0; tileX < grid.width; tileX += 1) {
        throwIfAborted(controller.signal)
        const outputRegion = createTileRegion(outputSize, { mip: 0, x: tileX, y: tileY }, 0, tileSize)
        const outputRect = outputRegion.outputRect
        const sourceRegion = resolveImageEditorV3SourceRegion(
          outputRect,
          geometry,
          { halo: 0, alignment: 1 },
        )
        const taskId = `${currentSessionId}:${tileY}:${tileX}`
        const rendered = await scheduler.schedule<RenderedLeasedTile>({
          id: taskId,
          sessionId: currentSessionId,
          revision: document.revision,
          kind: 'export',
          lane: 'cpu',
          priority: IMAGE_EDIT_RENDER_PRIORITY.export,
          run: async (taskContext) => {
            const requirements = collectImageEditCpuRegionRequirementsV3(
              plan,
              [sourceRegion],
              {
                registry,
                size: { width: geometry.sourceWidth, height: geometry.sourceHeight },
              },
            )
            const largestRequiredPixels = [
              sourceRegion.width * sourceRegion.height,
              ...[...requirements.rasterRegions.values(), ...requirements.maskRegions.values()]
                .flat()
                .map((region) => region.width * region.height),
            ].reduce((largest, pixels) => Math.max(largest, pixels), 0)
            const workingLease = acquireOrThrow(
              budget,
              'in-flight',
              safeWorkingSetBytes(
                { ...sourceRegion, width: largestRequiredPixels, height: 1 },
                plan.nodes.length,
              ),
            )
            try {
              const sourceCache = new Map<string, Promise<Float32PremultipliedRgbaTile>>()
              const loadSource = (
                resourceId: string,
                region: ImageEditorV3ExportRenderRegion,
              ): Promise<Float32PremultipliedRgbaTile> => {
                const key = `${resourceId}:${region.x}:${region.y}:${region.width}:${region.height}`
                const cached = sourceCache.get(key)
                if (cached) return cached
                const loaded = loadImageEditorV3SourceRegion(
                  resourceId,
                  region,
                  { width: geometry.sourceWidth, height: geometry.sourceHeight },
                  sourceBitDepth,
                  document.color.workingSpace,
                  document.color.transferFunction,
                  referenceWhiteNits,
                  taskContext.signal,
                  dependencies,
                )
                sourceCache.set(key, loaded)
                return loaded
              }
              const renderedRegion = await executeImageEditCpuRenderRegionPlanV3(plan, sourceRegion, {
                size: { width: geometry.sourceWidth, height: geometry.sourceHeight },
                registry,
                signal: taskContext.signal,
                createTransparent: (region) => transparentRegion(
                  region,
                  document.color.workingSpace,
                  document.color.transferFunction,
                  referenceWhiteNits,
                ),
                loadRaster: async (node, region) => {
                  const resourceId = rasterResourceId(node)
                  const base = resourceId
                    ? loadSource(resourceId, region)
                    : transparentRegion(
                        region,
                        document.color.workingSpace,
                        document.color.transferFunction,
                        referenceWhiteNits,
                      )
                  return applyImageEditorV3SparseRasterRegion(
                    node,
                    await base,
                    region,
                    { width: geometry.sourceWidth, height: geometry.sourceHeight },
                    sparseRasterPlan,
                    {
                      workingSpace: document.color.workingSpace,
                      transferFunction: document.color.transferFunction,
                      referenceWhiteNits,
                    },
                    taskContext.signal,
                    dependencies,
                    budget,
                  )
                },
                rasterizeAnnotations: (node, region) => (
                  dependencies.rasterizeAnnotations ?? rasterizeImageEditorV3ExportAnnotations
                )({ node, document, region, signal: taskContext.signal }),
                loadMask: async (reference, _node, region) => {
                  const sparse = await loadImageEditorV3SparseMaskRegion(
                    reference,
                    region,
                    0,
                    sparseMaskPlan,
                    taskContext.signal,
                    dependencies,
                    budget,
                  )
                  if (sparse) return sparse
                  if (!('resourceId' in reference)) throw new Error('蒙版引用缺少资源 ID')
                  return imageEditorV3SourceRegionToMask(await loadSource(reference.resourceId, region))
                },
                executeCustomEffect: async (node, source, mask, region) => {
                  if (node.definitionId !== 'effect.diffusion') {
                    throw new Error(`分块导出不支持自定义效果：${node.definitionId}`)
                  }
                  const analysis = diffusionAnalyses.get(node.id)
                  if (!analysis) throw new Error(`柔光节点缺少共享散射分析：${node.id}`)
                  const linear = convertFloat32TileColorDomainV3(source, 'linear-light')
                  const parameters = DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(node.parameters)
                  const recipe = DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(parameters, {
                    width: geometry.sourceWidth,
                    height: geometry.sourceHeight,
                    quality: 'high',
                  })
                  return applyDiffusionV4(linear, recipe, {
                    mask,
                    globalScatter: {
                      tile: analysis.scatter,
                      documentWidth: analysis.documentWidth,
                      documentHeight: analysis.documentHeight,
                      sourceX: region.x,
                      sourceY: region.y,
                    },
                  })
                },
              })
              throwIfAborted(taskContext.signal)
              const outputFloat = projectImageEditorV3RenderedRegionToOutput(
                renderedRegion ?? transparentRegion(
                  sourceRegion,
                  document.color.workingSpace,
                  document.color.transferFunction,
                  referenceWhiteNits,
                ),
                sourceRegion,
                outputRect,
                geometry,
              )
              const tile = encodeImageEditorV3RenderedOutputTile(
                outputFloat,
                outputRect,
                request.description,
              )
              const transferLease = acquireOrThrow(budget, 'transfer', tile.pixels.byteLength)
              try {
                await taskContext.yieldAfterAtomicUnit()
                throwIfAborted(taskContext.signal)
                return { tile, transferLease }
              } catch (error) {
                transferLease.release()
                throw error
              }
            } finally {
              workingLease.release()
            }
          },
        })
        try {
          completed += 1
          request.onTileRendered?.(completed, total)
          yield rendered.tile
        } finally {
          rendered.transferLease.release()
        }
      }
    }
    logger.info('完成图片编辑 V3 分块导出渲染', {
      event: 'image_editor_v3.export.render.completed',
      requestId: currentSessionId,
      context: { documentId: document.id, revision: document.revision, tileCount: completed },
    })
  } catch (error) {
    if (controller.signal.aborted) {
      logger.info('图片编辑 V3 分块导出渲染已取消', {
        event: 'image_editor_v3.export.render.cancelled',
        requestId: currentSessionId,
        context: { documentId: document.id, revision: document.revision, completed, total },
      })
      throwIfAborted(controller.signal)
    }
    logger.error('图片编辑 V3 分块导出渲染失败', error, {
      event: 'image_editor_v3.export.render.failed',
      requestId: currentSessionId,
      context: { documentId: document.id, revision: document.revision, completed, total },
    })
    throw error
  } finally {
    diffusionAnalysisSet?.release()
    request.signal?.removeEventListener('abort', onAbort)
    scheduler.cancelSession(currentSessionId)
    globalBudgetLease?.release()
  }
}
