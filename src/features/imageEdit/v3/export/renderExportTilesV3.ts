import { splitImageEditCpuOutputV3, assembleImageEditCpuOutputV3 } from '../../../../core/imageEdit/v3/execution/cpuOutputParts'
import { ImageEditCpuRegionWorkerClientV3 } from '../../../../core/imageEdit/v3/execution/cpuRegionWorkerClient'
import type { ImageEditCpuRegionRenderContextV3 } from '../../../../core/imageEdit/v3/execution/cpuRenderRegionExecutor'
import { loadImageColorLutV3 } from '../execution/imageColorLutV3'
import { loadImageEditorRasterRegionV3 } from './rasterRegion'
import { transparentRegion, safeWorkingSetBytes, acquireOrThrow } from './renderExportResourcesV3'
import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  IMAGE_EDIT_RENDER_PRIORITY,
  applyDiffusionV4,
  applyFastBlurV3,
  convertFloat32TileColorDomainV3,
  createBuiltInImageEditRenderNodeRegistry,
  createTileRegion,
  collectImageEditCpuRegionRequirementsV3,
  executeImageEditCpuRenderRegionPlanV3,
  planTileExecution,
  tileGridSize,
  type Float32PremultipliedRgbaTile,
  type ImageEditMemoryLease,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3RenderedExportTile } from '@/commands/imageEditorV3Export'
import { createLogger } from '@/core/logging'
import { rasterizeImageEditorV3ExportVectorContent } from './annotations'
import {
  prepareImageEditorV3ExportRender,
  resolveImageEditorV3ExportReferenceWhiteNits,
  resolveImageEditorV3ExportSourceBitDepth,
} from './capabilities'
import {
  buildImageEditorV3DiffusionAnalyses,
} from './diffusionAnalysis'
import {
  buildImageEditorV3FastBlurAnalyses,
  renderImageEditorV3FastBlurAnalysisRegion,
} from './fastBlurAnalysis'
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
  createImageEditorV3SparseRasterPlan,
  validateImageEditorV3SparseRasterResources,
} from './brushRegion'
import {
  loadImageEditorV3SourceRegion,
} from './sourceRegion'
import { createImageEditorSparseMaskPlanV3 } from '../execution/sparseMaskResourcesV3'
import {
  acquireImageEditorSessionResourceBudgetV3,
  type ImageEditorSessionResourceBudgetLeaseV3,
} from '../execution/imageEditorSessionResourceBudgetV3'
import { getImageEditorGlobalRenderSchedulerV3 } from '../execution/imageEditorGlobalRenderSchedulerV3'
import { loadImageEditorV3SparseMaskRegion } from './maskRegion'
import { prepareImageEditorExportSourceGeometryV3, readImageEditorRenderSourceSizesV3 } from './sourceGeometry'
import {
  buildImageEditorV3VgpuGlowAnalyses,
} from './vgpuGlowAnalysis'

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

interface RenderedLeasedTile {
  tile: ImageEditorV3RenderedExportTile
  transferLease: ImageEditMemoryLease
}

export function renderImageEditorV3ExportTiles(
  request: RenderImageEditorV3ExportTilesRequest,
  dependencies: ImageEditorV3ExportRenderDependencies = {},
): ImageEditorV3ExportTileStream {
  if (request.signal?.aborted) throwIfAborted(request.signal)
  const prepared = prepareImageEditorV3ExportRender(request.document, request.description)
  const geometry = resolveImageEditorV3ExportGeometry(prepared.document, request.description)
  validateImageEditorV3SparseRasterResources(prepared.plan, request.resourceDescriptors)
  const sparseMaskPlan = createImageEditorSparseMaskPlanV3(
    prepared.plan,
    { width: geometry.sourceWidth, height: geometry.sourceHeight },
    request.resourceDescriptors,
  )
  return renderTiles(request, dependencies, prepared, geometry, sparseMaskPlan)
}

async function* renderTiles(
  request: RenderImageEditorV3ExportTilesRequest,
  dependencies: ImageEditorV3ExportRenderDependencies,
  prepared: ReturnType<typeof prepareImageEditorV3ExportRender>,
  geometry: ReturnType<typeof resolveImageEditorV3ExportGeometry>,
  sparseMaskPlan: ReturnType<typeof createImageEditorSparseMaskPlanV3>,
): AsyncGenerator<ImageEditorV3RenderedExportTile> {
  const { document, plan } = prepared
  const sourceBitDepth = resolveImageEditorV3ExportSourceBitDepth(document)
  const referenceWhiteNits = resolveImageEditorV3ExportReferenceWhiteNits(document)
  const neighborhood = resolveImageEditorV3ExportNeighborhood(plan)
  const tileSize = validateTileSize(request.tileSize)
  const scheduler = dependencies.scheduler ?? getImageEditorGlobalRenderSchedulerV3()
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
  const cpuWorkers: ImageEditCpuRegionWorkerClientV3[] = []
  const useCpuWorkers = typeof Worker !== 'undefined'
  const workerConcurrency = plan.nodes.some(node => registry.get(node.definitionId)?.globalAnalysis) ? 1 : 4
  const getCpuWorker = (index: number): ImageEditCpuRegionWorkerClientV3 => {
    if (cpuWorkers[index]) return cpuWorkers[index]
    const worker = new Worker(new URL('../../../../core/imageEdit/v3/execution/cpuRenderRegion.worker.ts', import.meta.url), { type: 'module' })
    const client = new ImageEditCpuRegionWorkerClientV3({
      postMessage: (message) => worker.postMessage(message),
      terminate: () => worker.terminate(),
      subscribe: (receive, fail) => {
        worker.onmessage = (event) => receive(event.data)
        worker.onerror = (event) => fail(new Error(event.message || 'CPU 区域 Worker 异常'))
        worker.onmessageerror = () => fail(new Error('CPU 区域 Worker 消息反序列化失败'))
      },
    })
    cpuWorkers[index] = client
    return client
  }
  let completed = 0
  let diffusionAnalysisSet: Awaited<ReturnType<typeof buildImageEditorV3DiffusionAnalyses>> | null = null
  let glowAnalysisSet: Awaited<ReturnType<typeof buildImageEditorV3VgpuGlowAnalyses>> | null = null
  let fastBlurAnalysisSet: Awaited<ReturnType<typeof buildImageEditorV3FastBlurAnalyses>> | null = null
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
      backend: useCpuWorkers ? 'cpu-worker' : 'cpu-inline',
      maximumWorkerConcurrency: useCpuWorkers ? workerConcurrency : 0,
      halo: plan.nodes.reduce((total, node) => (
        total + Math.max(0, Math.ceil(registry.get(node.definitionId)?.localHalo?.(node.parameters, 0) ?? 0))
      ), 0),
    },
  })
  try {
    throwIfAborted(controller.signal)
    const sourceSizes = await readImageEditorRenderSourceSizesV3(plan, controller.signal, dependencies)
    const sparseRasterPlan = createImageEditorV3SparseRasterPlan(plan, document.geometry, request.resourceDescriptors, sourceSizes)
    const resolveSamplingGrid = await prepareImageEditorExportSourceGeometryV3(
      plan, document.geometry, 0, controller.signal, dependencies,
    )
    diffusionAnalysisSet = await buildImageEditorV3DiffusionAnalyses(
      document,
      plan,
      controller.signal,
      dependencies,
      budget,
      sparseMaskPlan,
      sparseRasterPlan,
    )
    const diffusionAnalyses = diffusionAnalysisSet.analyses
    glowAnalysisSet = await buildImageEditorV3VgpuGlowAnalyses(
      document,
      plan,
      controller.signal,
      dependencies,
      budget,
      sparseMaskPlan,
      sparseRasterPlan,
      diffusionAnalyses,
    )
    fastBlurAnalysisSet = await buildImageEditorV3FastBlurAnalyses(
      document,
      plan,
      controller.signal,
      dependencies,
      budget,
      sparseMaskPlan,
      sparseRasterPlan,
      diffusionAnalyses,
      glowAnalysisSet,
    )
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
          lane: plan.nodes.some((node) => node.definitionId === 'effect.vgpu-glow')
            ? 'gpu'
            : 'cpu',
          priority: IMAGE_EDIT_RENDER_PRIORITY.export,
          run: async (taskContext) => {
            const samplingContext = { registry, size: { width: geometry.sourceWidth, height: geometry.sourceHeight }, resolveSamplingGrid }
            const workerOutput = { rect: outputRect, geometry, description: request.description }
            let parts = splitImageEditCpuOutputV3(workerOutput, useCpuWorkers ? workerConcurrency : 1)
            const workingBytes = () => parts.reduce((bytes, part) => bytes + safeWorkingSetBytes(
              collectImageEditCpuRegionRequirementsV3(plan, [part.region], samplingContext), part.region,
            ), 0) * (useCpuWorkers ? 2 : 1)
            // 并发仅消耗预算，不限制产品数量；压力下减少到两个或一个区域。
            if (!budget.admission('in-flight', workingBytes()).admitted && parts.length > 1) {
              parts = splitImageEditCpuOutputV3(workerOutput, 2)
            }
            if (!budget.admission('in-flight', workingBytes()).admitted && parts.length > 1) {
              parts = splitImageEditCpuOutputV3(workerOutput, 1)
            }
            const workingLease = acquireOrThrow(budget, 'in-flight', workingBytes())
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
              const renderContext: ImageEditCpuRegionRenderContextV3 = {
                size: { width: geometry.sourceWidth, height: geometry.sourceHeight },
                registry,
                signal: taskContext.signal,
                resolveSamplingGrid,
                createTransparent: (region) => transparentRegion(
                  region,
                  document.color.workingSpace,
                  document.color.transferFunction,
                  referenceWhiteNits,
                ),
                loadRaster: (node, region) => loadImageEditorRasterRegionV3({
                  node, region, mip: 0, document, sparsePlan: sparseRasterPlan,
                  signal: taskContext.signal, dependencies, budget, loadSource,
                }),
                rasterizeVectorContent: (node, region) => (
                  dependencies.rasterizeVectorContent ?? rasterizeImageEditorV3ExportVectorContent
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
                  return sparse
                },
                loadColorLut: loadImageColorLutV3,
      executeCustomEffect: async (node, source, mask, region) => {
                  if (node.definitionId === 'effect.fast-blur') {
                    const analysis = fastBlurAnalysisSet?.analyses.get(node.id)
                    if (analysis) {
                      return renderImageEditorV3FastBlurAnalysisRegion(
                        analysis,
                        region,
                        source,
                        mask,
                      )
                    }
                    const radius = node.parameters.radius
                    const mip = node.parameters.mip
                    return applyFastBlurV3(
                      convertFloat32TileColorDomainV3(source, 'linear-light'),
                      {
                        radius: typeof radius === 'number' ? radius : 0,
                        mip: typeof mip === 'number' ? mip : 0,
                      },
                      { mask },
                    )
                  }
                  if (node.definitionId === 'effect.vgpu-glow') {
                    const analysis = glowAnalysisSet?.analyses.get(node.id)
                    if (!analysis || !glowAnalysisSet) {
                      throw new Error(`辉光 Pro 节点缺少共享散射分析：${node.id}`)
                    }
                    return glowAnalysisSet.runtime.render({
                      node,
                      source,
                      mask,
                      region,
                      document,
                      analysis,
                      signal: taskContext.signal,
                    })
                  }
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
                      sourceWidth: region.width,
                      sourceHeight: region.height,
                    },
                  })
                },
              }
              const workerTile = useCpuWorkers ? assembleImageEditCpuOutputV3(await Promise.all(parts.map(
                (part, index) => getCpuWorker(index).render(plan, part.region, renderContext, part.output),
              )).catch(error => {
                // 一个区域失败立即终止其余线程与读取，不能提前归还仍在使用的像素预算。
                cpuWorkers.forEach(worker => worker.dispose())
                scheduler.cancelSession(currentSessionId, error)
                throw error
              }), outputRect, request.description.bitDepth / 8 * 4) : null
              const renderedRegion = workerTile ? null : await executeImageEditCpuRenderRegionPlanV3(plan, sourceRegion, renderContext)
              throwIfAborted(taskContext.signal)
              const outputFloat = workerTile ? null : projectImageEditorV3RenderedRegionToOutput(
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
              const tile = workerTile ?? encodeImageEditorV3RenderedOutputTile(
                outputFloat!,
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
    cpuWorkers.forEach(worker => worker.dispose())
    fastBlurAnalysisSet?.release()
    glowAnalysisSet?.release()
    diffusionAnalysisSet?.release()
    request.signal?.removeEventListener('abort', onAbort)
    scheduler.cancelSession(currentSessionId)
    globalBudgetLease?.release()
  }
}
