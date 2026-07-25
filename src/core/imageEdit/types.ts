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
export type DiffusionDensity = '1/8' | '1/4' | '1/2' | '1';
export type DiffusionQuality = 'realtime' | 'high';

/**
 * 摄影柔光/辉光操作参数。
 * 半径使用图片空间归一化值，不能写入屏幕像素或 CSS 尺寸。
 */
export interface DiffusionOperationParams {
  schemaVersion: 1;
  mode: DiffusionMode;
  presetId: string | null;
  strength: number;
  density: DiffusionDensity;
  source: {
    thresholdEV: number;
    softKneeEV: number;
    power: number;
    highlightRecovery: number;
  };
  scatter: {
    highlightAmount: number;
    microAmount: number;
    nearRadius: number;
    farRadius: number;
    tailAmount: number;
    tailShape: number;
    anisotropy: number;
    angle: number;
    chromaticSpread: number;
  };
  tone: {
    veil: number;
    blackRetention: number;
    highlightCompression: number;
    scatterDesaturation: number;
  };
  detail: {
    highFrequencyRetention: number;
    midFrequencyRetention: number;
  };
  lens: {
    focalLengthEq: number;
    aperture: number;
    positionVariation: number;
  };
  quality: DiffusionQuality;
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
