/**
 * 标注绘制组件的核心类型入口。
 * 新增图片编辑能力统一从 `@/core/imageEdit` 消费核心契约。
 */
export {
  createEmptyMarkOrientation,
  isLabeledMark,
  isNeutralOrientation,
} from '@/core/imageEdit';

export type {
  ArrowMark,
  EllipseMark,
  LabeledMark,
  MarkCropRect,
  MarkItem,
  MarkOrientation,
  MarkRotation,
  MarkShapeStyle,
  MarkToolType,
  NumberMark,
  PenMark,
  RectMark,
  TextMark,
} from '@/core/imageEdit';
