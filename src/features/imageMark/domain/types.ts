/**
 * 旧 imageMark 入口的兼容导出。
 * 新增图片编辑能力统一从 `@/core/imageEdit` 消费核心契约。
 */
export {
  createEmptyMarkDoc,
  createEmptyMarkOrientation,
  hasMarkEffect,
  isLabeledMark,
  isNeutralOrientation,
} from '@/core/imageEdit';

export type {
  ArrowMark,
  EllipseMark,
  ImageMarkDoc,
  ImageMarkSession,
  LabeledMark,
  MarkCropRect,
  MarkItem,
  MarkOrientation,
  MarkRotation,
  MarkShapeStyle,
  MarkToolType,
  MosaicMark,
  MosaicMode,
  NumberMark,
  PenMark,
  RectMark,
  TextMark,
} from '@/core/imageEdit';
