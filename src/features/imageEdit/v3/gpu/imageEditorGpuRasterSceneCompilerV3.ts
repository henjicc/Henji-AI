import { deformationSchema, type Deformation } from '@/core/imaging/transforms';
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
} from '@/core/imageEdit/v3'
import type { ImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import {
  type ImageEditBlendModeV3,
  type ImageEditJsonObjectV3,
  type ImageEditMaskReferenceV3,
  type ImageEditTransformV3,
} from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditRenderPlanNode } from '@/core/imageEdit/v3/renderPlan'
import type { ImageEditorV3PyramidDescriptor, ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'

export interface ImageEditorGpuRasterLayerV3 {
  rasterCanvasSize?: { width: number; height: number }
  layerId: string
  sourceKind: 'raster' | 'vector'
  resourceRef: `sha256:${string}` | null
  deformationLocalTransform?: ImageEditTransformV3
  sourcePyramid?: ImageEditorV3PyramidDescriptor
  contentVersion: string
  sparseTiles: Readonly<Record<string, {
    resourceRef: `sha256:${string}`
    contentVersion: string
    byteLength: number
  }>>
  visible: boolean
  opacity: number
  deformation?: Deformation | null
  deformationTransform?: ImageEditTransformV3
  transform: ImageEditTransformV3
}

export interface ImageEditorGpuGraphMaskV3 {
  maskId: string
  sparseTiles: Readonly<Record<string, {
    resourceRef: `sha256:${string}`
    contentVersion: string
    byteLength: number
  }>>
  defaultValue: 0 | 1
  inverted: boolean
}

interface ImageEditorGpuGraphNodeBaseV3 {
  nodeId: string
  layerId: string
  fingerprint: string
}

export interface ImageEditorGpuGraphSourceNodeV3 extends ImageEditorGpuGraphNodeBaseV3 {
  kind: 'source'
  resourceKey: ImageEditorGpuSceneTileKeyV3 | null
}

export interface ImageEditorGpuGraphCompositeNodeV3 extends ImageEditorGpuGraphNodeBaseV3 {
  kind: 'composite'
  clipping?: boolean
  maskTransform?: ImageEditTransformV3
  maskLinked?: boolean
  maskLocalTransform?: ImageEditTransformV3
  maskDensity?: number
  backdropNodeId: string | null
  contentNodeId: string
  deformation?: Deformation | null
  deformationTransform?: ImageEditTransformV3
  transform: ImageEditTransformV3
  opacity: number
  blendMode: ImageEditBlendModeV3
  mask: ImageEditorGpuGraphMaskV3 | null
}

export interface ImageEditorGpuGraphAdjustmentV3 {
  definitionId: string
  parameters: ImageEditJsonObjectV3
  opacity: number
  blendMode: ImageEditBlendModeV3
  mask: ImageEditorGpuGraphMaskV3 | null
}

export interface ImageEditorGpuGraphAdjustmentNodeV3 extends ImageEditorGpuGraphNodeBaseV3 {
  kind: 'adjustment'
  inputNodeId: string
  adjustments: readonly ImageEditorGpuGraphAdjustmentV3[]
}

export interface ImageEditorGpuGraphEffectNodeV3 extends ImageEditorGpuGraphNodeBaseV3 {
  kind: 'effect'
  inputNodeId: string
  definitionId: string
  parameters: ImageEditJsonObjectV3
  opacity: number
  blendMode: ImageEditBlendModeV3
  mask: ImageEditorGpuGraphMaskV3 | null
}

export interface ImageEditorGpuGraphAliasNodeV3 extends ImageEditorGpuGraphNodeBaseV3 {
  kind: 'alias'
  inputNodeId: string
}

export type ImageEditorGpuRenderGraphNodeV3 =
  | ImageEditorGpuGraphSourceNodeV3
  | ImageEditorGpuGraphCompositeNodeV3
  | ImageEditorGpuGraphAdjustmentNodeV3
  | ImageEditorGpuGraphEffectNodeV3
  | ImageEditorGpuGraphAliasNodeV3

export interface ImageEditorGpuRasterSceneV3 {
  width: number
  height: number
  color: ImageEditColorModeV3
  geometry: ImageEditDocumentV3['geometry']
  layers: readonly ImageEditorGpuRasterLayerV3[]
  graph: readonly ImageEditorGpuRenderGraphNodeV3[]
  outputNodeId: string | null
  outputFingerprint: string
  requiredResourceKeys: readonly ImageEditorGpuSceneTileKeyV3[]
  requiresRenderGraph: boolean
}

export type ImageEditorGpuRasterSceneCompilationV3 =
  | { supported: true; scene: ImageEditorGpuRasterSceneV3 }
  | { supported: false; reason: string }


/**
 * 把 CPU RenderPlan 真值投影为会话 retained GPU RenderGraph。大图 source 仍由
 * 视口 tile planner/atlas 提供；flat normal 允许走同一 compositor 内的快速路径。
 */
export function compileImageEditorGpuRasterSceneV3(
  document: ImageEditDocumentV3,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
  sourcePyramids?: Readonly<Record<string, ImageEditorV3PyramidDescriptor>>,
  quality: ImageEditRenderQuality = 'stable',
): ImageEditorGpuRasterSceneCompilationV3 {
  const descriptors = new Map(resourceDescriptors.map((entry) => [entry.resourceRef, entry]))
  const registry = createBuiltInImageEditRenderNodeRegistry()
  const plan = compileImageEditRenderPlanV3(document, registry, quality)
  if (plan.diagnostics.some((entry) => entry.code !== 'empty-effect-scope')) {
    return { supported: false, reason: plan.diagnostics.map((entry) => entry.message).join('；') }
  }
  if (plan.nodes.some(node => node.definitionId === 'effect.gaussian_blur')
    && (document.geometry.crop !== null || document.geometry.orientation.rotate !== 0 || document.geometry.orientation.mirrored)) {
    return { supported: false, reason: '高斯模糊需要完整源网格，当前裁剪/朝向组合由 CPU 精确执行' }
  }
  const graph: ImageEditorGpuRenderGraphNodeV3[] = []
  const required = new Map<string, ImageEditorGpuSceneTileKeyV3>()
  const planNodeMap = new Map(plan.nodes.map((node) => [node.id, node]))
  const sourceFormat = document.color.bitDepth === 8
    && document.color.transferFunction !== 'pq'
    && document.color.transferFunction !== 'hlg'
    ? 'rgba8unorm' as const : 'rgba16float' as const
  try {
    for (const pass of plan.passes) {
      const nodes = pass.nodeIds.map((id) => planNodeMap.get(id)).filter(isPlanNode)
      if (nodes.length === 0) continue
      if (canFuseGpuAdjustments(nodes)) {
        const last = nodes[nodes.length - 1]
        graph.push({
          kind: 'adjustment', nodeId: last.id, layerId: last.layerId,
          fingerprint: last.subtreeHash, inputNodeId: nodes[0].inputNodeIds[0],
          adjustments: nodes.map((node) => adjustment(node, descriptors, required)),
        })
        continue
      }
      for (const node of nodes) {
        const compiled = compileNode(node, descriptors, required, sourceFormat)
        if (typeof compiled === 'string') return { supported: false, reason: compiled }
        graph.push(compiled)
      }
    }
  } catch (error) {
    return { supported: false, reason: error instanceof Error ? error.message : String(error) }
  }
  const layers: ImageEditorGpuRasterLayerV3[] = []
  const sourceNodes = new Set(graph.filter(node => node.kind === 'source').map(node => node.nodeId))
  for (const node of graph) {
    if (node.kind === 'composite' && !sourceNodes.has(node.contentNodeId)
      && node.transform.some((value, index) => value !== [1, 0, 0, 1, 0, 0][index])) {
      return { supported: false, reason: '组结果的空间变换当前由 CPU 区域求值；GPU 不静默忽略该变换' }
    }
  }
  collectRasterLayers(document.layers, descriptors, plan.nodes, layers)
  if (sourcePyramids) {
    for (const layer of layers) {
      if (layer.sourceKind !== 'raster' || !layer.resourceRef) continue
      const pyramid = sourcePyramids[layer.resourceRef]
      if (!pyramid?.levels.some((level) => level.mip === 0)) {
        return { supported: false, reason: `图层 ${layer.layerId} 缺少权威源金字塔` }
      }
      layer.sourcePyramid = structuredClone(pyramid)
    }
  }
  const requiresRenderGraph = graph.some((node) => (
    node.kind === 'adjustment'
    || node.kind === 'effect'
    || node.kind === 'alias'
    || (node.kind === 'composite' && (node.blendMode !== 'normal' || node.mask !== null || node.clipping || layers.some(layer => layer.deformation)))
  ))
  return {
    supported: true,
    scene: {
      width: document.geometry.width,
      height: document.geometry.height,
      color: structuredClone(document.color),
      geometry: structuredClone(document.geometry),
      layers,
      graph,
      outputNodeId: plan.outputNodeId,
      outputFingerprint: plan.outputHash,
      requiredResourceKeys: [...required.values()],
      requiresRenderGraph,
    },
  }
}

function compileNode(
  node: ImageEditRenderPlanNode,
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
  required: Map<string, ImageEditorGpuSceneTileKeyV3>,
  sourceFormat: 'rgba8unorm' | 'rgba16float',
): ImageEditorGpuRenderGraphNodeV3 | string {
  if (node.definitionId === 'source.raster') {
    const source = node.parameters.source
    const tiles = node.parameters.tiles
    if (!source || typeof source !== 'object' || !('kind' in source)) {
      return `图层 ${node.layerId} 缺少栅格源声明`
    }
    const resourceId = source.kind === 'resource' && 'resourceId' in source
      && typeof source.resourceId === 'string' && isResourceRef(source.resourceId)
      ? source.resourceId : null
    const sparse = compileSparseTiles(tiles, descriptors)
    if (typeof sparse === 'string') return sparse
    if (!resourceId && source.kind !== 'empty' && Object.keys(sparse).length === 0) {
      return `图层 ${node.layerId} 缺少可用栅格资源`
    }
    const key = resourceId
      ? resourceKey(resourceId, descriptors, sourceFormat, 'source-raster') : null
    if (resourceId && !key) return `图层 ${node.layerId} 缺少受管资源描述`
    if (key) addRequired(required, key)
    return { kind: 'source', nodeId: node.id, layerId: node.layerId, fingerprint: node.subtreeHash, resourceKey: key }
  }
  if (node.definitionId === 'vector.content') {
    const resourceRef = createImageEditorGpuAnnotationResourceRefV3(node)
    return {
      kind: 'source', nodeId: node.id, layerId: node.layerId, fingerprint: node.subtreeHash,
      resourceKey: { resourceRef, resourceKind: 'generated-vector', mip: 0, tileX: 0, tileY: 0,
        contentVersion: annotationContentVersion(node), format: 'rgba16float' },
    }
  }
  if (node.definitionId === 'composite.layer') {
    const transform = transformParameter(node.parameters.transform)
    if (!transform) return `图层 ${node.layerId} 的变换无效`
    const mask = compileMask(node.mask, descriptors, required)
    if (typeof mask === 'string') return mask
    const contentIndex = node.inputNodeIds.length === 1 ? 0 : 1
    return {
      kind: 'composite', nodeId: node.id, layerId: node.layerId,
      fingerprint: node.subtreeHash,
      backdropNodeId: node.inputNodeIds.length > 1 ? node.inputNodeIds[0] : null,
      contentNodeId: node.inputNodeIds[contentIndex], transform,
      opacity: numberParameter(node, 'opacity', 1), blendMode: blendParameter(node), mask,
      clipping: node.parameters.clipping === true,
      maskTransform: transformParameter(node.parameters.maskTransform ?? node.parameters.transform) ?? transform,
      maskDensity: numberParameter(node, 'maskDensity', 1),
      deformation: node.parameters.maskDeformation ? deformationSchema.parse(node.parameters.maskDeformation) : null,
      deformationTransform: transformParameter(node.parameters.deformationTransform) ?? transform,
      maskLinked: node.parameters.maskLinked !== false,
      maskLocalTransform: transformParameter(node.parameters.maskLocalTransform) ?? [1,0,0,1,0,0],
    }
  }
  if (node.definitionId === 'group.isolated') {
    return {
      kind: 'alias', nodeId: node.id, layerId: node.layerId,
      fingerprint: node.subtreeHash, inputNodeId: node.inputNodeIds[0],
    }
  }
  const binding = createBuiltInImageEditRenderNodeRegistry().get(node.definitionId)?.gpu
  if (binding?.kind === 'adjustment') {
    return {
      kind: 'adjustment', nodeId: node.id, layerId: node.layerId,
      fingerprint: node.subtreeHash, inputNodeId: node.inputNodeIds[0],
      adjustments: [adjustment(node, descriptors, required)],
    }
  }
  if (binding?.kind === 'effect') {
    const mask = compileMask(node.mask, descriptors, required)
    if (typeof mask === 'string') return mask
    return {
      kind: 'effect', nodeId: node.id, layerId: node.layerId,
      fingerprint: node.subtreeHash, inputNodeId: node.inputNodeIds[0],
      definitionId: node.definitionId, parameters: jsonParameters(node.parameters),
      opacity: numberParameter(node, 'opacity', 1), blendMode: blendParameter(node), mask,
    }
  }
  return `图层 ${node.layerId} 的 ${node.definitionId} 未声明 GPU kernel，不能执行`
}

function adjustment(
  node: ImageEditRenderPlanNode,
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
  required: Map<string, ImageEditorGpuSceneTileKeyV3>,
): ImageEditorGpuGraphAdjustmentV3 {
  const mask = compileMask(node.mask, descriptors, required)
  if (typeof mask === 'string') throw new Error(mask)
  if (createBuiltInImageEditRenderNodeRegistry().get(node.definitionId)?.gpu?.kind !== 'adjustment') {
    throw new Error(`GPU 不支持调整节点 ${node.definitionId}：未声明 GPU kernel`)
  }
  return {
    definitionId: node.definitionId as ImageEditorGpuGraphAdjustmentV3['definitionId'],
    parameters: jsonParameters(node.parameters),
    opacity: numberParameter(node, 'opacity', 1), blendMode: blendParameter(node), mask,
  }
}

export function supportsImageEditorGpuMaskV3(mask: ImageEditMaskReferenceV3 | null): boolean {
  return !mask?.vectorPaths
}

function compileMask(
  mask: ImageEditMaskReferenceV3 | null,
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
  required: Map<string, ImageEditorGpuSceneTileKeyV3>,
): ImageEditorGpuGraphMaskV3 | null | string {
  if (!mask) return null
  if (!supportsImageEditorGpuMaskV3(mask)) return '可编辑路径蒙版使用共享区域合成'
  {
    const unsupported = Object.keys(mask.tiles).find((key) => !isMipZeroTileKey(key))
    if (unsupported) return `蒙版 ${mask.maskId} 的瓦片键无效：${unsupported}`
    const sparseTiles = compileSparseTiles(mask.tiles, descriptors)
    if (typeof sparseTiles === 'string') return sparseTiles
    for (const [tileKey, entry] of Object.entries(sparseTiles)) {
      const [, tileX, tileY] = tileKey.split('/').map(Number)
      addRequired(required, {
        resourceRef: entry.resourceRef, mip: 0, tileX, tileY,
        resourceKind: 'sparse-mask', resourceByteLength: entry.byteLength,
        contentVersion: entry.contentVersion, format: 'r8unorm',
      })
    }
    return {
      maskId: mask.maskId, sparseTiles,
      defaultValue: mask.defaultValue, inverted: mask.inverted,
    }
  }
}

function resourceKey(
  resourceRef: `sha256:${string}`,
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
  format: ImageEditorGpuSceneTileKeyV3['format'],
  resourceKind: ImageEditorGpuSceneTileKeyV3['resourceKind'],
): ImageEditorGpuSceneTileKeyV3 | null {
  const descriptor = descriptors.get(resourceRef)
  return descriptor ? {
    resourceRef, resourceKind, mip: 0, tileX: 0, tileY: 0,
    contentVersion: `${resourceRef}:${descriptor.byteLength}`, format,
  } : null
}

function addRequired(map: Map<string, ImageEditorGpuSceneTileKeyV3>, key: ImageEditorGpuSceneTileKeyV3): void {
  map.set(`${key.format}:${key.resourceRef}:${key.mip}:${key.tileX}:${key.tileY}:${key.contentVersion}`, key)
}

function canFuseGpuAdjustments(nodes: readonly ImageEditRenderPlanNode[]): boolean {
  const binding = createBuiltInImageEditRenderNodeRegistry().get(nodes[0].definitionId)?.gpu
  return nodes.length > 1 && nodes.length <= (binding?.fusedCapacity ?? 1)
    && nodes.every(node => node.definitionId === nodes[0].definitionId && node.mask === null
      && numberParameter(node, 'opacity', 1) === 1 && blendParameter(node) === 'normal')
}

function collectRasterLayers(
  layers: readonly ImageEditDocumentV3['layers'][number][],
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
  planNodes: readonly ImageEditRenderPlanNode[],
  output: ImageEditorGpuRasterLayerV3[],
): void {
  for (const layer of layers) {
    if (layer.type === 'group') {
      collectRasterLayers(layer.children, descriptors, planNodes, output)
      continue
    }
    if (['text','shape','path'].includes(layer.type)) {
      const planNode = planNodes.find((node) => (
        node.layerId === layer.id && node.definitionId === 'vector.content'
      ))
      if (!planNode) continue
      output.push({
        layerId: layer.id, sourceKind: 'vector',
        resourceRef: createImageEditorGpuAnnotationResourceRefV3(planNode),
        contentVersion: annotationContentVersion(planNode), sparseTiles: {},
        visible: layer.visible, opacity: layer.opacity * layer.fillOpacity, transform: [...layer.transform],
      })
      continue
    }
    if (layer.type !== 'raster' && layer.type !== 'smart') continue
    const resourceRef = layer.source.kind === 'resource' && isResourceRef(layer.source.resourceId)
      ? layer.source.resourceId : null
    if (resourceRef && !descriptors.has(resourceRef)) continue
    const sparseTiles = compileSparseTiles(layer.tiles, descriptors)
    if (typeof sparseTiles === 'string'
      || (!resourceRef && layer.source.kind !== 'empty' && Object.keys(sparseTiles).length === 0)) continue
    output.push({
      layerId: layer.id,
      sourceKind: 'raster',
      ...(layer.type === 'smart' ? { rasterCanvasSize: { width: layer.content.width, height: layer.content.height } } : layer.rasterCanvasSize ? { rasterCanvasSize: layer.rasterCanvasSize } : {}),
      deformation: layer.deformation ?? null,
      resourceRef,
      contentVersion: resourceRef ? `${resourceRef}:${descriptors.get(resourceRef)!.byteLength}` : 'empty',
      sparseTiles,
      visible: layer.visible,
      opacity: layer.opacity * layer.fillOpacity,
      transform: [...layer.transform],
    })
  }
}

function compileSparseTiles(
  value: unknown,
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
): Record<string, { resourceRef: `sha256:${string}`; contentVersion: string; byteLength: number }> | string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const output: Record<string, {
    resourceRef: `sha256:${string}`; contentVersion: string; byteLength: number
  }> = {}
  for (const [tileKey, candidate] of Object.entries(value)) {
    if (!isMipZeroTileKey(tileKey) || typeof candidate !== 'string' || !isResourceRef(candidate)) {
      return `稀疏像素瓦片键或资源引用无效：${tileKey}`
    }
    const descriptor = descriptors.get(candidate)
    if (!descriptor) return `稀疏像素瓦片缺少受管资源描述：${candidate}`
    output[tileKey] = {
      resourceRef: candidate,
      contentVersion: `${candidate}:${descriptor.byteLength}`,
      byteLength: descriptor.byteLength,
    }
  }
  return output
}

function isMipZeroTileKey(value: string): boolean {
  return /^0\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/.test(value)
}

function annotationContentVersion(node: ImageEditRenderPlanNode): string {
  return `vector-raster-v1:${node.subtreeHash}`
}

/** 标注 GPU 瓦片使用可重复的合成资源身份，内容/字体/布局均由 subtreeHash 失效。 */
export function createImageEditorGpuAnnotationResourceRefV3(
  node: Pick<ImageEditRenderPlanNode, 'id' | 'subtreeHash'>,
): `sha256:${string}` {
  const seed = `${node.id}:${node.subtreeHash}`
  let hash = 0x811c9dc5
  let output = ''
  for (let block = 0; block < 8; block += 1) {
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index) + block
      hash = Math.imul(hash, 0x01000193)
    }
    output += (hash >>> 0).toString(16).padStart(8, '0')
  }
  return `sha256:${output}`
}

function transformParameter(value: unknown): ImageEditTransformV3 | null {
  return Array.isArray(value) && value.length === 6 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    ? value as unknown as ImageEditTransformV3 : null
}

function numberParameter(node: ImageEditRenderPlanNode, key: string, fallback: number): number {
  const value = node.parameters[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function blendParameter(node: ImageEditRenderPlanNode): ImageEditBlendModeV3 {
  const value = node.parameters.blendMode
  return value === 'multiply' || value === 'screen' || value === 'overlay' || value === 'soft-light' ? value : 'normal'
}

function jsonParameters(parameters: Readonly<Record<string, unknown>>): ImageEditJsonObjectV3 {
  return structuredClone(parameters) as ImageEditJsonObjectV3
}

function isPlanNode(value: ImageEditRenderPlanNode | undefined): value is ImageEditRenderPlanNode {
  return value !== undefined
}

function isResourceRef(value: string): value is `sha256:${string}` {
  return /^sha256:[a-f0-9]{64}$/.test(value)
}
