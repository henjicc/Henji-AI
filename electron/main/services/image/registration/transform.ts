import type { SimilarityTransform } from "./types";

export function transformComponents(transform: SimilarityTransform) {
  return {
    a: transform.a,
    b: transform.b,
    c: transform.c ?? -transform.b,
    d: transform.d ?? transform.a,
  };
}

export function transformPoint(
  transform: SimilarityTransform,
  x: number,
  y: number,
) {
  const { a, b, c, d } = transformComponents(transform);
  return { x: a * x + c * y + transform.tx, y: b * x + d * y + transform.ty };
}

export function inverseTransformPoint(
  transform: SimilarityTransform,
  x: number,
  y: number,
): { x: number; y: number } | null {
  const { a, b, c, d } = transformComponents(transform);
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-8) return null;
  const dx = x - transform.tx;
  const dy = y - transform.ty;
  return {
    x: (d * dx - c * dy) / determinant,
    y: (-b * dx + a * dy) / determinant,
  };
}

export function transformScales(transform: SimilarityTransform) {
  const { a, b, c, d } = transformComponents(transform);
  return { scaleX: Math.hypot(a, b), scaleY: Math.hypot(c, d) };
}

/** Convert a transform between uniformly scaled, pixel-center coordinate
 * spaces where x' = scale * (x + 0.5) - 0.5. */
export function scaleTransformCoordinates(
  transform: SimilarityTransform,
  coordinateScale: number,
): SimilarityTransform {
  const { a, b, c, d } = transformComponents(transform);
  const centerOffset = (coordinateScale - 1) / 2;
  return {
    ...transform,
    tx: transform.tx * coordinateScale + centerOffset * (1 - a - c),
    ty: transform.ty * coordinateScale + centerOffset * (1 - b - d),
  };
}

/** Convert a frame-space registration matrix into Photoshop's constrained
 * scale/rotate-around-center plus document-space translation parameters. */
export function registrationPlacement(
  transform: SimilarityTransform,
  frame: { width: number; height: number },
  region: { width: number; height: number },
) {
  const { a, b, c, d } = transformComponents(transform);
  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);
  const angle = (Math.atan2(b, a) * 180) / Math.PI;
  // Registration coordinates address pixel centers from 0 to size - 1.
  const centerX = (frame.width - 1) / 2;
  const centerY = (frame.height - 1) / 2;
  const mappedCenterX = a * centerX + c * centerY + transform.tx;
  const mappedCenterY = b * centerX + d * centerY + transform.ty;
  return {
    scaleX,
    scaleY,
    angle,
    offsetX: ((mappedCenterX - centerX) * region.width) / frame.width,
    offsetY: ((mappedCenterY - centerY) * region.height) / frame.height,
  };
}
