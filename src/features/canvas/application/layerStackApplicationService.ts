import type { StructuredGenerationLayerStackV1 } from '@henjicc/ai-sdk';

import { getPlatform } from '@/platform/runtime';
import type { ComposeLayerStackPayload, ComposeLayerStackResult } from '@/platform/contracts/image';

import {
  createStableLayerId,
  createStableLayerResourceId,
  createStableLayerStackId,
  validateLayerStackDocument,
  type LayerStackDocumentV1,
  type LayerStackMediaResourceV1,
} from '../domain/layerStack';

export interface PrepareLayerStackDocumentInput {
  structuredOutput: StructuredGenerationLayerStackV1;
  completionId: string;
  sourceNodeId: string;
  inputResourceId: string;
  providerId: string;
  modelId: string;
  providerRequestId?: string;
  compose?: (payload: ComposeLayerStackPayload) => Promise<ComposeLayerStackResult>;
  onCreatedFilePaths?: (filePaths: readonly string[]) => void;
}

export async function prepareLayerStackDocument(
  input: PrepareLayerStackDocumentInput,
): Promise<LayerStackDocumentV1> {
  if (input.structuredOutput.version !== 1 || input.structuredOutput.kind !== 'layer-stack') {
    throw new Error('不支持的结构化图层输出');
  }
  const stackId = createStableLayerStackId(input.completionId);
  const compose = input.compose ?? ((payload) => getPlatform().image.composeLayerStack(payload));
  const composed = await compose({
    requestId: `layer-stack-prepare:${crypto.randomUUID()}`,
    stackId,
    persistSourceLayers: false,
    layers: input.structuredOutput.outputs.map((layer) => {
      const source = layer.filePath?.trim();
      if (!source) throw new Error(`结构化输出 ${layer.sourceOutputIndex} 尚未完成受管落盘`);
      return {
        sourceOutputIndex: layer.sourceOutputIndex,
        source,
        zIndex: layer.zIndex,
        role: layer.role,
        name: layer.name,
        description: layer.description,
        declaredWidth: layer.width,
        declaredHeight: layer.height,
        declaredFormat: layer.format,
        boundingBox: layer.boundingBox,
        opacity: 1,
        visible: true,
      };
    }),
  });
  input.onCreatedFilePaths?.(composed.createdFilePaths);
  if (composed.stackId !== stackId || composed.resources.length !== input.structuredOutput.outputs.length) {
    throw new Error('图层合成结果与请求不一致');
  }
  const resourceBySourceIndex = new Map(composed.resources.map((resource) => [resource.sourceOutputIndex, resource]));
  const resources: LayerStackMediaResourceV1[] = composed.resources.map((resource) => ({
    version: 1,
    resourceId: createStableLayerResourceId(stackId, resource.sourceOutputIndex),
    status: 'ready',
    filePath: resource.filePath,
    mimeType: resource.mimeType,
    width: resource.width,
    height: resource.height,
    hasAlpha: resource.hasAlpha,
    byteLength: resource.byteLength,
    sha256: resource.sha256,
  }));
  resources.push(
    {
      version: 1,
      resourceId: `${stackId}:composite`,
      status: 'ready',
      filePath: composed.compositePath,
      mimeType: 'image/png',
      width: composed.canvasWidth,
      height: composed.canvasHeight,
      hasAlpha: true,
      byteLength: null,
      sha256: composed.compositeSha256,
    },
    {
      version: 1,
      resourceId: `${stackId}:thumbnail`,
      status: 'ready',
      filePath: composed.thumbnailPath,
      mimeType: 'image/webp',
      width: composed.thumbnailWidth,
      height: composed.thumbnailHeight,
      hasAlpha: false,
      byteLength: null,
      sha256: composed.thumbnailSha256,
    },
  );
  const document: LayerStackDocumentV1 = {
    version: 1,
    stackId,
    status: 'ready',
    source: {
      capabilityId: 'image.layer-separation',
      sourceNodeId: input.sourceNodeId,
      inputResourceId: input.inputResourceId,
      providerId: input.providerId,
      modelId: input.modelId,
      ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
      completionId: input.completionId,
    },
    canvas: {
      width: composed.canvasWidth,
      height: composed.canvasHeight,
      colorSpace: 'srgb',
      alphaMode: 'straight',
      compositeOperation: 'source-over',
      clipPolicy: 'canvas-bounds',
    },
    compositeResourceId: `${stackId}:composite`,
    thumbnailResourceId: `${stackId}:thumbnail`,
    layers: input.structuredOutput.outputs
      .map((layer) => {
        const resource = resourceBySourceIndex.get(layer.sourceOutputIndex);
        if (!resource) throw new Error(`缺少已验证的图层资源：${layer.sourceOutputIndex}`);
        return {
          version: 1 as const,
          layerId: createStableLayerId(stackId, layer.sourceOutputIndex),
          sourceOutputIndex: layer.sourceOutputIndex,
          providerZIndex: layer.zIndex,
          order: layer.zIndex,
          role: layer.role,
          name: layer.name ?? (layer.role === 'base' ? '底图' : `图层 ${layer.zIndex}`),
          ...(layer.description ? { description: layer.description } : {}),
          resourceId: createStableLayerResourceId(stackId, layer.sourceOutputIndex),
          placement: resource.placement,
          opacity: 1,
          visible: true,
          blendMode: 'normal' as const,
          alpha: layer.role === 'base' && !resource.hasAlpha ? 'opaque' as const : 'straight' as const,
          ...(layer.boundingBox ? { sourceBounds: layer.boundingBox } : {}),
        };
      })
      .sort((left, right) => left.order - right.order),
    resources,
  };
  return validateLayerStackDocument(document);
}

export async function recomposeLayerStackDocument(
  document: LayerStackDocumentV1,
  compose: (payload: ComposeLayerStackPayload) => Promise<ComposeLayerStackResult> = (payload) => getPlatform().image.composeLayerStack(payload),
  requestId = `layer-stack-recompose:${crypto.randomUUID()}`,
  onCreatedFilePaths?: (filePaths: readonly string[]) => void,
): Promise<LayerStackDocumentV1> {
  validateLayerStackDocument(document);
  const resourceById = new Map(document.resources.map((resource) => [resource.resourceId, resource]));
  const result = await compose({
    requestId,
    stackId: document.stackId,
    persistSourceLayers: false,
    layers: document.layers.map((layer) => {
      const resource = resourceById.get(layer.resourceId);
      if (!resource?.filePath || resource.status !== 'ready') throw new Error(`图层资源不可用：${layer.resourceId}`);
      return {
        sourceOutputIndex: layer.sourceOutputIndex,
        source: resource.filePath,
        zIndex: layer.order,
        role: layer.role,
        name: layer.name,
        description: layer.description,
        declaredWidth: resource.width,
        declaredHeight: resource.height,
        declaredFormat: resource.mimeType === 'image/jpeg' ? 'jpeg' : resource.mimeType === 'image/webp' ? 'webp' : 'png',
        boundingBox: { absolute: [layer.placement.x, layer.placement.y, layer.placement.x + layer.placement.width, layer.placement.y + layer.placement.height] },
        opacity: layer.opacity,
        visible: layer.visible,
      };
    }),
  });
  onCreatedFilePaths?.(result.createdFilePaths);
  const resources = document.resources.map((resource) => {
    if (resource.resourceId === document.compositeResourceId) return { ...resource, filePath: result.compositePath, sha256: result.compositeSha256, status: 'ready' as const };
    if (resource.resourceId === document.thumbnailResourceId) return { ...resource, filePath: result.thumbnailPath, sha256: result.thumbnailSha256, status: 'ready' as const };
    return resource;
  });
  return validateLayerStackDocument({ ...document, status: 'ready', resources });
}
