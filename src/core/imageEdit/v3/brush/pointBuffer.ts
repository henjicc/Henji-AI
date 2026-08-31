import type {
  BufferedImageEditBrushPointV3,
  ImageEditBrushPointBufferStatsV3,
  ImageEditBrushPointV3,
} from './contracts';

const POINT_STRIDE = 5;
const DEFAULT_INITIAL_CAPACITY = 64;

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label}必须是有限数`);
  return value;
}

function normalizePoint(point: ImageEditBrushPointV3): BufferedImageEditBrushPointV3 {
  const pressure = point.pressure ?? 1;
  if (!Number.isFinite(pressure) || pressure < 0 || pressure > 1) {
    throw new Error('画笔压力必须位于 0～1');
  }
  return {
    x: finite(point.x, '图片 X 坐标'),
    y: finite(point.y, '图片 Y 坐标'),
    screenX: finite(point.screenX, '屏幕 X 坐标'),
    screenY: finite(point.screenY, '屏幕 Y 坐标'),
    pressure,
  };
}

/** 可变倍增缓冲；扩容总复制量为 O(n)，append 不复制已有点数组。 */
export class ImageEditBrushPointBufferV3 {
  private values: Float32Array;
  private count = 0;
  private inputPointCount = 0;
  private reallocationCount = 0;
  private copiedScalarCount = 0;

  constructor(
    private readonly minScreenDistance = 0.75,
    initialCapacity = DEFAULT_INITIAL_CAPACITY,
  ) {
    if (!Number.isFinite(minScreenDistance) || minScreenDistance < 0) {
      throw new Error('屏幕抽稀距离不能为负数');
    }
    if (!Number.isSafeInteger(initialCapacity) || initialCapacity < 1) {
      throw new Error('点缓冲初始容量必须是正整数');
    }
    this.values = new Float32Array(initialCapacity * POINT_STRIDE);
  }

  append(point: ImageEditBrushPointV3): boolean {
    const normalized = normalizePoint(point);
    this.inputPointCount += 1;
    if (this.count > 0 && this.isWithinScreenThreshold(normalized)) {
      this.write(this.count - 1, normalized);
      return false;
    }
    this.ensureCapacity(this.count + 1);
    this.write(this.count, normalized);
    this.count += 1;
    return true;
  }

  appendCoalesced(points: readonly ImageEditBrushPointV3[]): void {
    for (const point of points) this.append(point);
  }

  toArray(): BufferedImageEditBrushPointV3[] {
    const points = new Array<BufferedImageEditBrushPointV3>(this.count);
    for (let index = 0; index < this.count; index += 1) points[index] = this.read(index);
    return points;
  }

  getLast(): BufferedImageEditBrushPointV3 | null {
    return this.count > 0 ? this.read(this.count - 1) : null;
  }

  getStats(): ImageEditBrushPointBufferStatsV3 {
    return {
      inputPointCount: this.inputPointCount,
      retainedPointCount: this.count,
      capacity: this.values.length / POINT_STRIDE,
      reallocationCount: this.reallocationCount,
      copiedScalarCount: this.copiedScalarCount,
    };
  }

  clear(): void {
    this.count = 0;
  }

  private ensureCapacity(required: number): void {
    const current = this.values.length / POINT_STRIDE;
    if (required <= current) return;
    let capacity = current;
    while (capacity < required) capacity *= 2;
    const next = new Float32Array(capacity * POINT_STRIDE);
    const usedScalars = this.count * POINT_STRIDE;
    next.set(this.values.subarray(0, usedScalars));
    this.values = next;
    this.reallocationCount += 1;
    this.copiedScalarCount += usedScalars;
  }

  private isWithinScreenThreshold(point: BufferedImageEditBrushPointV3): boolean {
    if (this.minScreenDistance === 0) return false;
    const previousOffset = (this.count - 1) * POINT_STRIDE;
    const dx = point.screenX - this.values[previousOffset + 2];
    const dy = point.screenY - this.values[previousOffset + 3];
    return dx * dx + dy * dy < this.minScreenDistance * this.minScreenDistance;
  }

  private write(index: number, point: BufferedImageEditBrushPointV3): void {
    const offset = index * POINT_STRIDE;
    this.values[offset] = point.x;
    this.values[offset + 1] = point.y;
    this.values[offset + 2] = point.screenX;
    this.values[offset + 3] = point.screenY;
    this.values[offset + 4] = point.pressure;
  }

  private read(index: number): BufferedImageEditBrushPointV3 {
    const offset = index * POINT_STRIDE;
    return {
      x: this.values[offset],
      y: this.values[offset + 1],
      screenX: this.values[offset + 2],
      screenY: this.values[offset + 3],
      pressure: this.values[offset + 4],
    };
  }
}
