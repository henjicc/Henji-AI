import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  applyDiffusionV4,
  buildDiffusionScatterV4,
  convertFloat32TileColorDomainV3,
  createBuiltInImageEditRenderNodeRegistry,
  createFloat32PremultipliedRgbaTile,
  executeImageEditCpuRenderPlanV3,
  mipSize,
  type Float32PremultipliedRgbaTile,
  type ImageEditDocumentV3,
  type ImageEditMemoryLease,
  type ImageEditRenderPlan,
  type ImageEditRenderPlanNode,
  type ImageEditResourceBudget,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3RasterExportDescription } from '@/platform/contracts/imageEditorV3'
import { rasterizeImageEditorV3ExportAnnotations } from './annotations'
import type {
  ImageEditorV3ExportRenderDependencies,
  ImageEditorV3ExportRenderRegion,
} from './contracts'
import { ImageEditorV3ExportCapabilityError } from './contracts'
import {
  imageEditorV3SourceRegionToMask,
  loadImageEditorV3SourceRegion,
} from './sourceRegion'

export interface ImageEditorV3DiffusionAnalysis {
  readonly scatter: Float32PremultipliedRgbaTile
  readonly documentWidth: number
  readonly documentHeight: number
}

export interface ImageEditorV3DiffusionAnalysisSet {
  readonly analyses: ReadonlyMap<string, ImageEditorV3DiffusionAnalysis>
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
    203,
  )
}

function analysisMip(document: ImageEditDocumentV3): number {
  const maxEdge = registry.get('effect.diffusion')?.globalAnalysis?.maxEdge ?? 2_048
  const edge = Math.max(document.geometry.width, document.geometry.height)
  return Math.max(0, Math.ceil(Math.log2(edge / maxEdge)))
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
    if (!node) throw new Error(`柔光全局分析缺少输入节点：${nodeId}`)
    needed.add(nodeId)
    for (const input of node.inputNodeIds) visit(input)
  }
  visit(outputNodeId)
  const nodes = plan.nodes
    .filter((node) => needed.has(node.id))
    .map((node): ImageEditRenderPlanNode => {
      if (node.definitionId === 'effect.gaussian-blur') {
        return { ...node, parameters: { ...node.parameters, mip } }
      }
      if (node.definitionId === 'effect.blur-v1') {
        const radius = node.parameters.radiusPixels
        return {
          ...node,
          parameters: {
            ...node.parameters,
            radiusPixels: typeof radius === 'number' ? radius / (2 ** mip) : radius,
          },
        }
      }
      return node
    })
  return {
    ...plan,
    nodes,
    passes: [],
    outputNodeId,
    outputHash: byId.get(outputNodeId)?.subtreeHash ?? plan.outputHash,
  }
}

/**
 * 每个 diffusion 节点先在受限 mip 上求出它真实输入的共享散射。
 * 代理直接读取源金字塔，不创建原图尺寸 Canvas 或完整 RGBA 数组。
 */
export async function buildImageEditorV3DiffusionAnalyses(
  document: ImageEditDocumentV3,
  plan: ImageEditRenderPlan,
  description: ImageEditorV3RasterExportDescription,
  signal: AbortSignal,
  dependencies: ImageEditorV3ExportRenderDependencies,
  budget: ImageEditResourceBudget,
): Promise<ImageEditorV3DiffusionAnalysisSet> {
  const diffusionNodes = plan.nodes.filter((node) => node.definitionId === 'effect.diffusion')
  if (diffusionNodes.length === 0) return { analyses: new Map(), release: () => undefined }
  const mip = analysisMip(document)
  const size = mipSize(document.geometry, mip)
  const region: ImageEditorV3ExportRenderRegion = { x: 0, y: 0, ...size }
  const analyses = new Map<string, ImageEditorV3DiffusionAnalysis>()
  const cacheLeases: ImageEditMemoryLease[] = []

  try {
    for (const diffusionNode of diffusionNodes) {
      if (signal.aborted) throw signal.reason
      const inputNodeId = diffusionNode.inputNodeIds[0]
      if (!inputNodeId) throw new Error(`柔光节点缺少输入：${diffusionNode.id}`)
      const prefix = dependencyPlan(plan, inputNodeId, mip)
      const peakBytes = size.width * size.height * 16 * Math.max(4, prefix.nodes.length + 4)
      const peakLease = budget.acquire('in-flight', peakBytes)
      if (!peakLease) {
        throw new ImageEditorV3ExportCapabilityError(
          'WORKING_SET_EXCEEDED',
          `柔光共享散射分析需要 ${Math.ceil(peakBytes / 1024 / 1024)}MiB 工作集，资源账本已拒绝`,
        )
      }
      try {
        const sourceCache = new Map<string, Promise<Float32PremultipliedRgbaTile>>()
        const loadSource = (resourceId: string): Promise<Float32PremultipliedRgbaTile> => {
          const cached = sourceCache.get(resourceId)
          if (cached) return cached
          const loaded = loadImageEditorV3SourceRegion(
            resourceId,
            region,
            { width: document.geometry.width, height: document.geometry.height },
            description.bitDepth,
            document.color.workingSpace,
            document.color.transferFunction,
            signal,
            dependencies,
            mip,
          )
          sourceCache.set(resourceId, loaded)
          return loaded
        }
        const input = await executeImageEditCpuRenderPlanV3(prefix, {
          signal,
          loadRaster: async (node) => {
            const resourceId = rasterResourceId(node)
            return resourceId ? loadSource(resourceId) : transparentRegion(region, document)
          },
          rasterizeAnnotations: (node) => (
            dependencies.rasterizeAnnotations ?? rasterizeImageEditorV3ExportAnnotations
          )({ node, document, region, mip, signal }),
          loadMask: async (reference) => imageEditorV3SourceRegionToMask(
            await loadSource(reference.resourceId),
          ),
          executeCustomEffect: async (node, source, mask) => {
            if (node.definitionId !== 'effect.diffusion') {
              throw new Error(`柔光分析前缀包含不受支持的自定义效果：${node.definitionId}`)
            }
            const linear = convertFloat32TileColorDomainV3(source, 'linear-light')
            const parameters = DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(node.parameters)
            const recipe = DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(parameters, {
              width: size.width,
              height: size.height,
              quality: 'high',
            })
            return applyDiffusionV4(linear, recipe, { mask })
          },
        })
        if (!input) throw new Error(`柔光全局分析无法求值输入：${diffusionNode.id}`)
        const linear = convertFloat32TileColorDomainV3(input, 'linear-light')
        const parameters = DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(diffusionNode.parameters)
        const recipe = DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(parameters, {
          width: size.width,
          height: size.height,
          quality: 'high',
        })
        const scatter = buildDiffusionScatterV4(linear, recipe)
        const cacheLease = budget.acquire('cpu-cache', scatter.data.byteLength)
        if (!cacheLease) {
          throw new ImageEditorV3ExportCapabilityError(
            'WORKING_SET_EXCEEDED',
            '柔光共享散射缓存超过统一资源账本上限',
          )
        }
        cacheLeases.push(cacheLease)
        analyses.set(diffusionNode.id, {
          scatter,
          documentWidth: document.geometry.width,
          documentHeight: document.geometry.height,
        })
      } finally {
        peakLease.release()
      }
    }
    return {
      analyses,
      release: () => {
        for (const lease of cacheLeases) lease.release()
      },
    }
  } catch (error) {
    for (const lease of cacheLeases) lease.release()
    throw error
  }
}
