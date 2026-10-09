/** 蒙版文档与纯策略公开入口；不依赖编辑器 UI 或执行器。 */
export {
  appendMaskPoint,
  appendMaskStroke,
  cloneMaskDocument,
  createEmptyMaskDocument,
  createMaskHistoryState,
  fitMaskStage,
  hasPaintedMask,
  isMaskShape,
  isMaskStroke,
  parseMaskEditorDocument,
  reduceMaskHistory,
  resolveMaskShapeBounds,
  resolveMaskDocument,
} from './maskDocument';
export type {
  MaskEditorDocument,
  MaskEditorResult,
  MaskEditorV3Result,
  MaskPoint,
  MaskMark,
  MaskShape,
  MaskShapeKind,
  MaskStroke,
  MaskStrokeMode,
  MaskTool,
} from './types';
