/**
 * 图片编辑(快速标记)统一数据模型。
 * 坐标一律为"当前朝向下的图片像素坐标";朝向与裁剪独立存放,导出时最后应用裁剪。
 * 字段命名与旧画布标注 JSON 保持兼容(id/type/x/y/width/height/stroke/lineWidth/points/text/color/fontSize)。
 */

export type MarkToolType =
  | 'select'
  | 'callout'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'pen'
  | 'text'
  | 'number'
  | 'mosaic'
  | 'crop';

export interface MarkShapeStyle {
  stroke: string;
  lineWidth: number;
}

/** 标签字段:文本挂在图形上,跟随图形移动;labelDx/Dy 为用户拖动后的相对偏移(相对图形参考点) */
interface MarkLabelFields {
  label?: string;
  labelFontSize?: number;
  labelDx?: number;
  labelDy?: number;
}

export interface RectMark extends MarkShapeStyle, MarkLabelFields {
  id: string;
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EllipseMark extends MarkShapeStyle, MarkLabelFields {
  id: string;
  type: 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArrowMark extends MarkShapeStyle, MarkLabelFields {
  id: string;
  type: 'arrow';
  points: [number, number, number, number];
}

export interface PenMark extends MarkShapeStyle {
  id: string;
  type: 'pen';
  points: number[];
}

export interface TextMark {
  id: string;
  type: 'text';
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

/** 序号徽标:x/y 为圆心;显示数字由同类项在 items 中的先后顺序推导,删除中间项自动重排 */
export interface NumberMark {
  id: string;
  type: 'number';
  x: number;
  y: number;
  color: string;
  fontSize: number;
}

export type MosaicMode = 'pixel' | 'blur';

export interface MosaicMark {
  id: string;
  type: 'mosaic';
  x: number;
  y: number;
  width: number;
  height: number;
  /** 打码强度:色块边长占图片短边的百分比,缺省用 DEFAULT_MOSAIC_STRENGTH_PERCENT */
  strengthPercent?: number;
  /** pixel=马赛克(默认);blur=高斯模糊 */
  mode?: MosaicMode;
}

export type MarkItem =
  | RectMark
  | EllipseMark
  | ArrowMark
  | PenMark
  | TextMark
  | NumberMark
  | MosaicMark;

export type LabeledMark = RectMark | EllipseMark | ArrowMark;

export type MarkRotation = 0 | 90 | 180 | 270;

/** 朝向 = 先水平镜像(mirrored)再旋转 rotate 度(顺时针) */
export interface MarkOrientation {
  rotate: MarkRotation;
  mirrored: boolean;
}

export interface MarkCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageMarkDoc {
  version: 1;
  items: MarkItem[];
  orientation: MarkOrientation;
  /** 当前朝向坐标系下的裁剪区域;null 表示不裁剪 */
  crop: MarkCropRect | null;
}

/** 编辑会话:记录标记文档与其作用的原图,支持非破坏性再编辑 */
export interface ImageMarkSession {
  sourceUrl: string;
  doc: ImageMarkDoc;
}

export function createEmptyMarkOrientation(): MarkOrientation {
  return { rotate: 0, mirrored: false };
}

export function createEmptyMarkDoc(): ImageMarkDoc {
  return {
    version: 1,
    items: [],
    orientation: createEmptyMarkOrientation(),
    crop: null,
  };
}

export function isNeutralOrientation(orientation: MarkOrientation): boolean {
  return orientation.rotate === 0 && !orientation.mirrored;
}

/** 文档是否会对图片产生实际修改 */
export function hasMarkEffect(doc: ImageMarkDoc): boolean {
  return doc.items.length > 0 || !isNeutralOrientation(doc.orientation) || doc.crop !== null;
}

export function isLabeledMark(item: MarkItem): item is LabeledMark {
  return item.type === 'rect' || item.type === 'ellipse' || item.type === 'arrow';
}
