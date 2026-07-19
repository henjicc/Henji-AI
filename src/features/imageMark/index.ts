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
export { MarkEditor, type MarkEditorProps } from './editor/MarkEditor';
export type { MarkEditorStyleState } from './editor/shared';
