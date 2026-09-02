import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  applyDiffusionV4,
  applyFastBlurV3,
  convertFloat32TileColorDomainV3,
  createBuiltInImageEditRenderNodeRegistry,
  createFloat32PremultipliedRgbaTile,
  executeImageEditCpuRenderRegionPlanV3,
  mipSize,
  mixCustomEffectMaskV3,
  resolveFastBlurV3Geometry,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
  type ImageEditDocumentV3,
  type ImageEditMemoryLease,
  type ImageEditRenderPlan,
  type ImageEditRenderPlanNode,
  type ImageEditResourceBudget,
} from '@/core/imageEdit/v3'
import { rasterizeImageEditorV3ExportAnnotations } from './annotations'
import {
  resolveImageEditorV3ExportReferenceWhiteNits,
  resolveImageEditorV3ExportSourceBitDepth,
} from './capabilities'
import type { ImageEditorV3DiffusionAnalysis } from './diffusionAnalysis'
import type {
  ImageEditorV3ExportRenderDependencies,
  ImageEditorV3ExportRenderRegion,
} from './contracts'
import { ImageEditorV3ExportCapabilityError } from './contracts'
import type { ImageEditorV3VgpuGlowAnalysisSet } from './vgpuGlowAnalysis'
import {
  imageEditorV3SourceRegionToMask,
  loadImageEditorV3SourceRegion,
} from './sourceRegion'
import type { ImageEditorSparseMaskPlanV3 } from '../execution/sparseMaskResourcesV3'
import { loadImageEditorV3SparseMaskRegion } from './maskRegion'

export interface ImageEditorV3FastBlurAnalysis {
  readonly tile: Float32PremultipliedRgbaTile
  readonly documentWidth: number
  readonly documentHeight: number
  readonly mip: number
}

export interface ImageEditorV3FastBlurAnalysisSet {
  readonly analyses: ReadonlyMap<string, ImageEditorV3FastBlurAnalysis>
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

function numberParameter(node: ImageEditRenderPlanNode, key: string, fallback: number): number {
  const value = node.parameters[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
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

function analysisMip(document: ImageEditDocumentV3): number {
  const maxEdge = registry.get('effect.fast-blur')?.globalAnalysis?.maxEdge ?? 2_048
  return Math.max(0, Math.ceil(
    Math.log2(Math.max(document.geometry.width, document.geometry.height) / maxEdge),
  ))
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
    if (!node) throw new Error(`模糊全局分析缺少输入节点：${nodeId}`)
    needed.add(nodeId)
    node.inputNodeIds.forEach(visit)
  }
  visit(outputNodeId)
  return {
    ...plan,
    nodes: plan.nodes
      .filter((node) => needed.has(node.id))
      .map((node): ImageEditRenderPlanNode => {
        if (node.definitionId === 'effect.gaussian-blur'
          || node.definitionId === 'effect.fast-blur') {
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
      }),
    passes: [],
    outputNodeId,
    outputHash: byId.get(outputNodeId)?.subtreeHash ?? plan.outputHash,
  }
}

export async function buildImageEditorV3FastBlurAnalyses(
  document: ImageEditDocumentV3,
  plan: ImageEditRenderPlan,
  signal: AbortSignal,
  dependencies: ImageEditorV3ExportRenderDependencies,
  budget: ImageEditResourceBudget,
  sparseMaskPlan: ImageEditorSparseMaskPlanV3,
  diffusionAnalyses: ReadonlyMap<string, ImageEditorV3DiffusionAnalysis>,
  glowAnalysisSet: ImageEditorV3VgpuGlowAnalysisSet,
): Promise<ImageEditorV3FastBlurAnalysisSet> {
  const nodes = plan.nodes.filter((node) => (
    node.definitionId === 'effect.fast-blur'
      && resolveFastBlurV3Geometry({ radius: numberParameter(node, 'radius', 0), mip: 0 })
        .requiresGlobalAnalysis
  ))
  if (nodes.length === 0) return { analyses: new Map(), release: () => undefined }
  const mip = analysisMip(document)
  const size = mipSize(document.geometry, mip)
  const region: ImageEditorV3ExportRenderRegion = { x: 0, y: 0, ...size }
  const sourceBitDepth = resolveImageEditorV3ExportSourceBitDepth(document)
  const referenceWhiteNits = resolveImageEditorV3ExportReferenceWhiteNits(document)
  const analyses = new Map<string, ImageEditorV3FastBlurAnalysis>()
  const cacheLeases: ImageEditMemoryLease[] = []

  try {
    for (const blurNode of nodes) {
      if (signal.aborted) throw signal.reason
      const inputNodeId = blurNode.inputNodeIds[0]
      if (!inputNodeId) throw new Error(`模糊节点缺少输入：${blurNode.id}`)
      const prefix = dependencyPlan(plan, inputNodeId, mip)
      const peakBytes = size.width * size.height * 16 * Math.max(4, prefix.nodes.length + 4)
      const peakLease = budget.acquire('in-flight', peakBytes)
      if (!peakLease) {
        throw new ImageEditorV3ExportCapabilityError(
          'WORKING_SET_EXCEEDED',
          `模糊共享分析需要 ${Math.ceil(peakBytes / 1024 / 1024)}MiB 工作集，资源账本已拒绝`,
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
          loadRaster: async (node, requestedRegion) => {
            const resourceId = rasterResourceId(node)
            return resourceId ? loadSource(resourceId, requestedRegion) : transparentRegion(requestedRegion, document)
          },
          rasterizeAnnotations: (node, requestedRegion) => (
            dependencies.rasterizeAnnotations ?? rasterizeImageEditorV3ExportAnnotations
          )({ node, document, region: requestedRegion, mip, signal }),
          loadMask: async (reference, _node, requestedRegion) => {
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
          executeCustomEffect: async (node, source, mask, effectRegion) => {
            if (node.definitionId === 'effect.fast-blur') {
              const analysis = analyses.get(node.id)
              if (analysis) {
                return renderImageEditorV3FastBlurAnalysisRegion(
                  analysis,
                  {
                    x: effectRegion.x * (2 ** mip),
                    y: effectRegion.y * (2 ** mip),
                    width: effectRegion.width * (2 ** mip),
                    height: effectRegion.height * (2 ** mip),
                  },
                  source,
                  mask,
                )
              }
              return applyFastBlurV3(convertFloat32TileColorDomainV3(source, 'linear-light'), {
                radius: numberParameter(node, 'radius', 0),
                mip: numberParameter(node, 'mip', mip),
              }, { mask })
            }
            if (node.definitionId === 'effect.diffusion') {
              const analysis = diffusionAnalyses.get(node.id)
              if (!analysis) throw new Error(`模糊分析前缀缺少柔光共享分析：${node.id}`)
              const recipe = DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(
                DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(node.parameters),
                { width: document.geometry.width, height: document.geometry.height, quality: 'high' },
              )
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
            if (node.definitionId === 'effect.vgpu-glow') {
              const analysis = glowAnalysisSet.analyses.get(node.id)
              if (!analysis) throw new Error(`模糊分析前缀缺少辉光共享分析：${node.id}`)
              return glowAnalysisSet.runtime.render({
                node,
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
            throw new Error(`模糊分析前缀包含不受支持的自定义效果：${node.definitionId}`)
          },
        })
        if (!input) throw new Error(`模糊全局分析无法求值输入：${blurNode.id}`)
        const blurred = applyFastBlurV3(convertFloat32TileColorDomainV3(input, 'linear-light'), {
          radius: numberParameter(blurNode, 'radius', 0),
          mip,
        })
        const cacheLease = budget.acquire('cpu-cache', blurred.data.byteLength)
        if (!cacheLease) {
          throw new ImageEditorV3ExportCapabilityError(
            'WORKING_SET_EXCEEDED',
            '模糊共享分析缓存超过统一资源账本上限',
          )
        }
        cacheLeases.push(cacheLease)
        analyses.set(blurNode.id, {
          tile: blurred,
          documentWidth: document.geometry.width,
          documentHeight: document.geometry.height,
          mip,
        })
      } finally {
        peakLease.release()
      }
    }
    return {
      analyses,
      release: () => cacheLeases.forEach((lease) => lease.release()),
    }
  } catch (error) {
    cacheLeases.forEach((lease) => lease.release())
    throw error
  }
}

export function renderImageEditorV3FastBlurAnalysisRegion(
  analysis: ImageEditorV3FastBlurAnalysis,
  region: ImageEditorV3ExportRenderRegion,
  source: Float32PremultipliedRgbaTile,
  mask?: Float32MaskTile,
): Float32PremultipliedRgbaTile {
  const data = new Float32Array(source.width * source.height * 4)
  const tile = analysis.tile
  for (let y = 0; y < source.height; y += 1) {
    const documentY = region.y + (y + 0.5) * region.height / source.height
    const sampleY = documentY * tile.height / analysis.documentHeight - 0.5
    const y0 = clamp(Math.floor(sampleY), 0, tile.height - 1)
    const y1 = clamp(y0 + 1, 0, tile.height - 1)
    const fy = sampleY - Math.floor(sampleY)
    for (let x = 0; x < source.width; x += 1) {
      const documentX = region.x + (x + 0.5) * region.width / source.width
      const sampleX = documentX * tile.width / analysis.documentWidth - 0.5
      const x0 = clamp(Math.floor(sampleX), 0, tile.width - 1)
      const x1 = clamp(x0 + 1, 0, tile.width - 1)
      const fx = sampleX - Math.floor(sampleX)
      const targetOffset = (y * source.width + x) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        const top = tile.data[(y0 * tile.width + x0) * 4 + channel] * (1 - fx)
          + tile.data[(y0 * tile.width + x1) * 4 + channel] * fx
        const bottom = tile.data[(y1 * tile.width + x0) * 4 + channel] * (1 - fx)
          + tile.data[(y1 * tile.width + x1) * 4 + channel] * fx
        data[targetOffset + channel] = top * (1 - fy) + bottom * fy
      }
    }
  }
  const processed = createFloat32PremultipliedRgbaTile(
    source.width,
    source.height,
    'linear-light',
    data,
    source.workingSpace,
    source.transferFunction,
    source.referenceWhiteNits,
  )
  return mixCustomEffectMaskV3(source, processed, mask)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
