import {
  imageEditMarkItemSchema,
  imageEditOperationSchema,
  type ImageEditControlOperation,
} from './imageEditControlCatalog';
import {
  createEmptyMarkDoc,
  createImageEditDocumentFromMarkDoc,
  createMarkId,
  imageEditDocumentToMarkDoc,
  replaceMarkDocInImageEditDocument,
  type ImageEditDocument,
  type MarkItem,
} from '@/core/imageEdit';
import {
  applyOrientationOpToDoc,
  type OrientationOp,
} from '@/features/imageMark/domain/geometry';

export interface AssistantImageEditSourceSize {
  width: number;
  height: number;
}

const ORIENTATION_OPERATIONS: Record<
  Extract<ImageEditControlOperation['kind'], 'rotate_cw' | 'rotate_ccw' | 'flip_h' | 'flip_v'>,
  OrientationOp
> = {
  rotate_cw: 'rotate-cw',
  rotate_ccw: 'rotate-ccw',
  flip_h: 'flip-h',
  flip_v: 'flip-v',
};

function isOrientationOperation(
  operation: ImageEditControlOperation
): operation is Extract<
  ImageEditControlOperation,
  { kind: 'rotate_cw' | 'rotate_ccw' | 'flip_h' | 'flip_v' }
> {
  return operation.kind === 'rotate_cw'
    || operation.kind === 'rotate_ccw'
    || operation.kind === 'flip_h'
    || operation.kind === 'flip_v';
}

export function buildImageEditDocumentFromControlOperations(
  values: readonly unknown[],
  sourceSize: AssistantImageEditSourceSize,
  existingDocument?: ImageEditDocument
): ImageEditDocument {
  let doc = existingDocument ? imageEditDocumentToMarkDoc(existingDocument) : createEmptyMarkDoc();
  let currentWidth = sourceSize.width;
  let currentHeight = sourceSize.height;
  if (doc.orientation.rotate === 90 || doc.orientation.rotate === 270) {
    [currentWidth, currentHeight] = [currentHeight, currentWidth];
  }

  for (const value of values) {
    const operation = imageEditOperationSchema.parse(value);
    if (isOrientationOperation(operation)) {
      const turns = operation.kind === 'rotate_cw' || operation.kind === 'rotate_ccw'
        ? (operation.degrees ?? 90) / 90
        : 1;
      for (let turn = 0; turn < turns; turn += 1) {
        doc = applyOrientationOpToDoc(
          doc,
          currentWidth,
          currentHeight,
          ORIENTATION_OPERATIONS[operation.kind]
        );
        if (operation.kind === 'rotate_cw' || operation.kind === 'rotate_ccw') {
          [currentWidth, currentHeight] = [currentHeight, currentWidth];
        }
      }
      continue;
    }

    if (operation.kind === 'crop') {
      const crop = operation.crop;
      if (
        crop.x < 0
        || crop.y < 0
        || crop.x + crop.width > currentWidth
        || crop.y + crop.height > currentHeight
      ) {
        throw new Error('INVALID_INPUT');
      }
      doc = { ...doc, crop };
      continue;
    }

    const parsed = imageEditMarkItemSchema.parse(operation.item);
    const item = { ...parsed, id: parsed.id ?? createMarkId() } as MarkItem;
    doc = { ...doc, items: [...doc.items, item] };
  }

  return existingDocument
    ? replaceMarkDocInImageEditDocument(existingDocument, doc)
    : createImageEditDocumentFromMarkDoc(doc);
}
