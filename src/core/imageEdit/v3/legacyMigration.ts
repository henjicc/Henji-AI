import { decodeImageEditDocument } from '../documentCodec';
import { parseBlurOperationParams } from '../blurParams';
import {
  IMAGE_EDIT_DOCUMENT_VERSION,
  IMAGE_EDIT_OPERATION_IDS,
  type AnnotationOperationParams,
  type CropOperationParams,
  type ImageEditDocument,
  type ImageEditOperation,
  type OrientationOperationParams,
} from '../types';
import { createDefaultImageEditColorModeV3 } from './colorTypes';
import {
  createImageEditAnnotationLayerV3,
  createImageEditCanvasGeometryV3,
  createImageEditIdV3,
  createImageEditRasterLayerV3,
  type ImageEditIdFactoryV3,
} from './documentFactory';
import { cloneImageEditJsonObjectV3 } from './documentCodec';
import {
  IMAGE_EDIT_DOCUMENT_VERSION_V3,
  type ImageEditDocumentV3,
} from './documentTypes';
import {
  createImageEditLayerCommonV3,
  type ImageEditEffectLayerV3,
  type ImageEditJsonObjectV3,
  type ImageEditLayerV3,
} from './layerTypes';

const RENDERABLE_EFFECT_IDS = new Set<string>([
  IMAGE_EDIT_OPERATION_IDS.blur,
  IMAGE_EDIT_OPERATION_IDS.diffusion,
  IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
]);

const EFFECT_NAMES: Readonly<Record<string, string>> = {
  [IMAGE_EDIT_OPERATION_IDS.blur]: '模糊',
  [IMAGE_EDIT_OPERATION_IDS.diffusion]: '柔光 / 发光',
  [IMAGE_EDIT_OPERATION_IDS.vgpuGlow]: '辉光 Pro',
};

export interface ImageEditLegacyMigrationOptionsV3 {
  width: number;
  height: number;
  sourceResourceId: string;
  documentId?: string;
  idFactory?: ImageEditIdFactoryV3;
}

export interface ImageEditLegacyMigrationResultV3 {
  document: ImageEditDocumentV3 | null;
  sourceFormat: 'v2' | 'v1' | 'mark-items' | 'invalid' | 'unknown-version';
  issues: string[];
}

function paramsToJson(params: object): ImageEditJsonObjectV3 {
  const cloned = cloneImageEditJsonObjectV3(params);
  if (!cloned) throw new TypeError('旧图片操作参数不是安全 JSON 对象');
  return cloned;
}

function createLegacyEffectLayer(
  operation: ImageEditOperation,
  layerId: string
): ImageEditEffectLayerV3 {
  const rawOperation = cloneImageEditJsonObjectV3(operation);
  if (!rawOperation) throw new TypeError('未知旧图片操作无法安全迁移');
  return {
    ...createImageEditLayerCommonV3(layerId, operation.operationId),
    type: 'effect',
    visible: operation.enabled,
    effectId: operation.operationId,
    params: paramsToJson(operation.params),
    renderable: false,
    legacyOperation: { sourceVersion: 2, operation: rawOperation },
  };
}

function createEffectLayer(
  operation: ImageEditOperation,
  layerId: string,
  sourceWidth: number,
  sourceHeight: number,
): ImageEditEffectLayerV3 {
  if (!RENDERABLE_EFFECT_IDS.has(operation.operationId)) {
    return createLegacyEffectLayer(operation, layerId);
  }
  return {
    ...createImageEditLayerCommonV3(layerId, EFFECT_NAMES[operation.operationId] ?? operation.operationId),
    type: 'effect',
    visible: operation.enabled,
    effectId: operation.operationId,
    params: operation.operationId === IMAGE_EDIT_OPERATION_IDS.blur
      ? legacyBlurParams(operation, sourceWidth, sourceHeight)
      : paramsToJson(operation.params),
    renderable: true,
  };
}

function legacyBlurParams(
  operation: ImageEditOperation,
  sourceWidth: number,
  sourceHeight: number,
): ImageEditJsonObjectV3 {
  const params = parseBlurOperationParams(operation.params);
  return {
    ...paramsToJson(params),
    // 旧执行器在完整源尺寸上把 strength 换算为 CSS blur sigma，并封顶 120px。
    radiusPixels: Math.min(120, params.strength * Math.min(sourceWidth, sourceHeight) * 0.04),
  };
}

function uniqueLayerId(
  preferred: string,
  seen: Set<string>,
  idFactory: ImageEditIdFactoryV3
): string {
  if (preferred && !seen.has(preferred)) {
    seen.add(preferred);
    return preferred;
  }
  let generated = idFactory('layer');
  while (seen.has(generated)) generated = idFactory('layer');
  seen.add(generated);
  return generated;
}

/** 把 V2 的真实像素顺序迁为：原图 → 既有效果 → 标注；几何不再伪装成图层。 */
export function migrateImageEditDocumentV2ToV3(
  source: ImageEditDocument,
  options: ImageEditLegacyMigrationOptionsV3
): ImageEditDocumentV3 {
  if (source.version !== IMAGE_EDIT_DOCUMENT_VERSION) {
    throw new TypeError('只支持迁移图片编辑 V2 文档');
  }
  const idFactory = options.idFactory ?? createImageEditIdV3;
  const geometry = createImageEditCanvasGeometryV3(options.width, options.height);
  const seenLayerIds = new Set<string>();
  const layers: ImageEditLayerV3[] = [createImageEditRasterLayerV3(
    uniqueLayerId('layer-base-raster', seenLayerIds, idFactory),
    '原图',
    options.sourceResourceId
  )];

  const orientation = source.operations.find(
    (operation) => operation.operationId === IMAGE_EDIT_OPERATION_IDS.orientation && operation.enabled
  );
  if (orientation) {
    const params = orientation.params as OrientationOperationParams;
    geometry.orientation = { rotate: params.rotate, mirrored: params.mirrored };
  }
  const crop = source.operations.find(
    (operation) => operation.operationId === IMAGE_EDIT_OPERATION_IDS.crop && operation.enabled
  );
  if (crop) {
    const params = crop.params as CropOperationParams;
    geometry.crop = params.rect ? { ...params.rect } : null;
  }

  for (const operation of source.operations) {
    if (
      operation.operationId === IMAGE_EDIT_OPERATION_IDS.orientation
      || operation.operationId === IMAGE_EDIT_OPERATION_IDS.annotations
      || operation.operationId === IMAGE_EDIT_OPERATION_IDS.crop
    ) continue;
    layers.push(createEffectLayer(
      operation,
      uniqueLayerId(`layer-${operation.id}`, seenLayerIds, idFactory),
      options.width,
      options.height,
    ));
  }

  const annotationOperation = source.operations.find(
    (operation) => operation.operationId === IMAGE_EDIT_OPERATION_IDS.annotations
  );
  const annotationItems = annotationOperation
    ? (annotationOperation.params as AnnotationOperationParams).items
    : [];
  if (annotationOperation && annotationItems.length > 0) {
    const annotationLayer = createImageEditAnnotationLayerV3(
      uniqueLayerId(`layer-${annotationOperation.id}`, seenLayerIds, idFactory),
      '标注'
    );
    annotationLayer.visible = annotationOperation.enabled;
    annotationLayer.annotations = annotationItems.map((item) => ({ ...item }));
    layers.push(annotationLayer);
  }

  return {
    version: IMAGE_EDIT_DOCUMENT_VERSION_V3,
    id: options.documentId ?? idFactory('document'),
    revision: 0,
    geometry,
    color: createDefaultImageEditColorModeV3(),
    layers,
  };
}

export function migrateLegacyImageEditDocumentToV3(
  value: unknown,
  options: ImageEditLegacyMigrationOptionsV3
): ImageEditLegacyMigrationResultV3 {
  const decoded = decodeImageEditDocument(value);
  if (decoded.sourceFormat === 'invalid' || decoded.sourceFormat === 'unknown-version') {
    return { document: null, sourceFormat: decoded.sourceFormat, issues: decoded.issues };
  }
  try {
    return {
      document: migrateImageEditDocumentV2ToV3(decoded.document, options),
      sourceFormat: decoded.sourceFormat,
      issues: decoded.issues,
    };
  } catch (error) {
    return {
      document: null,
      sourceFormat: decoded.sourceFormat,
      issues: [...decoded.issues, error instanceof Error ? error.message : 'legacy-migration-failed'],
    };
  }
}
