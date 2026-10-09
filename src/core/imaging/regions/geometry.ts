import { REGION_AA_SAMPLES_PER_AXIS, type RegionPoint, type RegionGeometry } from './contracts';

const MAX_DOCUMENT_DIMENSION = 1_048_576;
const MAX_DOCUMENT_PIXELS = 4_294_967_296;
const MAX_ABSOLUTE_SHAPE_COORDINATE = 1_000_000_000;

export interface RegionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function assertRegionGrid(
  canvas: { width: number; height: number },
): void {
  if (!Number.isSafeInteger(canvas.width) || !Number.isSafeInteger(canvas.height)
    || canvas.width < 1 || canvas.height < 1
    || canvas.width > MAX_DOCUMENT_DIMENSION || canvas.height > MAX_DOCUMENT_DIMENSION
    || canvas.width * canvas.height > MAX_DOCUMENT_PIXELS) {
    throw new Error('选区文档尺寸超出安全范围');
  }
}

function assertCoordinate(value: number, label: string): void {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_SHAPE_COORDINATE) {
    throw new Error(`${label}必须是安全范围内的有限数`);
  }
}

function normalizedRect(
  shape: Extract<RegionGeometry, { type: 'rectangle' | 'ellipse' }>,
): RegionBounds {
  assertCoordinate(shape.x, '选区 x');
  assertCoordinate(shape.y, '选区 y');
  assertCoordinate(shape.width, '选区宽度');
  assertCoordinate(shape.height, '选区高度');
  const right = shape.x + shape.width;
  const bottom = shape.y + shape.height;
  assertCoordinate(right, '选区右边界');
  assertCoordinate(bottom, '选区下边界');
  return {
    left: Math.min(shape.x, right),
    top: Math.min(shape.y, bottom),
    right: Math.max(shape.x, right),
    bottom: Math.max(shape.y, bottom),
  };
}

function assertLasso(shape: Extract<RegionGeometry, { type: 'lasso' }>): void {
  if (!Array.isArray(shape.points) || shape.points.length < 3) {
    throw new Error('自由套索至少需要 3 个点');
  }
  shape.points.forEach((point, index) => {
    if (!point || typeof point !== 'object') throw new Error(`自由套索第 ${index + 1} 个点无效`);
    assertCoordinate(point.x, `自由套索第 ${index + 1} 个点 x`);
    assertCoordinate(point.y, `自由套索第 ${index + 1} 个点 y`);
  });
}

export function normalizeRegionGeometry(
  shape: RegionGeometry,
): RegionGeometry {
  if (!shape || typeof shape !== 'object') throw new Error('选区形状无效');
  if (shape.type === 'rectangle' || shape.type === 'ellipse') {
    const bounds = normalizedRect(shape);
    return {
      type: shape.type,
      x: bounds.left,
      y: bounds.top,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
    };
  }
  if (shape.type !== 'lasso') throw new Error('不支持的选区形状');
  assertLasso(shape);
  return {
    type: 'lasso',
    points: shape.points.map((point) => ({ x: point.x, y: point.y })),
  };
}

export function regionGeometryBounds(
  shape: RegionGeometry,
): RegionBounds {
  if (shape.type !== 'lasso') return normalizedRect(shape);
  assertLasso(shape);
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of shape.points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { left, top, right, bottom };
}

export function clipRegionBounds(
  bounds: RegionBounds,
  canvas: { width: number; height: number },
): RegionBounds {
  return {
    left: Math.max(0, Math.min(canvas.width, bounds.left)),
    top: Math.max(0, Math.min(canvas.height, bounds.top)),
    right: Math.max(0, Math.min(canvas.width, bounds.right)),
    bottom: Math.max(0, Math.min(canvas.height, bounds.bottom)),
  };
}

function sampleInsideEllipse(
  sampleX: number,
  sampleY: number,
  bounds: RegionBounds,
): boolean {
  const radiusX = (bounds.right - bounds.left) / 2;
  const radiusY = (bounds.bottom - bounds.top) / 2;
  if (radiusX <= 0 || radiusY <= 0) return false;
  const centerX = bounds.left + radiusX;
  const centerY = bounds.top + radiusY;
  const dx = (sampleX - centerX) / radiusX;
  const dy = (sampleY - centerY) / radiusY;
  return dx * dx + dy * dy <= 1;
}

function sampleInsideLasso(
  sampleX: number,
  sampleY: number,
  points: readonly RegionPoint[],
): boolean {
  let inside = false;
  let previous = points[points.length - 1];
  for (const current of points) {
    const crosses = (current.y > sampleY) !== (previous.y > sampleY);
    if (crosses) {
      const intersectionX = current.x
        + ((sampleY - current.y) * (previous.x - current.x)) / (previous.y - current.y);
      if (sampleX < intersectionX) inside = !inside;
    }
    previous = current;
  }
  return inside;
}

/**
 * 矩形使用精确像素面积；椭圆与自由套索使用固定 4×4 子像素中心采样。
 * 固定采样位置使预览、导出和不同宿主得到逐位一致的 Float32 覆盖率。
 */
export function regionPixelCoverage(
  shape: RegionGeometry,
  pixelX: number,
  pixelY: number,
): number {
  if (shape.type === 'rectangle') {
    const bounds = normalizedRect(shape);
    const horizontal = Math.max(0, Math.min(pixelX + 1, bounds.right) - Math.max(pixelX, bounds.left));
    const vertical = Math.max(0, Math.min(pixelY + 1, bounds.bottom) - Math.max(pixelY, bounds.top));
    return Math.min(1, horizontal * vertical);
  }

  const samples = REGION_AA_SAMPLES_PER_AXIS;
  const bounds = regionGeometryBounds(shape);
  let insideCount = 0;
  for (let sampleY = 0; sampleY < samples; sampleY += 1) {
    const y = pixelY + (sampleY + 0.5) / samples;
    for (let sampleX = 0; sampleX < samples; sampleX += 1) {
      const x = pixelX + (sampleX + 0.5) / samples;
      const inside = shape.type === 'ellipse'
        ? sampleInsideEllipse(x, y, bounds)
        : sampleInsideLasso(x, y, shape.points);
      if (inside) insideCount += 1;
    }
  }
  return insideCount / (samples * samples);
}
