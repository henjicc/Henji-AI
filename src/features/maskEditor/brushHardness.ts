export const DEFAULT_MASK_BRUSH_HARDNESS = 1;
export const MIN_MASK_BRUSH_HARDNESS = 0.1;

const MIN_MASK_BRUSH_FEATHER_STEPS = 8;
const MAX_MASK_BRUSH_FEATHER_STEPS = 24;
const MASK_BRUSH_FEATHER_PIXELS_PER_STEP = 16;

export interface MaskBrushRenderLayer {
  size: number;
  opacity: number;
}

export function normalizeMaskBrushHardness(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MASK_BRUSH_HARDNESS;
  return Math.min(1, Math.max(MIN_MASK_BRUSH_HARDNESS, value ?? 1));
}

/**
 * 从外沿向硬芯生成同心笔触。opacity 是每层的增量透明度，叠加后形成连续羽化，
 * 最内层始终达到 maxOpacity，确保擦除模式的中心能完全恢复遮罩。
 */
export function createMaskBrushRenderLayers(
  size: number,
  hardness: number | undefined,
  maxOpacity = 1
): MaskBrushRenderLayer[] {
  const safeSize = Math.max(1, size);
  const safeHardness = normalizeMaskBrushHardness(hardness);
  const safeMaxOpacity = Math.min(1, Math.max(0, maxOpacity));
  if (safeHardness >= 0.999 || safeMaxOpacity === 0) {
    return [{ size: safeSize, opacity: safeMaxOpacity }];
  }

  const coreSize = safeSize * safeHardness;
  const featherSize = safeSize - coreSize;
  const featherSteps = Math.min(
    MAX_MASK_BRUSH_FEATHER_STEPS,
    Math.max(MIN_MASK_BRUSH_FEATHER_STEPS, Math.ceil(featherSize / MASK_BRUSH_FEATHER_PIXELS_PER_STEP))
  );
  const layers: MaskBrushRenderLayer[] = [];
  let accumulatedOpacity = 0;

  for (let index = 0; index < featherSteps; index += 1) {
    const progress = (index + 1) / featherSteps;
    const targetOpacity = safeMaxOpacity * progress * progress;
    const incrementalOpacity = accumulatedOpacity >= 1
      ? 0
      : (targetOpacity - accumulatedOpacity) / (1 - accumulatedOpacity);
    layers.push({
      size: safeSize - featherSize * (index / (featherSteps - 1)),
      opacity: Math.min(1, Math.max(0, incrementalOpacity)),
    });
    accumulatedOpacity = targetOpacity;
  }

  return layers;
}
