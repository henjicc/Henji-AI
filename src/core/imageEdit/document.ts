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
