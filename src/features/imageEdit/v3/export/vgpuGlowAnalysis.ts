import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  VGPU_GLOW_V4_RECIPE_ADAPTER,
  applyDiffusionV4,
  applyFastBlurV3,
  convertFloat32TileColorDomainV3,
  createBuiltInImageEditRenderNodeRegistry,
  createFloat32PremultipliedRgbaTile,
  executeImageEditCpuRenderRegionPlanV3,
  mipSize,
  mixCustomEffectMaskV3,
  type Float32PremultipliedRgbaTile,
  type ImageEditDocumentV3,
  type ImageEditMemoryLease,
  type ImageEditRenderPlan,
  type ImageEditRenderPlanNode,
  type ImageEditResourceBudget,
} from '@/core/imageEdit/v3'
import { WorkerWebGpuRuntimeBackend } from '@/core/imageEdit/worker/webgpuRuntimeBackend'
import type { VgpuGlowGlobalScatter } from '@/core/imageEdit/webgpu/vgpuGlowRenderer'
import { rasterizeImageEditorV3ExportAnnotations } from './annotations'
import {
  resolveImageEditorV3ExportReferenceWhiteNits,
  resolveImageEditorV3ExportSourceBitDepth,
} from './capabilities'
import type {
  ImageEditorV3DiffusionAnalysis,
} from './diffusionAnalysis'
import type {
  ImageEditorV3ExportRenderDependencies,
  ImageEditorV3ExportRenderRegion,
  ImageEditorV3VgpuGlowAnalysisHandle,
  ImageEditorV3VgpuGlowRuntime,
} from './contracts'
import { ImageEditorV3ExportCapabilityError } from './contracts'
import {
  imageEditorV3SourceRegionToMask,
  loadImageEditorV3SourceRegion,
} from './sourceRegion'
import type { ImageEditorSparseMaskPlanV3 } from '../execution/sparseMaskResourcesV3'
import { loadImageEditorV3SparseMaskRegion } from './maskRegion'
import {
  linearPreviewTileToBitmapV3,
  previewBitmapToLinearTileV3,
} from '../execution/previewPixelsV3'

export interface ImageEditorV3VgpuGlowAnalysisSet {
  readonly analyses: ReadonlyMap<string, ImageEditorV3VgpuGlowAnalysisHandle>
  readonly runtime: ImageEditorV3VgpuGlowRuntime
  release(): void
}

const registry = createBuiltInImageEditRenderNodeRegistry()

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
  document: ImageEditDocumentV3,
): Float32PremultipliedRgbaTile {
  return createFloat32PremultipliedRgbaTile(
    region.width,
    region.height,
    'linear-light',
    new Float32Array(region.width * region.height * 4),
    document.color.workingSpace,
    document.color.transferFunction,
    resolveImageEditorV3ExportReferenceWhiteNits(document),
  )
}

function dependencyPlan(
  plan: ImageEditRenderPlan,
  outputNodeId: string,
  mip: number,
): ImageEditRenderPlan {
  const byId = new Map(plan.nodes.map((node) => [node.id, node]))
  const needed = new Set<string>()
  const visit = (nodeId: string): void => {
    if (needed.has(nodeId)) return
    const node = byId.get(nodeId)
    if (!node) throw new Error(`辉光 Pro 全局分析缺少输入节点：${nodeId}`)
    needed.add(nodeId)
    node.inputNodeIds.forEach(visit)
  }
  visit(outputNodeId)
  return {
    ...plan,
    nodes: plan.nodes
      .filter((node) => needed.has(node.id))
      .map((node) => node.definitionId === 'effect.gaussian-blur'
        || node.definitionId === 'effect.fast-blur'
        ? { ...node, parameters: { ...node.parameters, mip } }
        : node),
    passes: [],
    outputNodeId,
    outputHash: byId.get(outputNodeId)?.subtreeHash ?? plan.outputHash,
  }
}

class DefaultGlowAnalysisHandle implements ImageEditorV3VgpuGlowAnalysisHandle {
  constructor(readonly scatter: VgpuGlowGlobalScatter) {}
  release(): void {
    this.scatter.release()
  }
}

class DefaultVgpuGlowRuntime implements ImageEditorV3VgpuGlowRuntime {
  private readonly backend = new WorkerWebGpuRuntimeBackend()

  async buildAnalysis({
    node,
    source,
    document,
    signal,
  }: Parameters<ImageEditorV3VgpuGlowRuntime['buildAnalysis']>[0]): Promise<ImageEditorV3VgpuGlowAnalysisHandle> {
    this.assertReleaseColorMode(document)
    const bitmap = await linearPreviewTileToBitmapV3(source)
    try {
      const state = await this.backend.ensureState()
      const parameters = VGPU_GLOW_V4_RECIPE_ADAPTER.parseParameters(node.parameters)
      const recipe = VGPU_GLOW_V4_RECIPE_ADAPTER.compileRecipe(parameters, {
        width: source.width,
        height: source.height,
      })
      return new DefaultGlowAnalysisHandle(await this.backend.buildVgpuGlowGlobalScatter(
        state,
        bitmap,
        source.width,
        source.height,
        recipe,
        () => signal.aborted,
      ))
    } finally {
      bitmap.close()
    }
  }

  async render({
    node,
    source,
    mask,
    region,
    document,
    analysis,
    signal,
  }: Parameters<ImageEditorV3VgpuGlowRuntime['render']>[0]): Promise<Float32PremultipliedRgbaTile> {
    this.assertReleaseColorMode(document)
    if (!(analysis instanceof DefaultGlowAnalysisHandle)) {
      throw new Error('辉光 Pro 分块导出收到不匹配的全局分析结果')
    }
    const bitmap = await linearPreviewTileToBitmapV3(source)
    let rendered: ImageBitmap | null = null
    try {
      const state = await this.backend.ensureState()
      const parameters = VGPU_GLOW_V4_RECIPE_ADAPTER.parseParameters(node.parameters)
      const recipe = VGPU_GLOW_V4_RECIPE_ADAPTER.compileRecipe(parameters, {
        width: document.geometry.width,
        height: document.geometry.height,
      })
      rendered = await this.backend.renderVgpuGlowBitmap(
        state,
        bitmap,
        source.width,
        source.height,
        recipe,
        () => signal.aborted,
        {
          global: analysis.scatter,
          region: [
            region.x / document.geometry.width,
            region.y / document.geometry.height,
            region.width / document.geometry.width,
            region.height / document.geometry.height,
          ],
        },
      )
      return mixCustomEffectMaskV3(source, await previewBitmapToLinearTileV3(rendered), mask)
    } finally {
      rendered?.close()
      bitmap.close()
    }
  }

  dispose(): void {
    this.backend.destroy()
  }

  private assertReleaseColorMode(document: ImageEditDocumentV3): void {
    if (document.color.bitDepth !== 8
      || document.color.workingSpace !== 'srgb'
      || document.color.transferFunction !== 'srgb'
      || document.color.hdrMetadata !== null) {
      throw new ImageEditorV3ExportCapabilityError(
        'COLOR_CONTRACT_MISMATCH',
        '辉光 Pro 当前只支持 8 位 sRGB 文档导出',
      )
    }
  }
}

function analysisMip(document: ImageEditDocumentV3): number {
  const maxEdge = registry.get('effect.vgpu-glow')?.globalAnalysis?.maxEdge ?? 1_024
  return Math.max(0, Math.ceil(
    Math.log2(Math.max(document.geometry.width, document.geometry.height) / maxEdge),
  ))
}

export async function buildImageEditorV3VgpuGlowAnalyses(
  document: ImageEditDocumentV3,
  plan: ImageEditRenderPlan,
  signal: AbortSignal,
  dependencies: ImageEditorV3ExportRenderDependencies,
  budget: ImageEditResourceBudget,
  sparseMaskPlan: ImageEditorSparseMaskPlanV3,
  diffusionAnalyses: ReadonlyMap<string, ImageEditorV3DiffusionAnalysis>,
): Promise<ImageEditorV3VgpuGlowAnalysisSet> {
  const nodes = plan.nodes.filter((node) => node.definitionId === 'effect.vgpu-glow')
  const runtime = dependencies.createVgpuGlowRuntime?.() ?? new DefaultVgpuGlowRuntime()
  if (nodes.length === 0) {
    return { analyses: new Map(), runtime, release: () => runtime.dispose() }
  }
  const mip = analysisMip(document)
  const size = mipSize(document.geometry, mip)
  const region: ImageEditorV3ExportRenderRegion = { x: 0, y: 0, ...size }
  const sourceBitDepth = resolveImageEditorV3ExportSourceBitDepth(document)
  const referenceWhiteNits = resolveImageEditorV3ExportReferenceWhiteNits(document)
  const analyses = new Map<string, ImageEditorV3VgpuGlowAnalysisHandle>()
  const cacheLeases: ImageEditMemoryLease[] = []

  try {
    for (const node of nodes) {
      if (signal.aborted) throw signal.reason
      const inputNodeId = node.inputNodeIds[0]
      if (!inputNodeId) throw new Error(`辉光 Pro 节点缺少输入：${node.id}`)
      const prefix = dependencyPlan(plan, inputNodeId, mip)
      const peakBytes = size.width * size.height * 16 * Math.max(4, prefix.nodes.length + 4)
      const peakLease = budget.acquire('in-flight', peakBytes)
      if (!peakLease) {
        throw new ImageEditorV3ExportCapabilityError(
          'WORKING_SET_EXCEEDED',
          `辉光 Pro 全局分析需要 ${Math.ceil(peakBytes / 1024 / 1024)}MiB 工作集，资源账本已拒绝`,
        )
      }
      try {
        const sourceCache = new Map<string, Promise<Float32PremultipliedRgbaTile>>()
        const loadSource = (
          resourceId: string,
          requestedRegion: ImageEditorV3ExportRenderRegion,
        ): Promise<Float32PremultipliedRgbaTile> => {
          const key = `${resourceId}:${requestedRegion.x}:${requestedRegion.y}:${requestedRegion.width}:${requestedRegion.height}`
          const cached = sourceCache.get(key)
          if (cached) return cached
          const loaded = loadImageEditorV3SourceRegion(
            resourceId,
            requestedRegion,
            document.geometry,
            sourceBitDepth,
            document.color.workingSpace,
            document.color.transferFunction,
            referenceWhiteNits,
            signal,
            dependencies,
            mip,
          )
          sourceCache.set(key, loaded)
          return loaded
        }
        const input = await executeImageEditCpuRenderRegionPlanV3(prefix, region, {
          size,
          scaleX: 1 / (2 ** mip),
          scaleY: 1 / (2 ** mip),
          registry,
          signal,
          createTransparent: (requestedRegion) => transparentRegion(requestedRegion, document),
          loadRaster: async (sourceNode, requestedRegion) => {
            const resourceId = rasterResourceId(sourceNode)
            return resourceId
              ? loadSource(resourceId, requestedRegion)
              : transparentRegion(requestedRegion, document)
          },
          rasterizeAnnotations: (annotationNode, requestedRegion) => (
            dependencies.rasterizeAnnotations ?? rasterizeImageEditorV3ExportAnnotations
          )({ node: annotationNode, document, region: requestedRegion, mip, signal }),
          loadMask: async (reference, _maskNode, requestedRegion) => {
            const sparse = await loadImageEditorV3SparseMaskRegion(
              reference,
              requestedRegion,
              mip,
              sparseMaskPlan,
              signal,
              dependencies,
              budget,
            )
            if (sparse) return sparse
            if (!('resourceId' in reference)) throw new Error('蒙版引用缺少资源 ID')
            return imageEditorV3SourceRegionToMask(await loadSource(reference.resourceId, requestedRegion))
          },
          executeCustomEffect: async (effectNode, source, mask, effectRegion) => {
            if (effectNode.definitionId === 'effect.fast-blur') {
              const radius = effectNode.parameters.radius
              const nodeMip = effectNode.parameters.mip
              return applyFastBlurV3(convertFloat32TileColorDomainV3(source, 'linear-light'), {
                radius: typeof radius === 'number' ? radius : 0,
                mip: typeof nodeMip === 'number' ? nodeMip : mip,
              }, { mask })
            }
            if (effectNode.definitionId === 'effect.diffusion') {
              const analysis = diffusionAnalyses.get(effectNode.id)
              if (!analysis) throw new Error(`辉光分析前缀缺少柔光共享分析：${effectNode.id}`)
              const parameters = DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(effectNode.parameters)
              const recipe = DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(parameters, {
                width: document.geometry.width,
                height: document.geometry.height,
                quality: 'high',
              })
              return applyDiffusionV4(convertFloat32TileColorDomainV3(source, 'linear-light'), recipe, {
                mask,
                globalScatter: {
                  tile: analysis.scatter,
                  documentWidth: document.geometry.width,
                  documentHeight: document.geometry.height,
                  sourceX: effectRegion.x * (2 ** mip),
                  sourceY: effectRegion.y * (2 ** mip),
                },
              })
            }
            if (effectNode.definitionId === 'effect.vgpu-glow') {
              const analysis = analyses.get(effectNode.id)
              if (!analysis) throw new Error(`辉光分析前缀缺少共享分析：${effectNode.id}`)
              return runtime.render({
                node: effectNode,
                source,
                mask,
                region: {
                  x: effectRegion.x * (2 ** mip),
                  y: effectRegion.y * (2 ** mip),
                  width: effectRegion.width * (2 ** mip),
                  height: effectRegion.height * (2 ** mip),
                },
                document,
                analysis,
                signal,
              })
            }
            throw new Error(`辉光分析前缀包含不受支持的自定义效果：${effectNode.definitionId}`)
          },
        })
        if (!input) throw new Error(`辉光 Pro 全局分析无法求值输入：${node.id}`)
        const analysis = await runtime.buildAnalysis({ node, source: input, document, signal })
        const cacheLease = budget.acquire('gpu', size.width * size.height * 16)
        if (!cacheLease) {
          analysis.release()
          throw new ImageEditorV3ExportCapabilityError(
            'WORKING_SET_EXCEEDED',
            '辉光 Pro 全局分析缓存超过统一资源账本上限',
          )
        }
        analyses.set(node.id, analysis)
        cacheLeases.push(cacheLease)
      } finally {
        peakLease.release()
      }
    }
    return {
      analyses,
      runtime,
      release: () => {
        analyses.forEach((analysis) => analysis.release())
        cacheLeases.forEach((lease) => lease.release())
        runtime.dispose()
      },
    }
  } catch (error) {
    analyses.forEach((analysis) => analysis.release())
    cacheLeases.forEach((lease) => lease.release())
    runtime.dispose()
    throw error
  }
}
