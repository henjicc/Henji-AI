/**
 * 数值拖动（设计稿“数值拖动字段”）的纯计算部分，供 `NumberInput` 使用。
 */

/** 按下后水平移动超过这个距离才算拖动，否则视为点击（进入编辑）。 */
export const SCRUB_START_THRESHOLD_PX = 3
/** 范围未知或步数很多时，每移动这么多像素走一个步长。 */
export const SCRUB_PIXELS_PER_STEP = 2
/** 拖完整个范围大约要移动的距离：范围只有几步时每步给足距离，才能稳稳停在中间的值上。 */
const SCRUB_FULL_RANGE_PX = 240
const SCRUB_MAX_PIXELS_PER_STEP = 16

/** 每步像素数：按范围内的步数摊开 240px，夹在 2–16 之间（1–4 这类小范围每步 16px，0–100 约每步 2.4px）。 */
export function resolveScrubPixelsPerStep(range: { min?: number; max?: number; step: number }): number {
  const { min, max, step } = range
  if (typeof min !== 'number' || typeof max !== 'number' || !(step > 0) || max <= min) return SCRUB_PIXELS_PER_STEP
  const steps = (max - min) / step
  return Math.min(SCRUB_MAX_PIXELS_PER_STEP, Math.max(SCRUB_PIXELS_PER_STEP, SCRUB_FULL_RANGE_PX / steps))
}
/** Shift 精细（十分之一速度）、Alt 粗调（十倍速度）。 */
const SCRUB_FINE_FACTOR = 0.1
const SCRUB_COARSE_FACTOR = 10

/** 拖动倍率：Shift 精细、Alt 粗调（同时按下时以精细为准，避免误触大幅跳变）。 */
export function resolveScrubFactor(modifiers: { shiftKey: boolean; altKey: boolean }): number {
  if (modifiers.shiftKey) return SCRUB_FINE_FACTOR
  if (modifiers.altKey) return SCRUB_COARSE_FACTOR
  return 1
}
