import type { MarkOrientation, MarkRotation, MarkCropRect } from '../types';
import { MIN_IMAGE_EDIT_CROP_SIZE_PX } from '../constraints';
export { MIN_IMAGE_EDIT_CROP_SIZE_PX } from '../constraints';
export function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
export type OrientationOp = 'rotate-cw' | 'rotate-ccw' | 'flip-h' | 'flip-v';

const ROTATIONS: MarkRotation[] = [0, 90, 180, 270];

function normalizeRotation(value: number): MarkRotation {
  const normalized = ((value % 360) + 360) % 360;
  return ROTATIONS.includes(normalized as MarkRotation) ? (normalized as MarkRotation) : 0;
}

/**
 * 朝向合成:整体变换 = R(rotate) ∘ MirrorH^mirrored。
 * 在现有朝向上叠加一个新操作,归一化回 {rotate, mirrored}。
 */
export function composeOrientation(orientation: MarkOrientation, op: OrientationOp): MarkOrientation {
  const { rotate, mirrored } = orientation;
  switch (op) {
    case 'rotate-cw':
      return { rotate: normalizeRotation(rotate + 90), mirrored };
    case 'rotate-ccw':
      return { rotate: normalizeRotation(rotate - 90), mirrored };
    case 'flip-h':
      // Fh ∘ R(r) = R(-r) ∘ Fh
      return { rotate: normalizeRotation(-rotate), mirrored: !mirrored };
    case 'flip-v':
      // Fv = R(180) ∘ Fh
      return { rotate: normalizeRotation(180 - rotate), mirrored: !mirrored };
  }
}

export function orientedSizeAfterOp(
  width: number,
  height: number,
  op: OrientationOp
): { width: number; height: number } {
  if (op === 'rotate-cw' || op === 'rotate-ccw') {
    return { width: height, height: width };
  }
  return { width, height };
}

export function orientedSize(
  width: number,
  height: number,
  orientation: MarkOrientation
): { width: number; height: number } {
  if (orientation.rotate === 90 || orientation.rotate === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

export function clampCropRect(
  crop: MarkCropRect,
  width: number,
  height: number,
  minSize = MIN_IMAGE_EDIT_CROP_SIZE_PX
): MarkCropRect {
  const w = clamp(crop.width, minSize, width);
  const h = clamp(crop.height, minSize, height);
  return {
    x: clamp(crop.x, 0, Math.max(0, width - w)),
    y: clamp(crop.y, 0, Math.max(0, height - h)),
    width: w,
    height: h,
  };
}
