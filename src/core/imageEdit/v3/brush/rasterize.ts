import type {
  BufferedImageEditBrushPointV3,
  ImageEditBrushShapeV3,
  ImageEditBrushTargetV3,
  ImageEditBrushTileV3,
  ImageEditBrushToolV3,
} from './contracts';

export interface ImageEditBrushSegmentBoundsV3 {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageEditBrushRasterTileV3 {
  tile: ImageEditBrushTileV3;
  originX: number;
  originY: number;
}

function radius(point: BufferedImageEditBrushPointV3, size: number): number {
  return (size * point.pressure) / 2;
}

export function imageEditBrushSegmentBoundsV3(
  start: BufferedImageEditBrushPointV3,
  end: BufferedImageEditBrushPointV3,
  size: number,
): ImageEditBrushSegmentBoundsV3 | null {
  const startRadius = radius(start, size);
  const endRadius = radius(end, size);
  if (startRadius === 0 && endRadius === 0) return null;
  const left = Math.min(start.x - startRadius, end.x - endRadius);
  const top = Math.min(start.y - startRadius, end.y - endRadius);
  const right = Math.max(start.x + startRadius, end.x + endRadius);
  const bottom = Math.max(start.y + startRadius, end.y + endRadius);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function segmentProjection(
  pixelX: number,
  pixelY: number,
  start: BufferedImageEditBrushPointV3,
  end: BufferedImageEditBrushPointV3,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return 0;
  return Math.max(0, Math.min(1, (
    (pixelX - start.x) * dx + (pixelY - start.y) * dy
  ) / lengthSquared));
}

function brushCoverage(normalizedDistance: number, hardness: number): number {
  if (normalizedDistance > 1) return 0;
  if (hardness === 1 || normalizedDistance <= hardness) return 1;
  const amount = (normalizedDistance - hardness) / (1 - hardness);
  return 1 - amount * amount * (3 - 2 * amount);
}

function applyRgba(
  data: Float32Array,
  offset: number,
  target: Extract<ImageEditBrushTargetV3, { kind: 'raster-rgba' }>,
  tool: ImageEditBrushToolV3,
  amount: number,
): boolean {
  const before0 = data[offset];
  const before1 = data[offset + 1];
  const before2 = data[offset + 2];
  const before3 = data[offset + 3];
  if (tool === 'eraser') {
    const remaining = 1 - amount;
    data[offset] = before0 * remaining;
    data[offset + 1] = before1 * remaining;
    data[offset + 2] = before2 * remaining;
    data[offset + 3] = before3 * remaining;
  } else {
    const color = target.premultipliedColor;
    const sourceAlpha = color[3] * amount;
    const remaining = 1 - sourceAlpha;
    data[offset] = color[0] * amount + before0 * remaining;
    data[offset + 1] = color[1] * amount + before1 * remaining;
    data[offset + 2] = color[2] * amount + before2 * remaining;
    data[offset + 3] = sourceAlpha + before3 * remaining;
  }
  return data[offset] !== before0
    || data[offset + 1] !== before1
    || data[offset + 2] !== before2
    || data[offset + 3] !== before3;
}

function applyMask(
  data: Float32Array,
  offset: number,
  target: Extract<ImageEditBrushTargetV3, { kind: 'mask' }>,
  tool: ImageEditBrushToolV3,
  amount: number,
): boolean {
  const before = data[offset];
  const targetValue = tool === 'eraser' ? 0 : (target.brushValue ?? 1);
  data[offset] = before + (targetValue - before) * amount;
  return data[offset] !== before;
}

/** 在一个已克隆的 Float32 瓦片内绘制连续线段，不读取或分配其他瓦片。 */
export function rasterizeImageEditBrushSegmentV3(
  output: ImageEditBrushRasterTileV3,
  start: BufferedImageEditBrushPointV3,
  end: BufferedImageEditBrushPointV3,
  shape: ImageEditBrushShapeV3,
  target: ImageEditBrushTargetV3,
  tool: ImageEditBrushToolV3,
): boolean {
  const bounds = imageEditBrushSegmentBoundsV3(start, end, shape.size);
  if (!bounds) return false;
  const localLeft = Math.max(0, Math.floor(bounds.x - output.originX));
  const localTop = Math.max(0, Math.floor(bounds.y - output.originY));
  const localRight = Math.min(
    output.tile.width,
    Math.ceil(bounds.x + bounds.width - output.originX),
  );
  const localBottom = Math.min(
    output.tile.height,
    Math.ceil(bounds.y + bounds.height - output.originY),
  );
  if (localRight <= localLeft || localBottom <= localTop) return false;

  let changed = false;
  for (let y = localTop; y < localBottom; y += 1) {
    const pixelY = output.originY + y + 0.5;
    for (let x = localLeft; x < localRight; x += 1) {
      const pixelX = output.originX + x + 0.5;
      const projection = segmentProjection(pixelX, pixelY, start, end);
      const pressure = start.pressure + (end.pressure - start.pressure) * projection;
      const pixelRadius = (shape.size * pressure) / 2;
      if (pixelRadius <= 0) continue;
      const centerX = start.x + (end.x - start.x) * projection;
      const centerY = start.y + (end.y - start.y) * projection;
      const distance = Math.hypot(pixelX - centerX, pixelY - centerY);
      const coverage = brushCoverage(distance / pixelRadius, shape.hardness);
      const amount = Math.min(1, coverage * shape.opacity * pressure);
      if (amount <= 0) continue;
      const pixelIndex = y * output.tile.width + x;
      if (target.kind === 'raster-rgba' && output.tile.storage === 'rgba-float32') {
        changed = applyRgba(output.tile.data, pixelIndex * 4, target, tool, amount) || changed;
      } else if (target.kind === 'mask' && output.tile.storage === 'mask-float32') {
        changed = applyMask(output.tile.data, pixelIndex, target, tool, amount) || changed;
      } else {
        throw new Error('画笔目标与瓦片存储契约不匹配');
      }
    }
  }
  return changed;
}
