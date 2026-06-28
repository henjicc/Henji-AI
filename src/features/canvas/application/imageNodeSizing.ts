import { parseAspectRatio } from './imageData';

export interface ImageNodeSize {
  width: number;
  height: number;
}

export interface ImageNodeMinSize {
  minWidth: number;
  minHeight: number;
}

function roundPositive(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.round(value));
}

export function resolveAspectRatioValue(aspectRatio: string): number {
  return Math.max(0.1, parseAspectRatio(aspectRatio));
}

function resolveMinSizeByRatio(
  ratio: number,
  constraints: ImageNodeMinSize
): ImageNodeSize {
  const safeRatio = Math.max(0.1, ratio);
  const minWidth = roundPositive(constraints.minWidth);
  const minHeight = roundPositive(constraints.minHeight);
  const minRatio = minWidth / Math.max(1, minHeight);

  if (safeRatio >= minRatio) {
    return {
      width: roundPositive(minHeight * safeRatio),
      height: minHeight,
    };
  }

  return {
    width: minWidth,
    height: roundPositive(minWidth / safeRatio),
  };
}

export function resolveMinEdgeFittedSize(
  aspectRatio: string,
  constraints: ImageNodeMinSize
): ImageNodeSize {
  const ratio = resolveAspectRatioValue(aspectRatio);
  return resolveMinSizeByRatio(ratio, constraints);
}

/** 缩放时单边允许贴合宽高比收缩的绝对下限，避免窄边无限变小 */
const RESIZE_MIN_EDGE_FLOOR = 64;

export function resolveResizeMinConstraintsByAspect(
  aspectRatio: string,
  constraints: ImageNodeMinSize
): ImageNodeMinSize {
  const ratio = resolveAspectRatioValue(aspectRatio);
  const baseMinWidth = roundPositive(constraints.minWidth);
  const baseMinHeight = roundPositive(constraints.minHeight);

  if (ratio >= 1) {
    const fittedHeight = Math.max(RESIZE_MIN_EDGE_FLOOR, roundPositive(baseMinWidth / ratio));
    return { minWidth: baseMinWidth, minHeight: Math.min(fittedHeight, baseMinHeight) };
  }

  const fittedWidth = Math.max(RESIZE_MIN_EDGE_FLOOR, roundPositive(baseMinHeight * ratio));
  return { minWidth: Math.min(fittedWidth, baseMinWidth), minHeight: baseMinHeight };
}

export function resolveSizeInsideTargetBox(
  aspectRatio: string,
  target: ImageNodeSize
): ImageNodeSize {
  const ratio = resolveAspectRatioValue(aspectRatio);
  const targetWidth = roundPositive(target.width);
  const targetHeight = roundPositive(target.height);
  const targetRatio = targetWidth / Math.max(1, targetHeight);

  if (ratio >= targetRatio) {
    return {
      width: targetWidth,
      height: roundPositive(targetWidth / ratio),
    };
  }

  return {
    width: roundPositive(targetHeight * ratio),
    height: targetHeight,
  };
}

/**
 * 用于上传类节点的自适应自动适配：在“当前参考尺寸”内按新比例收缩适配，
 * 若结果小于按比例换算的最小可拖拽尺寸，则直接贴底到该最小尺寸。
 * 首次上传时传入最小尺寸作为参考尺寸，效果等同于退化到最小尺寸；
 * 重新上传时传入节点当前尺寸作为参考尺寸，从而保留用户已手动调整过的“体感大小”。
 */
export function resolveAdaptiveAutoFitSize(
  aspectRatio: string,
  currentSize: ImageNodeSize,
  constraints: ImageNodeMinSize
): ImageNodeSize {
  const floor = resolveResizeMinConstraintsByAspect(aspectRatio, constraints);
  const fitted = resolveSizeInsideTargetBox(aspectRatio, currentSize);

  if (fitted.width < floor.minWidth || fitted.height < floor.minHeight) {
    return { width: floor.minWidth, height: floor.minHeight };
  }

  return fitted;
}

export function ensureAtLeastOneMinEdge(
  size: ImageNodeSize,
  constraints: ImageNodeMinSize
): ImageNodeSize {
  const minWidth = roundPositive(constraints.minWidth);
  const minHeight = roundPositive(constraints.minHeight);
  const width = roundPositive(size.width);
  const height = roundPositive(size.height);
  const ratio = width / Math.max(1, height);

  if (width >= minWidth && height >= minHeight) {
    return { width, height };
  }

  return resolveMinSizeByRatio(ratio, { minWidth, minHeight });
}
