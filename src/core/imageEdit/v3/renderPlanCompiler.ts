import { imageEditLayerMaskTransformV3 } from './renderContracts/maskTransform';
import { assertImageEditLayerSemanticsV3 } from './layerModel/semantics';
import { evaluationCacheIdentity, type EvaluationContext } from '../../imaging/evaluation';
import type { ImageEditDocumentV3 } from './documentTypes';
import type { ImageEditColorModeV3 } from './colorTypes';
import {
  IMAGE_EDIT_IDENTITY_TRANSFORM_V3,
  cloneImageEditMaskReferenceV3,
  type ImageEditAdjustmentLayerV3,
  type ImageEditEffectLayerV3,
  type ImageEditGroupLayerV3,
  type ImageEditLayerCommonV3,
  type ImageEditLayerV3,
  type ImageEditMaskReferenceV3,
} from './layerTypes';
import { createImageEditRenderHash, type ImageEditHashValue } from './renderHash';
import type {
  ImageEditRenderPlan,
  ImageEditRenderPlanDiagnostic,
  ImageEditRenderPlanNode,
  ImageEditRenderPass,
} from './renderPlan';
import {
  ImageEditRenderNodeRegistry,
  type ImageEditRenderQuality,
  type RenderNodeDefinition,
} from './renderNodeDefinition';
import { imageEditRenderDefinitionIdForOperationV3 } from './operationCatalog';

interface CompileState {
  registry: ImageEditRenderNodeRegistry;
  nodes: ImageEditRenderPlanNode[];
  diagnostics: ImageEditRenderPlanDiagnostic[];
  layerEvaluationOrder: string[];
  color: Readonly<ImageEditColorModeV3>;
  sequence: number;
  effectQuality: 'interactive' | 'final';
  referenceWidth: number;
  referenceHeight: number;
  evaluationIdentity: string;
  nodeHashes: Map<string, string>;
  nodeOccurrences: Map<string, number>;
}

function transformIsIdentity(transform: ImageEditLayerCommonV3['transform']): boolean {
  return transform.every((value, index) => value === IMAGE_EDIT_IDENTITY_TRANSFORM_V3[index]);
}

function commonParameters(layer: ImageEditLayerCommonV3): Record<string, unknown> {
  return {
    opacity: layer.opacity * layer.fillOpacity,
    maskTransform: imageEditLayerMaskTransformV3(layer),
    maskLinked: layer.maskAttachment.linked,
    maskLocalTransform: layer.maskAttachment.transform,
    maskDensity: layer.maskAttachment.density,
    blendMode: layer.blendMode,
    transform: [...layer.transform],
  };
}

function hashObject(value: Readonly<Record<string, unknown>>): ImageEditHashValue {
  return value as ImageEditHashValue;
}

function appendNode(
  state: CompileState,
  layer: ImageEditLayerV3,
  path: readonly string[],
  definitionId: string,
  inputNodeIds: readonly string[],
  parameters: Readonly<Record<string, unknown>>,
  mask: ImageEditMaskReferenceV3 | null = layer.maskAttachment.enabled ? layer.mask : null,
): string | null {
  const definition = state.registry.get(definitionId);
  if (!definition) {
    state.diagnostics.push({
      layerId: layer.id,
      code: 'missing-definition',
      message: `缺少渲染节点定义：${definitionId}`,
    });
    return null;
  }
  const id = `render-${++state.sequence}-${layer.id}`;
  const inputHashes = inputNodeIds.map((inputId) => (
    state.nodeHashes.get(inputId) ?? 'transparent'
  ));
  const subtreeHash = createImageEditRenderHash({
    evaluationIdentity: state.evaluationIdentity,
    definitionId,
    definitionVersion: definition.version,
    inputHashes,
    parameters: hashObject(parameters),
    mask: mask
      ? hashObject(cloneImageEditMaskReferenceV3(mask) as unknown as Record<string, unknown>)
      : null,
  });
  state.nodeHashes.set(id, subtreeHash);
  const identity = JSON.stringify([path, layer.id, definitionId, parameters.filterId ?? null]);
  const occurrence = state.nodeOccurrences.get(identity) ?? 0;
  state.nodeOccurrences.set(identity, occurrence + 1);
  state.nodes.push({
    id,
    cacheIdentity: `${identity}:${occurrence}`,
    layerId: layer.id,
    layerPath: [...path, layer.id],
    definitionId,
    definitionVersion: definition.version,
    category: definition.category,
    inputNodeIds: [...inputNodeIds],
    parameters,
    mask: mask ? cloneImageEditMaskReferenceV3(mask) : null,
    subtreeHash,
  });
  return id;
}

function compositeContent(
  state: CompileState,
  layer: ImageEditLayerV3,
  path: readonly string[],
  contentNodeId: string,
  belowNodeId: string | null,
  overrides: Record<string, unknown> = {},
  mask: ImageEditMaskReferenceV3 | null = layer.maskAttachment.enabled ? layer.mask : null,
): string {
  return appendNode(
    state,
    layer,
    path,
    'composite.layer',
    belowNodeId ? [belowNodeId, contentNodeId] : [contentNodeId],
    { ...commonParameters(layer), ...overrides },
    mask,
  ) ?? belowNodeId ?? contentNodeId;
}

function compileContentLayer(
  state: CompileState,
  layer: Extract<ImageEditLayerV3, { type: 'raster' | 'annotation' }>,
  path: readonly string[],
  belowNodeId: string | null,
): string {
  const definitionId = layer.type === 'raster' ? 'source.raster' : 'vector.annotation';
  const contentParameters: Record<string, unknown> = layer.type === 'raster'
    ? { source: layer.source, tiles: layer.tiles, colorMode: state.color }
    : { annotations: layer.annotations, colorMode: state.color };
  const contentNodeId = appendNode(state, layer, path, definitionId, [], contentParameters, null);
  if (!contentNodeId) return belowNodeId ?? '';
  const filtered = compileLayerFilters(state, layer, path, contentNodeId);
  return compositeContent(state, layer, path, filtered, belowNodeId, layer.filters.some(filter => filter.enabled)
    ? { opacity: layer.opacity, transform: IMAGE_EDIT_IDENTITY_TRANSFORM_V3 } : {});
}

function compileEffectLayer(
  state: CompileState,
  layer: ImageEditEffectLayerV3 | ImageEditAdjustmentLayerV3,
  path: readonly string[],
  belowNodeId: string | null,
): string | null {
  if (!belowNodeId) {
    state.diagnostics.push({
      layerId: layer.id,
      code: 'empty-effect-scope',
      message: '效果或调整图层下方没有可处理内容',
    });
    return null;
  }
  if (!layer.renderable) {
    state.diagnostics.push({
      layerId: layer.id,
      code: 'unsupported-layer',
      message: '图层已保留，但当前版本无法渲染',
    });
    return belowNodeId;
  }
  const definitionId = layer.type === 'effect'
    ? imageEditRenderDefinitionIdForOperationV3(layer.effectId, 'effect')
    : imageEditRenderDefinitionIdForOperationV3(layer.adjustmentId, 'adjustment');
  return appendNode(
    state,
    layer,
    path,
    definitionId,
    [belowNodeId],
    { ...layer.params, ...commonParameters(layer), referenceWidth: state.referenceWidth, referenceHeight: state.referenceHeight, effectQuality: state.effectQuality },
  ) ?? belowNodeId;
}

function groupCanPassThrough(layer: ImageEditGroupLayerV3): boolean {
  return !layer.isolated
    && layer.blendMode === 'normal'
    && layer.opacity === 1
    && layer.fillOpacity === 1
    && !layer.clipping
    && layer.filters.length === 0
    && layer.mask === null
    && transformIsIdentity(layer.transform)
    // 效果/调整图层的作用域必须止于当前组。若把父级 backdrop 直接作为组内
    // 初始输入，它们会错误处理组外图层；这种组必须先形成独立的组内结果。
    && !groupContainsScopedProcessor(layer);
}

function groupContainsScopedProcessor(layer: ImageEditGroupLayerV3): boolean {
  return layer.children.some((child) => (
    child.type === 'effect'
    || child.type === 'adjustment'
    || (child.type === 'group' && groupContainsScopedProcessor(child))
  ));
}

function compileGroup(
  state: CompileState,
  layer: ImageEditGroupLayerV3,
  path: readonly string[],
  belowNodeId: string | null,
): string | null {
  const groupPath = [...path, layer.id];
  if (groupCanPassThrough(layer)) {
    return compileLayers(state, layer.children, groupPath, belowNodeId);
  }
  const isolatedOutput = compileLayers(state, layer.children, groupPath, null);
  if (!isolatedOutput) return belowNodeId;
  const groupOutput = appendNode(
    state,
    layer,
    path,
    'group.isolated',
    [isolatedOutput],
    { isolated: true },
    null,
  ) ?? isolatedOutput;
  const filtered = compileLayerFilters(state, layer, path, groupOutput);
  return compositeContent(state, layer, path, filtered, belowNodeId, layer.filters.some(filter => filter.enabled)
    ? { opacity: layer.opacity, transform: IMAGE_EDIT_IDENTITY_TRANSFORM_V3 } : {});
}

function compileLayers(
  state: CompileState,
  layers: readonly ImageEditLayerV3[],
  path: readonly string[],
  initialNodeId: string | null,
): string | null {
  let outputNodeId = initialNodeId;
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (layer.clipping) continue; // clipped run is consumed with its structural base, including hidden bases.
    let end = index + 1;
    while (end < layers.length && layers[end].clipping) end += 1;
    if (!layer.visible) { index = end - 1; continue; }
    state.layerEvaluationOrder.push(layer.id);
    if (end > index + 1) {
      // Base opacity/blend are applied once after the source-atop run, never to the backdrop.
      const base = { ...layer, opacity: 1, blendMode: 'normal' as const };
      let stack = compileSingleLayer(state, base, path, null);
      for (let clippedIndex = index + 1; clippedIndex < end; clippedIndex += 1) {
        const clipped = layers[clippedIndex];
        if (!clipped.visible || !stack) continue;
        state.layerEvaluationOrder.push(clipped.id);
        const content = compileSingleLayer(state, { ...clipped, blendMode: 'normal' }, path, null);
        if (content) stack = compositeContent(state, clipped, path, content, stack,
          { opacity: 1, transform: IMAGE_EDIT_IDENTITY_TRANSFORM_V3, blendMode: clipped.blendMode, clipping: true }, null);
      }
      if (stack) outputNodeId = compositeContent(state, layer, path, stack, outputNodeId,
        { opacity: layer.opacity, transform: IMAGE_EDIT_IDENTITY_TRANSFORM_V3 }, null);
      index = end - 1;
    } else outputNodeId = compileSingleLayer(state, layer, path, outputNodeId);
  }
  return outputNodeId;
}

function compileSingleLayer(state: CompileState, layer: ImageEditLayerV3, path: readonly string[], below: string | null): string | null {
  if (layer.type === 'raster' || layer.type === 'annotation') return compileContentLayer(state, layer, path, below) || below;
  if (layer.type === 'effect' || layer.type === 'adjustment') return compileEffectLayer(state, layer, path, below);
  return compileGroup(state, layer, path, below);
}

function compileLayerFilters(state: CompileState, layer: ImageEditLayerV3, path: readonly string[], content: string): string {
  const enabled = layer.filters.filter(filter => filter.enabled);
  if (!enabled.length) return content;
  let output = compositeContent(state, layer, path, content, null,
    { opacity: layer.fillOpacity, blendMode: 'normal' }, null);
  for (const filter of enabled) {
    output = appendNode(state, layer, path,
      imageEditRenderDefinitionIdForOperationV3(filter.effectId, filter.operationType), [output],
      { ...filter.params, opacity: filter.opacity, blendMode: filter.blendMode,
        transform: IMAGE_EDIT_IDENTITY_TRANSFORM_V3, referenceWidth: state.referenceWidth,
        referenceHeight: state.referenceHeight, effectQuality: state.effectQuality,
        filterId: filter.id }, filter.mask) ?? output;
  }
  return output;
}

function canFusePointwise(
  node: ImageEditRenderPlanNode,
  definition: RenderNodeDefinition | null,
): boolean {
  return definition?.fusion === 'pointwise-chain'
    && node.mask === null
    && node.parameters.opacity === 1
    && node.parameters.blendMode === 'normal';
}

function createPasses(
  nodes: readonly ImageEditRenderPlanNode[],
  registry: ImageEditRenderNodeRegistry,
): ImageEditRenderPass[] {
  const passes: ImageEditRenderPass[] = [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    const definition = registry.get(node.definitionId);
    const previous = passes.at(-1);
    const previousNodeId = previous?.nodeIds.at(-1);
    const previousNode = previousNodeId ? byId.get(previousNodeId) : null;
    if (
      previous?.kind === 'fused-pointwise'
      && previousNode
      && node.inputNodeIds.length === 1
      && node.inputNodeIds[0] === previousNode.id
      && canFusePointwise(node, definition)
    ) {
      passes[passes.length - 1] = { ...previous, nodeIds: [...previous.nodeIds, node.id] };
      continue;
    }
    const kind = canFusePointwise(node, definition) ? 'fused-pointwise' : 'single';
    passes.push({ id: `pass-${passes.length + 1}`, kind, nodeIds: [node.id] });
  }
  return passes;
}

export function compileImageEditRenderPlanV3(
  document: ImageEditDocumentV3,
  registry: ImageEditRenderNodeRegistry,
  quality: ImageEditRenderQuality,
  effectQuality: 'interactive' | 'final' = quality === 'export' ? 'final' : 'interactive',
  evaluation?: EvaluationContext,
): ImageEditRenderPlan {
  if (evaluation?.signal?.aborted) throw new DOMException('图片渲染已取消', 'AbortError');
  assertImageEditLayerSemanticsV3(document.layers);
  const evaluationIdentity = evaluationCacheIdentity(evaluation ?? {
    target: { kind: 'image_edit.document', id: document.id }, sourceVersion: 'static', time: { kind: 'static' },
    referenceGrid: { width: document.geometry.width, height: document.geometry.height },
    roi: { x: 0, y: 0, width: document.geometry.width, height: document.geometry.height },
    color: { workingSpace: document.color.workingSpace, transferFunction: document.color.transferFunction,
      alpha: 'premultiplied', precision: document.color.bitDepth === 'float32' ? 'float32' : 'float16' },
    quality: effectQuality,
  });
  const state: CompileState = {
    registry,
    nodes: [],
    nodeHashes: new Map(), nodeOccurrences: new Map(), evaluationIdentity,
    diagnostics: [],
    layerEvaluationOrder: [],
    color: document.color,
    effectQuality,
    sequence: 0, referenceWidth: document.geometry.width, referenceHeight: document.geometry.height,
  };
  const outputNodeId = compileLayers(state, document.layers, [], null);
  const rootHash = outputNodeId
    ? state.nodes.find((node) => node.id === outputNodeId)?.subtreeHash ?? 'transparent'
    : 'transparent';
  const outputHash = createImageEditRenderHash(hashObject({
    rootHash,
    quality,
    color: document.color,
    geometry: document.geometry,
  }));
  return {
    documentId: document.id,
    revision: document.revision,
    quality,
    color: document.color,
    geometry: document.geometry,
    nodes: state.nodes,
    passes: createPasses(state.nodes, registry),
    outputNodeId,
    outputHash,
    layerEvaluationOrder: state.layerEvaluationOrder,
    diagnostics: state.diagnostics,
  };
}
