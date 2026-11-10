/**
 * 界面圆角：一个控件圆角像素值，输入框与浮层圆角在 index.css 里按比例推导（`--radius-base`）。
 * 默认 6 与控件 6 / 输入 8 / 浮层 12 的设计档一致。
 */
export const UI_RADIUS_RANGE = { min: 0, max: 12, step: 1 } as const;

export const DEFAULT_UI_RADIUS = 6;

/** 主题文件与早期设置里的三档圆角，对应的控件圆角像素值。 */
const UI_RADIUS_BY_PRESET = { compact: 4, default: 6, large: 8 } as const;

export type UiRadiusPreset = keyof typeof UI_RADIUS_BY_PRESET;

export function isUiRadiusPreset(value: unknown): value is UiRadiusPreset {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(UI_RADIUS_BY_PRESET, value);
}

/** 数值夹到范围内取整；三档名称换成对应数值；其余回落默认。 */
export function normalizeUiRadius(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(UI_RADIUS_RANGE.max, Math.max(UI_RADIUS_RANGE.min, Math.round(value)));
  }
  return isUiRadiusPreset(value) ? UI_RADIUS_BY_PRESET[value] : DEFAULT_UI_RADIUS;
}

/** 写主题文件时给只认三档的读取方一个最接近的档位。 */
export function nearestUiRadiusPreset(radius: number): UiRadiusPreset {
  const entries = Object.entries(UI_RADIUS_BY_PRESET) as Array<[UiRadiusPreset, number]>;
  return entries.reduce((best, entry) => (Math.abs(entry[1] - radius) < Math.abs(best[1] - radius) ? entry : best))[0];
}

/** 根节点上的圆角变量名与取值。 */
export const UI_RADIUS_CSS_VAR = '--radius-base';

export function uiRadiusCssValue(radius: number): string {
  return `${normalizeUiRadius(radius)}px`;
}
