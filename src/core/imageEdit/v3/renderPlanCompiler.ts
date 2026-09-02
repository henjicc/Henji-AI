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
}

function transformIsIdentity(transform: ImageEditLayerCommonV3['transform']): boolean {
  return transform.every((value, index) => value === IMAGE_EDIT_IDENTITY_TRANSFORM_V3[index]);
}

function commonParameters(layer: ImageEditLayerCommonV3): Record<string, unknown> {
  return {
    opacity: layer.opacity,
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
  mask: ImageEditMaskReferenceV3 | null = layer.mask,
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
    state.nodes.find((node) => node.id === inputId)?.subtreeHash ?? 'transparent'
  ));
  const subtreeHash = createImageEditRenderHash({
    definitionId,
    definitionVersion: definition.version,
    inputHashes,
    parameters: hashObject(parameters),
    mask: mask
      ? hashObject(cloneImageEditMaskReferenceV3(mask) as unknown as Record<string, unknown>)
      : null,
  });
  state.nodes.push({
    id,
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
): string {
  return appendNode(
    state,
    layer,
    path,
    'composite.layer',
    belowNodeId ? [belowNodeId, contentNodeId] : [contentNodeId],
    commonParameters(layer),
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
  return contentNodeId
    ? compositeContent(state, layer, path, contentNodeId, belowNodeId)
    : belowNodeId ?? '';
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
    { ...layer.params, ...commonParameters(layer) },
  ) ?? belowNodeId;
}

function groupCanPassThrough(layer: ImageEditGroupLayerV3): boolean {
  return !layer.isolated
    && layer.blendMode === 'normal'
    && layer.opacity === 1
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
  return compositeContent(state, layer, path, groupOutput, belowNodeId);
}

function compileLayers(
  state: CompileState,
  layers: readonly ImageEditLayerV3[],
  path: readonly string[],
  initialNodeId: string | null,
): string | null {
  let outputNodeId = initialNodeId;
  for (const layer of layers) {
    if (!layer.visible) continue;
    state.layerEvaluationOrder.push(layer.id);
    if (layer.type === 'raster' || layer.type === 'annotation') {
      outputNodeId = compileContentLayer(state, layer, path, outputNodeId) || outputNodeId;
    } else if (layer.type === 'effect' || layer.type === 'adjustment') {
      outputNodeId = compileEffectLayer(state, layer, path, outputNodeId);
    } else {
      outputNodeId = compileGroup(state, layer, path, outputNodeId);
    }
  }
  return outputNodeId;
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
  for (const node of nodes) {
    const definition = registry.get(node.definitionId);
    const previous = passes.at(-1);
    const previousNode = previous ? nodes.find((candidate) => candidate.id === previous.nodeIds.at(-1)) : null;
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
): ImageEditRenderPlan {
  const state: CompileState = {
    registry,
    nodes: [],
    diagnostics: [],
    layerEvaluationOrder: [],
    color: document.color,
    sequence: 0,
  };
  const outputNodeId = compileLayers(state, document.layers, [], null);
  const rootHash = outputNodeId
    ? state.nodes.find((node) => node.id === outputNodeId)?.subtreeHash ?? 'transparent'
    : 'transparent';
  const outputHash = createImageEditRenderHash(hashObject({
    rootHash,
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
