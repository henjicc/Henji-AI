/**
 * 标注绘制组件的核心类型入口。
 * 新增图片编辑能力统一从 `@/core/imageEdit` 消费核心契约。
 */
export {
  createEmptyMarkDoc,
  createEmptyMarkOrientation,
  isLabeledMark,
  isNeutralOrientation,
} from '@/core/imageEdit';

export type {
  ArrowMark,
  EllipseMark,
  ImageMarkDoc,
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
