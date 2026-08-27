import {
  IMAGE_EDIT_DOCUMENT_VERSION,
  IMAGE_EDIT_OPERATION_IDS,
  createEmptyMarkDoc,
  isNeutralOrientation,
  type AnnotationOperationParams,
  type CropOperationParams,
  type ImageEditDocument,
  type ImageEditOperation,
  type ImageMarkDoc,
  type OrientationOperationParams,
} from './types';
import { imageEditOperationRegistry } from './operations';

const BUILT_IN_INSTANCE_IDS = {
  orientation: 'builtin-orientation',
  annotations: 'builtin-annotations',
  crop: 'builtin-crop',
} as const;

function createOrientationOperation(doc: ImageMarkDoc): ImageEditOperation<OrientationOperationParams> {
  return {
    id: BUILT_IN_INSTANCE_IDS.orientation,
    operationId: IMAGE_EDIT_OPERATION_IDS.orientation,
    enabled: true,
    params: { ...doc.orientation },
  };
}

function createAnnotationOperation(doc: ImageMarkDoc): ImageEditOperation<AnnotationOperationParams> {
  return {
    id: BUILT_IN_INSTANCE_IDS.annotations,
    operationId: IMAGE_EDIT_OPERATION_IDS.annotations,
    enabled: true,
    params: { items: doc.items },
  };
}

function createCropOperation(doc: ImageMarkDoc): ImageEditOperation<CropOperationParams> {
  return {
    id: BUILT_IN_INSTANCE_IDS.crop,
    operationId: IMAGE_EDIT_OPERATION_IDS.crop,
    enabled: true,
    params: { rect: doc.crop },
  };
}

export function createImageEditDocumentFromMarkDoc(doc: ImageMarkDoc): ImageEditDocument {
  return {
    version: IMAGE_EDIT_DOCUMENT_VERSION,
    operations: [
      createOrientationOperation(doc),
      createAnnotationOperation(doc),
      createCropOperation(doc),
    ],
  };
}

export function createEmptyImageEditDocument(): ImageEditDocument {
  return createImageEditDocumentFromMarkDoc(createEmptyMarkDoc());
}

/** 读取某个操作实例；实例不存在时返回 null。 */
export function getImageEditOperation<TParams extends object = object>(
  document: ImageEditDocument,
  operationId: string
): ImageEditOperation<TParams> | null {
  const operation = document.operations.find((entry) => entry.operationId === operationId);
  return (operation as ImageEditOperation<TParams> | undefined) ?? null;
}

/**
 * 插入或替换操作实例。
 * 新实例按注册表 order 插入，保证朝向 → 模糊/柔光/辉光 → 标注 → 裁剪的兼容顺序；
 * 已存在实例保留其文档 ID 和位置。
 */
export function upsertImageEditOperation<TParams extends object>(
  document: ImageEditDocument,
  operation: ImageEditOperation<TParams>
): ImageEditDocument {
  const existingIndex = document.operations.findIndex((entry) => entry.operationId === operation.operationId);
  if (existingIndex >= 0) {
    const operations = [...document.operations];
    operations[existingIndex] = { ...operation, id: operations[existingIndex].id };
    return { ...document, operations };
  }

  const definition = imageEditOperationRegistry.get(operation.operationId);
  const order = definition?.order ?? Number.MAX_SAFE_INTEGER;
  const insertIndex = document.operations.findIndex((entry) => {
    const entryOrder = imageEditOperationRegistry.get(entry.operationId)?.order ?? Number.MAX_SAFE_INTEGER;
    return entryOrder > order;
  });
  const operations = [...document.operations];
  if (insertIndex < 0) operations.push(operation);
  else operations.splice(insertIndex, 0, operation);
  return { ...document, operations };
}

export function createImageEditOperation<TParams extends object = object>(
  operationId: string,
  params: TParams,
  id = `${operationId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
): ImageEditOperation<TParams> {
  return { id, operationId, enabled: true, params };
}

export function imageEditDocumentToMarkDoc(document: ImageEditDocument): ImageMarkDoc {
  const doc = createEmptyMarkDoc();
  for (const operation of document.operations) {
    if (!operation.enabled) continue;
    if (operation.operationId === IMAGE_EDIT_OPERATION_IDS.orientation) {
      const params = operation.params as OrientationOperationParams;
      doc.orientation = { rotate: params.rotate, mirrored: params.mirrored };
    } else if (operation.operationId === IMAGE_EDIT_OPERATION_IDS.annotations) {
      const params = operation.params as AnnotationOperationParams;
      doc.items = params.items;
    } else if (operation.operationId === IMAGE_EDIT_OPERATION_IDS.crop) {
      const params = operation.params as CropOperationParams;
      doc.crop = params.rect;
    }
  }
  return doc;
}

/** 更新内置操作时保留未知操作和它们的相对位置。 */
export function replaceMarkDocInImageEditDocument(
  document: ImageEditDocument,
  markDoc: ImageMarkDoc
): ImageEditDocument {
  const replacements = new Map<string, ImageEditOperation>([
    [IMAGE_EDIT_OPERATION_IDS.orientation, createOrientationOperation(markDoc)],
    [IMAGE_EDIT_OPERATION_IDS.annotations, createAnnotationOperation(markDoc)],
    [IMAGE_EDIT_OPERATION_IDS.crop, createCropOperation(markDoc)],
  ]);
  const seen = new Set<string>();
  const operations = document.operations.map((operation) => {
    const replacement = replacements.get(operation.operationId);
    if (!replacement || seen.has(operation.operationId)) return operation;
    seen.add(operation.operationId);
    return { ...replacement, id: operation.id, enabled: operation.enabled };
  });

  if (!seen.has(IMAGE_EDIT_OPERATION_IDS.orientation)) operations.unshift(createOrientationOperation(markDoc));
  if (!seen.has(IMAGE_EDIT_OPERATION_IDS.annotations)) {
    const cropIndex = operations.findIndex((operation) => operation.operationId === IMAGE_EDIT_OPERATION_IDS.crop);
    operations.splice(cropIndex < 0 ? operations.length : cropIndex, 0, createAnnotationOperation(markDoc));
  }
  if (!seen.has(IMAGE_EDIT_OPERATION_IDS.crop)) operations.push(createCropOperation(markDoc));

  return { ...document, operations };
}

export function hasImageEditEffect(document: ImageEditDocument): boolean {
  return document.operations.some((operation) => {
    if (!operation.enabled) return false;
    const definition = imageEditOperationRegistry.get(operation.operationId);
    if (definition?.hasEffect) {
      return definition.hasEffect(operation.params);
    }
    if (operation.operationId === IMAGE_EDIT_OPERATION_IDS.orientation) {
      return !isNeutralOrientation(operation.params as OrientationOperationParams);
    }
    if (operation.operationId === IMAGE_EDIT_OPERATION_IDS.annotations) {
      return (operation.params as AnnotationOperationParams).items.length > 0;
    }
    if (operation.operationId === IMAGE_EDIT_OPERATION_IDS.crop) {
      return (operation.params as CropOperationParams).rect !== null;
    }
    return true;
  });
}
