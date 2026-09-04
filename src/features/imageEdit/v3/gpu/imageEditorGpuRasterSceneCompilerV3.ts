import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
} from '@/core/imageEdit/v3'
import type { ImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import {
  isImageEditSparseMaskReferenceV3,
  type ImageEditBlendModeV3,
  type ImageEditJsonObjectV3,
  type ImageEditMaskReferenceV3,
  type ImageEditTransformV3,
} from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditRenderPlanNode } from '@/core/imageEdit/v3/renderPlan'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'

export interface ImageEditorGpuRasterLayerV3 {
  layerId: string
  resourceRef: `sha256:${string}`
  contentVersion: string
  visible: boolean
  opacity: number
  transform: ImageEditTransformV3
}

export interface ImageEditorGpuGraphMaskV3 {
  key: ImageEditorGpuSceneTileKeyV3 | null
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
  resourceKey: ImageEditorGpuSceneTileKeyV3
}

export interface ImageEditorGpuGraphCompositeNodeV3 extends ImageEditorGpuGraphNodeBaseV3 {
  kind: 'composite'
  backdropNodeId: string | null
  contentNodeId: string
  transform: ImageEditTransformV3
  opacity: number
  blendMode: ImageEditBlendModeV3
  mask: ImageEditorGpuGraphMaskV3 | null
}

export interface ImageEditorGpuGraphAdjustmentV3 {
  definitionId: 'adjustment.exposure' | 'adjustment.curves'
    | 'adjustment.temperature-tint' | 'adjustment.hsl'
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

export interface ImageEditorGpuGraphAliasNodeV3 extends ImageEditorGpuGraphNodeBaseV3 {
  kind: 'alias'
  inputNodeId: string
}

export type ImageEditorGpuRenderGraphNodeV3 =
  | ImageEditorGpuGraphSourceNodeV3
  | ImageEditorGpuGraphCompositeNodeV3
  | ImageEditorGpuGraphAdjustmentNodeV3
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

const registry = createBuiltInImageEditRenderNodeRegistry()

/**
 * 把 CPU RenderPlan 真值投影为会话 retained GPU RenderGraph。大图 source 仍由
 * 视口 tile planner/atlas 提供；flat normal 允许走同一 compositor 内的快速路径。
 */
export function compileImageEditorGpuRasterSceneV3(
  document: ImageEditDocumentV3,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
): ImageEditorGpuRasterSceneCompilationV3 {
  const descriptors = new Map(resourceDescriptors.map((entry) => [entry.resourceRef, entry]))
  const plan = compileImageEditRenderPlanV3(document, registry, 'stable')
  if (plan.diagnostics.some((entry) => entry.code !== 'empty-effect-scope')) {
    return { supported: false, reason: plan.diagnostics.map((entry) => entry.message).join('；') }
  }
  const graph: ImageEditorGpuRenderGraphNodeV3[] = []
  const required = new Map<string, ImageEditorGpuSceneTileKeyV3>()
  const planNodeMap = new Map(plan.nodes.map((node) => [node.id, node]))
  try {
    for (const pass of plan.passes) {
      const nodes = pass.nodeIds.map((id) => planNodeMap.get(id)).filter(isPlanNode)
      if (nodes.length === 0) continue
      if (canFuseExposure(nodes)) {
        const last = nodes[nodes.length - 1]
        graph.push({
          kind: 'adjustment', nodeId: last.id, layerId: last.layerId,
          fingerprint: last.subtreeHash, inputNodeId: nodes[0].inputNodeIds[0],
          adjustments: nodes.map((node) => adjustment(node, descriptors, required)),
        })
        continue
      }
      for (const node of nodes) {
        const compiled = compileNode(node, descriptors, required)
        if (typeof compiled === 'string') return { supported: false, reason: compiled }
        graph.push(compiled)
      }
    }
  } catch (error) {
    return { supported: false, reason: error instanceof Error ? error.message : String(error) }
  }
  const layers: ImageEditorGpuRasterLayerV3[] = []
  collectRasterLayers(document.layers, descriptors, layers)
  const requiresRenderGraph = graph.some((node) => (
    node.kind === 'adjustment'
    || node.kind === 'alias'
    || (node.kind === 'composite' && (node.blendMode !== 'normal' || node.mask !== null))
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
): ImageEditorGpuRenderGraphNodeV3 | string {
  if (node.definitionId === 'source.raster') {
    const source = node.parameters.source
    const tiles = node.parameters.tiles
    if (!source || typeof source !== 'object' || !('kind' in source)
      || source.kind !== 'resource' || !('resourceId' in source)
      || typeof source.resourceId !== 'string' || !isResourceRef(source.resourceId)) {
      return `图层 ${node.layerId} 缺少可用栅格资源`
    }
    if (tiles && typeof tiles === 'object' && Object.keys(tiles).length > 0) {
      return `图层 ${node.layerId} 的稀疏像素覆盖由 3.2/4.1 接入`
    }
    const key = resourceKey(source.resourceId, descriptors, 'rgba8unorm')
    if (!key) return `图层 ${node.layerId} 缺少受管资源描述`
    addRequired(required, key)
    return { kind: 'source', nodeId: node.id, layerId: node.layerId, fingerprint: node.subtreeHash, resourceKey: key }
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
    }
  }
  if (node.definitionId === 'group.isolated') {
    return {
      kind: 'alias', nodeId: node.id, layerId: node.layerId,
      fingerprint: node.subtreeHash, inputNodeId: node.inputNodeIds[0],
    }
  }
  if (node.definitionId.startsWith('adjustment.')) {
    return {
      kind: 'adjustment', nodeId: node.id, layerId: node.layerId,
      fingerprint: node.subtreeHash, inputNodeId: node.inputNodeIds[0],
      adjustments: [adjustment(node, descriptors, required)],
    }
  }
  return `图层 ${node.layerId} 的 ${node.definitionId} 由 3.2 接入，当前自动回退 CPU`
}

function adjustment(
  node: ImageEditRenderPlanNode,
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
  required: Map<string, ImageEditorGpuSceneTileKeyV3>,
): ImageEditorGpuGraphAdjustmentV3 {
  const mask = compileMask(node.mask, descriptors, required)
  if (typeof mask === 'string') throw new Error(mask)
  if (!['adjustment.exposure', 'adjustment.curves', 'adjustment.temperature-tint', 'adjustment.hsl'].includes(node.definitionId)) {
    throw new Error(`调整图层 ${node.layerId} 未映射到 GPU`)
  }
  return {
    definitionId: node.definitionId as ImageEditorGpuGraphAdjustmentV3['definitionId'],
    parameters: jsonParameters(node.parameters),
    opacity: numberParameter(node, 'opacity', 1), blendMode: blendParameter(node), mask,
  }
}

function compileMask(
  mask: ImageEditMaskReferenceV3 | null,
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
  required: Map<string, ImageEditorGpuSceneTileKeyV3>,
): ImageEditorGpuGraphMaskV3 | null | string {
  if (!mask) return null
  let resourceId: string | null
  let defaultValue: 0 | 1 = 1
  if (isImageEditSparseMaskReferenceV3(mask)) {
    const unsupported = Object.keys(mask.tiles).find((key) => key !== '0/0/0')
    if (unsupported) return `蒙版 ${mask.maskId} 的多瓦片资源由 4.1 接入`
    resourceId = mask.tiles['0/0/0'] ?? null
    defaultValue = mask.defaultValue
  } else resourceId = mask.resourceId
  if (!resourceId) return { key: null, defaultValue, inverted: mask.inverted }
  if (!isResourceRef(resourceId)) return `蒙版资源引用无效：${resourceId}`
  const key = resourceKey(resourceId, descriptors, 'r8unorm')
  if (!key) return `蒙版缺少受管资源描述：${resourceId}`
  addRequired(required, key)
  return { key, defaultValue, inverted: mask.inverted }
}

function resourceKey(
  resourceRef: `sha256:${string}`,
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
  format: ImageEditorGpuSceneTileKeyV3['format'],
): ImageEditorGpuSceneTileKeyV3 | null {
  const descriptor = descriptors.get(resourceRef)
  return descriptor ? {
    resourceRef, mip: 0, tileX: 0, tileY: 0,
    contentVersion: `${resourceRef}:${descriptor.byteLength}`, format,
  } : null
}

function addRequired(map: Map<string, ImageEditorGpuSceneTileKeyV3>, key: ImageEditorGpuSceneTileKeyV3): void {
  map.set(`${key.format}:${key.resourceRef}:${key.contentVersion}`, key)
}

function canFuseExposure(nodes: readonly ImageEditRenderPlanNode[]): boolean {
  return nodes.length > 1 && nodes.length <= 8 && nodes.every((node) => node.definitionId === 'adjustment.exposure'
    && node.mask === null && numberParameter(node, 'opacity', 1) === 1 && blendParameter(node) === 'normal')
}

function collectRasterLayers(
  layers: readonly ImageEditDocumentV3['layers'][number][],
  descriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>,
  output: ImageEditorGpuRasterLayerV3[],
): void {
  for (const layer of layers) {
    if (layer.type === 'group') {
      collectRasterLayers(layer.children, descriptors, output)
      continue
    }
    if (layer.type !== 'raster' || layer.source.kind !== 'resource') continue
    const resourceId = layer.source.resourceId
    if (!isResourceRef(resourceId)) continue
    const resourceRef = resourceId
    const descriptor = descriptors.get(resourceRef)
    if (!descriptor) continue
    output.push({
      layerId: layer.id,
      resourceRef,
      contentVersion: `${resourceRef}:${descriptor.byteLength}`,
      visible: layer.visible,
      opacity: layer.opacity,
      transform: [...layer.transform],
    })
  }
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
