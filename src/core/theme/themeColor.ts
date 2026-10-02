/**
 * 主题引擎用的色彩数学（纯函数，无依赖）。
 *
 * - OKLab / OKLCH ↔ sRGB 使用 Björn Ottosson 公布的矩阵，与设计稿
 *   `docs/task/界面重设计与主题引擎/设计稿/Main.dc.html` 的 `HenjiTheme` 参考实现逐位一致；
 *   culori、colorjs.io 用的也是同一组系数。
 * - 出色域时按参考实现「每次降 0.005 彩度、容差 0.002」收敛，保证推导结果与设计稿一致
 *   （CSS Color 4 的 JND 二分法会得到不同的 hex）。
 * - 对比度按 WCAG 2.x 相对亮度计算，输入为 8 位量化后的颜色，与浏览器实际呈现一致。
 *
 * 选型依据见 1.2 任务执行记录。
 */

import { WHITE_HEX } from './colorTokens';

export interface RgbaColor {
  /** 0–255 整数 */
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

export interface OklchColor {
  L: number;
  C: number;
  H: number;
}

export interface OklabColor {
  L: number;
  a: number;
  b: number;
}

const HEX6_PATTERN = /^#?([0-9a-fA-F]{6})$/;
const RGBA_PATTERN =
  /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([0-9]*\.?[0-9]+)\s*)?\)$/;

/** 白色，统一为大写 `#RRGGBB`（与参考实现输出格式一致）。 */
export const WHITE = WHITE_HEX.toUpperCase();

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** OKLCH → 未裁剪的 sRGB（0–1，可能越界）。 */
function oklchToSrgbUnclamped(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/**
 * OKLCH → sRGB（0–1），出色域时逐步降低彩度直到落入色域（参考实现算法）。
 */
export function oklchToSrgb(L: number, C: number, H: number): [number, number, number] {
  let chroma = C;
  for (let n = 0; n < 60; n += 1) {
    const rgb = oklchToSrgbUnclamped(L, chroma, H);
    if (rgb.every((v) => v >= -0.002 && v <= 1.002) || chroma <= 0) {
      return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
    }
    chroma = Math.max(0, chroma - 0.005);
  }
  return [L, L, L];
}

function channelToHex(v: number): string {
  return Math.round(v * 255)
    .toString(16)
    .padStart(2, '0');
}

export function srgbToHex(rgb: readonly [number, number, number]): string {
  return `#${rgb.map(channelToHex).join('')}`.toUpperCase();
}

/** OKLCH → `#RRGGBB`；L、C 先夹到合法范围。 */
export function oklchToHex(L: number, C: number, H: number): string {
  return srgbToHex(oklchToSrgb(clamp01(L), Math.max(0, C), H));
}

export function normalizeHex(input: string): string | null {
  const match = HEX6_PATTERN.exec(input.trim());
  return match ? `#${match[1].toUpperCase()}` : null;
}

export function isHexColor(input: unknown): input is string {
  return typeof input === 'string' && HEX6_PATTERN.test(input.trim());
}

/** 解析 `#RRGGBB`、`rgb()`、`rgba()`（逗号或空格分隔）；无法解析返回 null。 */
export function parseColor(input: string): RgbaColor | null {
  const trimmed = input.trim();
  const hex = HEX6_PATTERN.exec(trimmed);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = RGBA_PATTERN.exec(trimmed);
  if (!rgba) {
    return null;
  }
  const [r, g, b] = [rgba[1], rgba[2], rgba[3]].map((v) => Number(v));
  const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
  if ([r, g, b].some((v) => v > 255) || !(a >= 0 && a <= 1)) {
    return null;
  }
  return { r, g, b, a };
}

function requireColor(input: string): RgbaColor {
  const color = parseColor(input);
  if (!color) {
    throw new Error(`无法解析颜色：${input}`);
  }
  return color;
}

export function rgbaString(color: RgbaColor): string {
  return `rgba(${color.r},${color.g},${color.b},${color.a})`;
}

/** 给不透明颜色加透明度，输出与参考实现相同的 `rgba(r,g,b,a)` 格式。 */
export function withAlpha(color: string, alpha: number): string {
  const { r, g, b } = requireColor(color);
  return rgbaString({ r, g, b, a: alpha });
}

/** `r g b` 三元组，兼容现有 `rgb(var(--x-rgb) / a)` 写法。 */
export function toRgbTriple(color: string): string {
  const { r, g, b } = requireColor(color);
  return `${r} ${g} ${b}`;
}

/** 把半透明前景合成到不透明背景上（sRGB 空间线性混合，与浏览器默认合成一致）。 */
export function compositeOver(foreground: string, background: string): string {
  const fg = requireColor(foreground);
  const bg = requireColor(background);
  const mix = (f: number, b: number) => (f * fg.a + b * (1 - fg.a)) / 255;
  return srgbToHex([mix(fg.r, bg.r), mix(fg.g, bg.g), mix(fg.b, bg.b)]);
}

export function hexToOklab(color: string): OklabColor {
  const { r, g, b } = requireColor(color);
  const [lr, lg, lb] = [r, g, b].map((v) => srgbToLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToHex({ L, a, b }: OklabColor): string {
  const C = Math.hypot(a, b);
  const H = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return oklchToHex(L, C, H);
}

/** 两色在 OKLab 中按 t 插值（t = 0.5 即渐变中点），结果量化为 `#RRGGBB`。 */
export function mixOklab(x: string, y: string, t = 0.5): string {
  const p = hexToOklab(x);
  const q = hexToOklab(y);
  return oklabToHex({ L: p.L + (q.L - p.L) * t, a: p.a + (q.a - p.a) * t, b: p.b + (q.b - p.b) * t });
}

export function hexToOklch(color: string): OklchColor {
  const { L, a, b } = hexToOklab(color);
  return { L, C: Math.hypot(a, b), H: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

/** OKLab 欧氏色差（ΔE_OK），约 0.02 为可察觉差异。 */
export function deltaEOK(x: string, y: string): number {
  const p = hexToOklab(x);
  const q = hexToOklab(y);
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/** WCAG 相对亮度（忽略透明度；半透明颜色先用 compositeOver 合成）。 */
export function relativeLuminance(color: string): number {
  const { r, g, b } = requireColor(color);
  const [lr, lg, lb] = [r, g, b].map((v) => srgbToLinear(v / 255));
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG 2.x 对比度，1–21。 */
export function contrastRatio(x: string, y: string): number {
  const a = relativeLuminance(x);
  const b = relativeLuminance(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function minContrast(color: string, backgrounds: readonly string[]): number {
  return backgrounds.reduce((min, bg) => Math.min(min, contrastRatio(color, bg)), Infinity);
}
