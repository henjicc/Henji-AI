export * from './domain/types';
export {
  createMarkId,
  parseMarkDoc,
  parseMarkItems,
  sanitizeMarkItem,
  stringifyMarkDoc,
  stringifyMarkItems,
} from './domain/codec';
export { coerceMarkSession } from './domain/legacy';
export { drawMarkItems, resolveNumberValues } from './render/drawMarks';
export { exportMarkedImage } from './render/exportMarkedImage';
export { MarkEditor, type MarkEditorDocumentController, type MarkEditorProps } from './editor/MarkEditor';
export { ViewerMarkEditor } from './viewer/ViewerMarkEditor';
export type { MarkEditorStyleState } from './editor/shared';

export {
  coerceImageEditSession,
  createEmptyImageEditDocument,
  createImageEditDocumentFromMarkDoc,
  decodeImageEditDocument,
  imageEditDocumentToMarkDoc,
  parseImageEditDocument,
  replaceMarkDocInImageEditDocument,
  stringifyImageEditDocument,
  toImageMarkSession,
} from '@/core/imageEdit';
export type { ImageEditDocument, ImageEditOperation, ImageEditSession } from '@/core/imageEdit';
