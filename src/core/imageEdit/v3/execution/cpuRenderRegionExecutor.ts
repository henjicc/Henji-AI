import {
  createFloat32MaskTile,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
} from '../effects/contracts'
import type { ImageEditMaskReferenceV3 } from '../layerTypes'
import type { ImageEditRenderPlan, ImageEditRenderPlanNode } from '../renderPlan'
import type { ImageEditRenderNodeRegistry } from '../renderNodeDefinition'
import type { ImageEditRect, ImageEditSize } from '../tileGeometry'
import { resolveGaussianBlurV2Geometry } from '../effects/gaussianBlur'
import {
  applyContentMaskAndOpacityV3,
  compositePremultipliedTilesV3,
  mixEffectLayerV3,
} from './tileBlend'
import {
  convertFloat32TileColorDomainV3,
  convertFloat32TileWorkingSpaceV3,
} from './tileColor'
import {
  cropImageEditRgbaRegionV3,
  expandImageEditRectV3,
  isImageEditTransformInvertibleV3,
  resampleImageEditMaskAffineV3,
  resampleImageEditRgbaAffineV3,
  resolveImageEditInverseSourceRectV3,
  scaleImageEditTransformV3,
} from './affineTransform'
import {
  executeImageEditCpuAdjustmentNodeV3,
  executeImageEditCpuEffectNodeV3,
  imageEditCpuRenderNodeBlendModeV3,
} from './cpuRenderPlanExecutor'

export interface ImageEditCpuRegionRenderContextV3 {
  size: ImageEditSize
  /** 文档坐标到当前求值坐标的比例；mip 0 为 1。 */
  scaleX?: number
  scaleY?: number
  registry: ImageEditRenderNodeRegistry
  createTransparent(region: ImageEditRect): Float32PremultipliedRgbaTile
  loadRaster(
    node: ImageEditRenderPlanNode,
    region: ImageEditRect,
  ): Promise<Float32PremultipliedRgbaTile>
  rasterizeAnnotations(
    node: ImageEditRenderPlanNode,
    region: ImageEditRect,
  ): Promise<Float32PremultipliedRgbaTile>
  loadMask(
    reference: ImageEditMaskReferenceV3,
    node: ImageEditRenderPlanNode,
    region: ImageEditRect,
  ): Promise<Float32MaskTile>
  executeCustomEffect?(
    node: ImageEditRenderPlanNode,
    source: Float32PremultipliedRgbaTile,
    mask: Float32MaskTile | undefined,
    region: ImageEditRect,
  ): Promise<Float32PremultipliedRgbaTile>
  signal?: AbortSignal
}

export interface ImageEditCpuRegionRequirementsV3 {
  /** render node id → 它需要的源坐标区域。 */
  rasterRegions: ReadonlyMap<string, readonly ImageEditRect[]>
  /** 持有蒙版的 render node id → 蒙版本地坐标区域。 */
  maskRegions: ReadonlyMap<string, readonly ImageEditRect[]>
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = signal.reason instanceof Error ? signal.reason : new Error('图片分区渲染已取消')
  if (error.name === 'Error') error.name = 'AbortError'
  throw error
}

function numberParameter(node: ImageEditRenderPlanNode, key: string, fallback: number): number {
  const value = node.parameters[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function regionKey(region: ImageEditRect): string {
  return `${region.x}:${region.y}:${region.width}:${region.height}`
}

function validateRegion(region: ImageEditRect, size: ImageEditSize): void {
  if (![region.x, region.y, region.width, region.height].every(Number.isSafeInteger)
    || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
    || region.x + region.width > size.width || region.y + region.height > size.height) {
    throw new Error('图片分区渲染范围无效')
  }
}

function isIdentityTransform(value: unknown): value is readonly number[] {
  return Array.isArray(value)
    && value.length === 6
    && value.every((entry, index) => entry === [1, 0, 0, 1, 0, 0][index])
}

function nodeTransform(
  node: ImageEditRenderPlanNode,
  scaleX: number,
  scaleY: number,
): readonly number[] {
  const transform = node.parameters.transform
  if (!Array.isArray(transform) || !isImageEditTransformInvertibleV3(transform)) {
    throw new Error(`图层变换矩阵不可逆：${node.layerId}`)
  }
  return scaleImageEditTransformV3(transform, scaleX, scaleY)
}

function invertMask(mask: Float32MaskTile): Float32MaskTile {
  const data = new Float32Array(mask.data.length)
  for (let index = 0; index < data.length; index += 1) data[index] = 1 - mask.data[index]
  return createFloat32MaskTile(mask.width, mask.height, data)
}

function nodeMap(plan: ImageEditRenderPlan): ReadonlyMap<string, ImageEditRenderPlanNode> {
  return new Map(plan.nodes.map((node) => [node.id, node]))
}

function inputNode(
  nodes: ReadonlyMap<string, ImageEditRenderPlanNode>,
  node: ImageEditRenderPlanNode,
  index: number,
): ImageEditRenderPlanNode {
  const id = node.inputNodeIds[index]
  const input = id ? nodes.get(id) : null
  if (!input) throw new Error(`渲染节点缺少输入：${node.id}`)
  return input
}

function effectInputRegion(
  node: ImageEditRenderPlanNode,
  outputRegion: ImageEditRect,
  context: Pick<
    ImageEditCpuRegionRenderContextV3,
    'registry' | 'size' | 'scaleX' | 'scaleY'
  >,
): ImageEditRect {
  const definition = context.registry.get(node.definitionId)
  const scale = Math.min(context.scaleX ?? 1, context.scaleY ?? context.scaleX ?? 1)
  const contextMip = Math.max(0, Math.log2(1 / scale))
  const parameterMip = node.parameters.mip
  const mip = node.definitionId === 'effect.blur-v1'
    ? 0
    : typeof parameterMip === 'number' && Number.isFinite(parameterMip)
      ? Math.max(0, parameterMip)
      : contextMip
  const halo = Math.max(0, Math.ceil(definition?.localHalo?.(node.parameters, mip) ?? 0))
  const expanded = halo > 0 ? expandImageEditRectV3(outputRegion, halo, context.size) : outputRegion
  let alignment = 1
  if (node.definitionId === 'effect.gaussian-blur') {
    alignment = 2 ** resolveGaussianBlurV2Geometry({
      radius: numberParameter(node, 'radius', 0),
      mip,
    }).pyramidLevel
  } else if (node.definitionId === 'effect.blur-v1') {
    alignment = 2 ** resolveGaussianBlurV2Geometry({
      radius: Math.min(120, Math.max(0, numberParameter(node, 'radiusPixels', 0))),
      mip: 0,
    }).pyramidLevel
  }
  if (alignment <= 1) return expanded
  const left = Math.max(0, Math.floor(expanded.x / alignment) * alignment)
  const top = Math.max(0, Math.floor(expanded.y / alignment) * alignment)
  const right = Math.min(
    context.size.width,
    Math.ceil((expanded.x + expanded.width) / alignment) * alignment,
  )
  const bottom = Math.min(
    context.size.height,
    Math.ceil((expanded.y + expanded.height) / alignment) * alignment,
  )
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function transformedContentRegion(
  node: ImageEditRenderPlanNode,
  outputRegion: ImageEditRect,
  context: Pick<ImageEditCpuRegionRenderContextV3, 'size' | 'scaleX' | 'scaleY'>,
): { transform: readonly number[]; region: ImageEditRect } {
  const transform = nodeTransform(node, context.scaleX ?? 1, context.scaleY ?? context.scaleX ?? 1)
  return {
    transform,
    region: isIdentityTransform(transform)
      ? outputRegion
      : resolveImageEditInverseSourceRectV3(outputRegion, transform, context.size),
  }
}

function addRegion(
  target: Map<string, Map<string, ImageEditRect>>,
  nodeId: string,
  region: ImageEditRect,
): void {
  if (region.width === 0 || region.height === 0) return
  const regions = target.get(nodeId) ?? new Map<string, ImageEditRect>()
  regions.set(regionKey(region), region)
  target.set(nodeId, regions)
}

/** 在发起任何像素读取前，反向计划每个源和蒙版实际需要的区域。 */
export function collectImageEditCpuRegionRequirementsV3(
  plan: ImageEditRenderPlan,
  outputRegions: readonly ImageEditRect[],
  context: Pick<
    ImageEditCpuRegionRenderContextV3,
    'registry' | 'size' | 'scaleX' | 'scaleY'
  >,
): ImageEditCpuRegionRequirementsV3 {
  const nodes = nodeMap(plan)
  const rasters = new Map<string, Map<string, ImageEditRect>>()
  const masks = new Map<string, Map<string, ImageEditRect>>()
  const visit = (node: ImageEditRenderPlanNode, region: ImageEditRect): void => {
    if (region.width === 0 || region.height === 0) return
    if (node.definitionId === 'source.raster') {
      addRegion(rasters, node.id, region)
      return
    }
    if (node.definitionId === 'vector.annotation') return
    if (node.definitionId === 'composite.layer') {
      const contentIndex = node.inputNodeIds.length === 1 ? 0 : 1
      if (node.inputNodeIds.length > 1) visit(inputNode(nodes, node, 0), region)
      const transformed = transformedContentRegion(node, region, context)
      if (node.mask) addRegion(masks, node.id, transformed.region)
      visit(inputNode(nodes, node, contentIndex), transformed.region)
      return
    }
    const inputRegion = node.definitionId === 'group.isolated'
      ? region
      : effectInputRegion(node, region, context)
    if (node.mask) addRegion(masks, node.id, inputRegion)
    visit(inputNode(nodes, node, 0), inputRegion)
  }
  const output = plan.outputNodeId ? nodes.get(plan.outputNodeId) : null
  if (output) outputRegions.forEach((region) => visit(output, region))
  const freeze = (source: Map<string, Map<string, ImageEditRect>>): ReadonlyMap<string, readonly ImageEditRect[]> => (
    new Map([...source].map(([id, regions]) => [id, [...regions.values()]]))
  )
  return { rasterRegions: freeze(rasters), maskRegions: freeze(masks) }
}

/**
 * 递归求值 RenderPlan 的一个有界区域。仿射节点先逆算局部源区域，
 * 再以全局像素坐标采样，因此平移、旋转不依赖当前输出瓦片的位置。
 */
export async function executeImageEditCpuRenderRegionPlanV3(
  plan: ImageEditRenderPlan,
  outputRegion: ImageEditRect,
  context: ImageEditCpuRegionRenderContextV3,
): Promise<Float32PremultipliedRgbaTile | null> {
  if (!plan.outputNodeId) return null
  validateRegion(outputRegion, context.size)
  const nodes = nodeMap(plan)
  const memo = new Map<string, Promise<Float32PremultipliedRgbaTile>>()
  const render = (
    node: ImageEditRenderPlanNode,
    region: ImageEditRect,
  ): Promise<Float32PremultipliedRgbaTile> => {
    validateRegion(region, context.size)
    const key = `${node.id}:${regionKey(region)}`
    const cached = memo.get(key)
    if (cached) return cached
    const pending = (async (): Promise<Float32PremultipliedRgbaTile> => {
      throwIfAborted(context.signal)
      if (node.definitionId === 'source.raster') return context.loadRaster(node, region)
      if (node.definitionId === 'vector.annotation') return context.rasterizeAnnotations(node, region)
      if (node.definitionId === 'group.isolated') return render(inputNode(nodes, node, 0), region)
      if (node.definitionId === 'composite.layer') {
        const backdrop = node.inputNodeIds.length > 1
          ? await render(inputNode(nodes, node, 0), region)
          : null
        const contentIndex = node.inputNodeIds.length === 1 ? 0 : 1
        const transformed = transformedContentRegion(node, region, context)
        let content = transformed.region.width > 0 && transformed.region.height > 0
          ? await render(inputNode(nodes, node, contentIndex), transformed.region)
          : context.createTransparent(region)
        let mask: Float32MaskTile | undefined
        if (node.mask && transformed.region.width > 0 && transformed.region.height > 0) {
          mask = await context.loadMask(node.mask, node, transformed.region)
          if (node.mask.inverted) mask = invertMask(mask)
        }
        if (!isIdentityTransform(transformed.transform)) {
          if (transformed.region.width > 0 && transformed.region.height > 0) {
            content = resampleImageEditRgbaAffineV3(
              content,
              transformed.region,
              region,
              transformed.transform,
            )
            if (mask) {
              mask = resampleImageEditMaskAffineV3(
                mask,
                transformed.region,
                region,
                transformed.transform,
              )
            }
          } else {
            content = context.createTransparent(region)
            mask = undefined
          }
        }
        if (backdrop) {
          content = convertFloat32TileWorkingSpaceV3(content, backdrop.workingSpace)
          content = convertFloat32TileColorDomainV3(content, backdrop.colorDomain)
        }
        const masked = applyContentMaskAndOpacityV3(
          content,
          numberParameter(node, 'opacity', 1),
          mask,
        )
        return compositePremultipliedTilesV3(
          backdrop,
          masked,
          imageEditCpuRenderNodeBlendModeV3(node),
        )
      }
      const expanded = effectInputRegion(node, region, context)
      const source = await render(inputNode(nodes, node, 0), expanded)
      let mask = node.mask ? await context.loadMask(node.mask, node, expanded) : undefined
      if (mask && node.mask?.inverted) mask = invertMask(mask)
      const processed = node.definitionId.startsWith('adjustment.')
        ? await executeImageEditCpuAdjustmentNodeV3(node, source, mask)
        : await executeImageEditCpuEffectNodeV3(node, source, mask, {
            executeCustomEffect: context.executeCustomEffect
              ? (effectNode, effectSource, effectMask) => context.executeCustomEffect!(
                  effectNode,
                  effectSource,
                  effectMask,
                  expanded,
                )
              : undefined,
          })
      const original = convertFloat32TileColorDomainV3(source, processed.colorDomain)
      const mixed = mixEffectLayerV3(
        original,
        processed,
        imageEditCpuRenderNodeBlendModeV3(node),
        numberParameter(node, 'opacity', 1),
      )
      return regionKey(expanded) === regionKey(region)
        ? mixed
        : cropImageEditRgbaRegionV3(mixed, expanded, region)
    })()
    memo.set(key, pending)
    return pending
  }
  const output = nodes.get(plan.outputNodeId)
  if (!output) throw new Error('渲染计划输出节点不存在')
  return render(output, outputRegion)
}
