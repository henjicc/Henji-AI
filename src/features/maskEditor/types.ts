export type MaskStrokeMode = 'paint' | 'erase';

export interface MaskPoint {
  x: number;
  y: number;
}

export interface MaskStroke {
  id: string;
  mode: MaskStrokeMode;
  /** 以源图像素为单位，缩放预览不会改变真实笔刷尺寸。 */
  size: number;
  points: MaskPoint[];
}

/** 可持久化的遮罩编辑真相源；导出的 PNG 是它的派生结果。 */
export interface MaskEditorDocument {
  version: 1;
  sourceRef: string;
  width: number;
  height: number;
  strokes: MaskStroke[];
}

export interface MaskEditorResult {
  document: MaskEditorDocument;
  maskDataUrl: string;
  width: number;
  height: number;
}
