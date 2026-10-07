/**
 * 设计稿 `docs/task/界面重设计与主题引擎/设计稿/Main.dc.html` 中 `HenjiTheme` 的逐字移植，只供测试作对照基准。
 * 除补类型、把 hex 字面量换成 colorTokens 常量（check:colors 只允许 colorTokens 写 hex）外不做任何改动；
 * 修改引擎时不要同步修改本文件。
 */
import { THEME_SEED_ACCENT_HEX, WHITE_HEX } from './colorTokens';

type Rgb = [number, number, number];
export type ReferenceSeed = {
  mode: 'dark' | 'light';
  hue: number;
  tint: number;
  base: number;
  accent: string;
  contrast?: number;
};

const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
function rgbOf(L: number, C: number, H: number): Rgb {
  let c = C;
  for (let n = 0; n < 60; n++) {
    const h = (H * Math.PI) / 180; const a = c * Math.cos(h); const b = c * Math.sin(h);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(toSrgb);
    if (rgb.every(v => v >= -0.002 && v <= 1.002) || c <= 0) return rgb.map(v => Math.min(1, Math.max(0, v))) as Rgb;
    c = Math.max(0, c - 0.005);
  }
  return [L, L, L];
}
const hex = (rgb: Rgb) => '#' + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const ok = (L: number, C: number, H: number) => hex(rgbOf(Math.min(1, Math.max(0, L)), Math.max(0, C), H));
const parse = (x: string): Rgb => { const n = parseInt(String(x).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function toOklch(x: string) {
  const [r, g, b] = parse(x).map(v => toLin(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}
const lum = (x: string) => { const [r, g, b] = parse(x).map(v => toLin(v / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const referenceContrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const alpha = (x: string, a: number) => { const [r, g, b] = parse(x); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; };
export const REFERENCE_PRESETS: Record<string, ReferenceSeed & { name: string }> = {
  graphite: { name: '石墨', mode: 'dark', hue: 260, tint: 0, base: 0.2238, accent: THEME_SEED_ACCENT_HEX.blue },
  ocean: { name: '深海', mode: 'dark', hue: 245, tint: 0.024, base: 0.165, accent: THEME_SEED_ACCENT_HEX.oceanBlue },
  film: { name: '胶片', mode: 'dark', hue: 70, tint: 0.013, base: 0.172, accent: THEME_SEED_ACCENT_HEX.orange },
  paper: { name: '纸白', mode: 'light', hue: 260, tint: 0.005, base: 0.975, accent: THEME_SEED_ACCENT_HEX.blue }
};
export const REFERENCE_CONTRAST_LEVELS = [0.8, 1, 1.35];
export function referenceDerive(seed: ReferenceSeed): Record<string, string> {
  const s = Object.assign({ contrast: 1 }, seed);
  const dark = s.mode !== 'light';
  const k = s.contrast; const st = 0.024 * k; const L0 = s.base;
  const N = (L: number, c?: number) => ok(L, c === undefined ? s.tint : c, s.hue);
  const t: Record<string, string> = {};
  if (dark) {
    Object.assign(t, { gap: N(L0 - 0.6 * st), window: N(L0), panel: N(L0 + st), raised: N(L0 + 2 * st), control: N(L0 + 2.8 * st), controlHover: N(L0 + 3.8 * st), controlPressed: N(L0 + 4.8 * st), hover: N(L0 + 2.6 * st), selected: N(L0 + 4 * st), line: N(L0 + 2.2 * st), lineStrong: N(L0 + 3.8 * st), text1: N(0.95, s.tint * 0.5), text2: N(0.95 - 0.18 * k, s.tint * 0.8), text3: N(0.95 - 0.32 * k, s.tint), textDisabled: N(L0 + 0.2), edge: 'rgba(255,255,255,0.06)', shade: 'rgba(0,0,0,0.5)', media: N(L0 - 0.5 * st) });
  } else {
    Object.assign(t, { gap: N(L0 - 0.05 * k), window: N(L0), panel: N(Math.min(1, L0 + 0.022)), raised: N(L0 - 0.022 * k), control: N(L0 - 0.032 * k), controlHover: N(L0 - 0.055 * k), controlPressed: N(L0 - 0.08 * k), hover: N(L0 - 0.035 * k), selected: N(L0 - 0.065 * k), line: N(L0 - 0.075 * k), lineStrong: N(L0 - 0.13 * k), text1: N(0.2, s.tint * 2), text2: N(0.2 + 0.25 * k, s.tint * 2), text3: N(0.2 + 0.33 * k, s.tint * 2), textDisabled: N(0.78), edge: 'rgba(0,0,0,0.07)', shade: 'rgba(28,32,40,0.18)', media: N(0.16) });
  }
  const a = toOklch(s.accent);
  const aL = dark ? Math.min(0.64, Math.max(0.5, a.L)) : Math.min(0.6, Math.max(0.46, a.L));
  const A = (L: number, C?: number) => ok(L, C === undefined ? a.C : C, a.H);
  Object.assign(t, { accent: A(aL), accentHi: A(aL + 0.035), accentHover: A(aL + 0.04), accentHoverHi: A(aL + 0.075), accentPressed: A(aL - 0.045), accentText: dark ? A(0.8, Math.min(a.C, 0.13)) : A(0.5), accentRing: A(dark ? 0.7 : 0.62) });
  t.accentTint = alpha(t.accent, dark ? 0.2 : 0.12);
  t.onAccent = referenceContrast(WHITE_HEX.toUpperCase(), t.accent) >= 4.5 ? WHITE_HEX.toUpperCase() : N(0.17, 0.01);
  Object.assign(t, { danger: ok(dark ? 0.6 : 0.55, 0.19, 25), dangerHi: ok(dark ? 0.635 : 0.585, 0.19, 25), dangerText: ok(dark ? 0.74 : 0.5, 0.15, 25), success: ok(dark ? 0.76 : 0.55, 0.15, 155), warning: ok(dark ? 0.8 : 0.64, 0.15, 75) });
  t.dangerTint = alpha(t.danger, dark ? 0.16 : 0.1);
  const clipL = dark ? L0 + 6 * st : L0 - 0.12; const edgeL = clipL + (dark ? 0.07 : -0.09);
  Object.assign(t, { clipVideo: ok(clipL, 0.045, 255), clipVideoLine: ok(edgeL, 0.07, 255), clipAudio: ok(clipL, 0.045, 165), clipAudioLine: ok(edgeL, 0.07, 165), clipText: ok(clipL, 0.045, 305), clipTextLine: ok(edgeL, 0.07, 305), clipWave: dark ? ok(0.84, 0.06, 165) : ok(0.36, 0.07, 165), wave: N(0.6), wavePlayed: t.text1, waveCut: ok(dark ? 0.42 : 0.78, 0.09, 25) });
  return t;
}
