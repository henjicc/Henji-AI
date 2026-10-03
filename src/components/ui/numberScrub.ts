/**
 * 数值拖动（设计稿“数值拖动字段”）的纯计算部分，供 `NumberInput` 使用。
 */

/** 按下后水平移动超过这个距离才算拖动，否则视为点击（进入编辑）。 */
export const SCRUB_START_THRESHOLD_PX = 3
/** 每移动这么多像素走一个步长。 */
export const SCRUB_PIXELS_PER_STEP = 2
/** Shift 精细（十分之一速度）、Alt 粗调（十倍速度）。 */
const SCRUB_FINE_FACTOR = 0.1
const SCRUB_COARSE_FACTOR = 10

/** 拖动倍率：Shift 精细、Alt 粗调（同时按下时以精细为准，避免误触大幅跳变）。 */
export function resolveScrubFactor(modifiers: { shiftKey: boolean; altKey: boolean }): number {
  if (modifiers.shiftKey) return SCRUB_FINE_FACTOR
  if (modifiers.altKey) return SCRUB_COARSE_FACTOR
  return 1
}
