import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference';

export type MaskStrokeMode = 'paint' | 'erase';
export type MaskTool = 'brush' | 'rectangle' | 'circle' | 'lasso';
export type MaskShapeKind = 'rectangle' | 'circle' | 'lasso';

export interface MaskPoint {
  x: number;
  y: number;
}

export interface MaskStroke {
  id: string;
  /** 旧文档没有 kind；缺省与 stroke 等价。 */
  kind?: 'stroke';
  mode: MaskStrokeMode;
  /** 以源图像素为单位，缩放预览不会改变真实笔刷尺寸。 */
  size: number;
  /** 0~1，1 为硬边；旧文档缺省时按 1 处理。 */
  hardness?: number;
  points: MaskPoint[];
}

export interface MaskShape {
  id: string;
  kind: MaskShapeKind;
  mode: MaskStrokeMode;
  /** 矩形/圆形存起止点，自由框选存开放轨迹并在渲染时自动闭合。 */
  points: MaskPoint[];
}

export type MaskMark = MaskStroke | MaskShape;

/** 可持久化的遮罩编辑真相源；导出的 PNG 是它的派生结果。 */
export interface MaskEditorDocument {
  version: 1;
  sourceRef: string;
  width: number;
  height: number;
  /** 兼容旧字段名；其中可同时保存笔触与区域选择。 */
  strokes: MaskMark[];
}

export interface MaskEditorResult {
  document: MaskEditorDocument;
  maskDataUrl: string;
  width: number;
  height: number;
}

export interface MaskEditorV3Result {
  kind: 'image-edit-v3-mask';
  sessionReference: ImageEditSessionReferenceV3;
  targetLayerId: string;
}
