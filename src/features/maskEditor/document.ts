/** 蒙版文档与纯策略公开入口；不依赖编辑器 UI 或执行器。 */
export {
  cloneMaskDocument,
  hasPaintedMask,
  parseMaskEditorDocument,
} from './maskDocument';
export type {
  MaskEditorDocument,
  MaskEditorResult,
} from './types';
