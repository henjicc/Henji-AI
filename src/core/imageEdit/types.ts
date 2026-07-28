/** 图片编辑核心类型，不依赖 React、画布宿主或 Electron 实现。 */

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
  strengthPercent?: number;
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

/** 朝向 = 先水平镜像再顺时针旋转。 */
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

/** V1 兼容文档：坐标位于当前朝向下的图片像素空间。 */
export interface ImageMarkDoc {
  version: 1;
  items: MarkItem[];
  orientation: MarkOrientation;
  crop: MarkCropRect | null;
}

/** V1 兼容会话，第三阶段完成前保持公开。 */
export interface ImageMarkSession {
  sourceUrl: string;
  doc: ImageMarkDoc;
}

export const IMAGE_EDIT_DOCUMENT_VERSION = 2 as const;

export const IMAGE_EDIT_OPERATION_IDS = {
  orientation: 'image.orientation',
  diffusion: 'image.diffusion',
  annotations: 'image.annotations',
  crop: 'image.crop',
} as const;

export type BuiltInImageEditOperationId =
  typeof IMAGE_EDIT_OPERATION_IDS[keyof typeof IMAGE_EDIT_OPERATION_IDS];

export interface ImageEditOperation<TParams extends object = object> {
  /** 文档内的操作实例 ID。 */
  id: string;
  /** 注册表中的稳定能力 ID。 */
  operationId: string;
  enabled: boolean;
  params: TParams;
}

export interface ImageEditDocument {
  version: typeof IMAGE_EDIT_DOCUMENT_VERSION;
  /** 数组顺序就是执行顺序。 */
  operations: ImageEditOperation[];
}

export interface ImageEditSession {
  sourceUrl: string;
  document: ImageEditDocument;
}

export interface OrientationOperationParams {
  rotate: MarkRotation;
  mirrored: boolean;
}

export interface AnnotationOperationParams {
  items: MarkItem[];
}

export interface CropOperationParams {
  rect: MarkCropRect | null;
}

export type DiffusionMode = 'black_mist' | 'white_mist' | 'glow';
/**
 * 档位。柔光滤镜档位在摄影里习惯写成 1/8、1/4、1/2，而纯辉光没有这个传统，
 * 所以这里存语义值，由 UI 按 mode 决定显示成「1/8」还是「弱」。
 */
export type DiffusionDensity = 'low' | 'medium' | 'high';
export type DiffusionQuality = 'realtime' | 'high';

/**
 * 摄影柔光/辉光操作参数。
 * 半径使用图片空间归一化值，不能写入屏幕像素或 CSS 尺寸。
 */
/**
 * 给辉光染色。色相/饱和度按 HSL 语义，亮度是对散射光的增减。
 * 着色只作用于散射光，不改变直接光，因此不会整体偏色。
 */
export interface DiffusionTintParams {
  enabled: boolean;
  /** 0..360 */
  hue: number;
  /** 0..1 */
  saturation: number;
  /** -1..1 */
  lightness: number;
  /**
   * 0..1 核心白热。辉光最亮处向白靠拢、只有尾部吃染色。
   * 平铺一个颜色会像蒙了张色纸，因为真实光源的核心总是先到白再往外显色。
   */
  coreWhite: number;
}

/**
 * 用户可调的柔光参数。
 *
 * 这里只保留用户能直观理解的七个量，每个可能驱动多个底层光学参数（映射见
 * `diffusionRecipe.ts`）。像微扩散、雾幕、高光压缩这类区分黑柔/白柔的量**不在这里**——
 * 它们由 `mode` 派生，因为把它们做成独立滑块既没人看得懂，调错了还会让黑柔和白柔
 * 退化成同一个效果的强弱差别。
 */
export interface DiffusionOperationParams {
  schemaVersion: 3;
  mode: DiffusionMode;
  /** 档位：与 mode 一起决定基准参数组 */
  density: DiffusionDensity;
  quality: DiffusionQuality;
  /** 效果强度 0..1 */
  strength: number;
  /** 辉光范围 0..1 → 近/远散射半径 */
  glowRange: number;
  /** 高光响应 0..1 → 阈值 EV 与柔化拐点（越大越多区域参与发光） */
  highlightResponse: number;
  /** 光斑柔和度 0..1 → 长尾量与长尾形状 */
  softness: number;
  /** 黑位保持 0..1 */
  blackRetention: number;
  /** 细节保留 0..1 → 高频/中频保留 */
  detailRetention: number;
  /** 色彩保持 0..1 → 反向驱动散射去饱和 */
  colorRetention: number;
  /**
   * 辉光曝光 0..1 → 线性叠加增益（仅辉光模式）。
   * 摄影柔光要守恒，辉光不用：把光源推到过曝、让相邻光晕互相融合正是辉光的观感来源，
   * 因此这里的量程刻意允许 > 1，溢出交给「高光滚降」在合成末端统一收。
   */
  glowExposure: number;
  /** 高光滚降 0..1 → 合成末端保色相肩部的强度（仅辉光模式） */
  highlightRolloff: number;
  tint: DiffusionTintParams;
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

export function hasMarkEffect(doc: ImageMarkDoc): boolean {
  return doc.items.length > 0 || !isNeutralOrientation(doc.orientation) || doc.crop !== null;
}

export function isLabeledMark(item: MarkItem): item is LabeledMark {
  return item.type === 'rect' || item.type === 'ellipse' || item.type === 'arrow';
}
