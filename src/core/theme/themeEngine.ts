/**
 * 主题引擎：种子 → 全部语义颜色令牌（纯函数）。
 *
 * 规则来源：重要记录 002（种子推导，与设计稿 `Main.dc.html` 的 `HenjiTheme.derive` 一致）
 * 与重要记录 010 的修正：
 * - `text2`/`text3` 按目标对比度求解：基准取文字会压上的全部表面（含 `selected`、
 *   `control`/`controlHover`），对比度档位只拉开表面层级，文字不会因档位升高而变暗；
 * - `accentText`、`dangerText` 以设计稿数值为起点，不足 4.5:1 时才求解；
 * - 补齐 1.1 第七节的缺口令牌（状态浅底与文字、`on*`、玻璃与遮罩、固定媒体叠层、`canvas`、
 *   `colorScheme`）；信息色复用强调色，不另设。
 *
 * 与参考实现逐令牌的差异列表见 1.2 任务执行记录。
 */
import { THEME_SEED_ACCENT_HEX } from './colorTokens';
import {
  WHITE,
  compositeOver,
  deltaEOK,
  hexToOklch,
  minContrast,
  mixOklab,
  normalizeHex,
  oklchToHex,
  withAlpha,
} from './themeColor';

export type ThemeMode = 'dark' | 'light';

export interface ThemeSeed {
  mode: ThemeMode;
  /** 底色色相，0–360° */
  hue: number;
  /** 底色倾向（OKLCH 彩度） */
  tint: number;
  /** 窗口亮度（OKLCH L，0–1） */
  base: number;
  /** 层级对比度；设置里开放三档，引擎接受连续值 */
  contrast: number;
  /** 强调色 `#RRGGBB` */
  accent: string;
}

export type ThemePresetId = 'graphite' | 'ocean' | 'film' | 'paper';

export interface ThemePreset {
  id: ThemePresetId;
  name: { zh: string; en: string };
  seed: ThemeSeed;
}

export const THEME_CONTRAST_LEVELS = {
  soft: 0.8,
  standard: 1,
  strong: 1.35,
} as const;

export type ThemeContrastLevel = keyof typeof THEME_CONTRAST_LEVELS;

/** 种子取值范围（迁移与导入时夹取；设置界面只开放其中的子集）。 */
export const THEME_SEED_LIMITS = {
  tint: { min: 0, max: 0.08 },
  base: { min: 0, max: 1 },
  contrast: { min: 0.5, max: 3 },
} as const;

const SEED_ACCENT_HEX = THEME_SEED_ACCENT_HEX;

export const THEME_PRESETS: Record<ThemePresetId, ThemePreset> = {
  graphite: {
    id: 'graphite',
    name: { zh: '石墨', en: 'Graphite' },
    seed: { mode: 'dark', hue: 260, tint: 0.003, base: 0.2, contrast: 1, accent: SEED_ACCENT_HEX.blue },
  },
  ocean: {
    id: 'ocean',
    name: { zh: '深海', en: 'Ocean' },
    seed: { mode: 'dark', hue: 245, tint: 0.024, base: 0.165, contrast: 1, accent: SEED_ACCENT_HEX.oceanBlue },
  },
  film: {
    id: 'film',
    name: { zh: '胶片', en: 'Film' },
    seed: { mode: 'dark', hue: 70, tint: 0.013, base: 0.172, contrast: 1, accent: SEED_ACCENT_HEX.orange },
  },
  paper: {
    id: 'paper',
    name: { zh: '纸白', en: 'Paper' },
    seed: { mode: 'light', hue: 260, tint: 0.005, base: 0.975, contrast: 1, accent: SEED_ACCENT_HEX.blue },
  },
};

export const THEME_PRESET_IDS = Object.keys(THEME_PRESETS) as ThemePresetId[];

export const DEFAULT_THEME_PRESET_ID: ThemePresetId = 'graphite';

export const DEFAULT_THEME_SEED: ThemeSeed = THEME_PRESETS[DEFAULT_THEME_PRESET_ID].seed;

/** 设计稿的强调色选项；`null` 表示跟随预设。 */
export const THEME_ACCENT_CHOICES: ReadonlyArray<{ id: string; name: { zh: string; en: string }; hex: string | null }> = [
  { id: 'preset', name: { zh: '跟随预设', en: 'Preset' }, hex: null },
  { id: 'blue', name: { zh: '蓝', en: 'Blue' }, hex: SEED_ACCENT_HEX.blue },
  { id: 'violet', name: { zh: '紫', en: 'Violet' }, hex: SEED_ACCENT_HEX.violet },
  { id: 'teal', name: { zh: '青', en: 'Teal' }, hex: SEED_ACCENT_HEX.teal },
  { id: 'orange', name: { zh: '橙', en: 'Orange' }, hex: SEED_ACCENT_HEX.orange },
  { id: 'rose', name: { zh: '玫红', en: 'Rose' }, hex: SEED_ACCENT_HEX.rose },
];

/**
 * 全部颜色令牌名（顺序即 CSS 变量输出顺序）。
 * 值为 `#RRGGBB`（不透明）或 `rgba(r,g,b,a)`（半透明）。
 */
export const THEME_COLOR_TOKEN_NAMES = [
  // 表面
  'gap',
  'window',
  'canvas',
  'panel',
  'raised',
  'control',
  'controlHover',
  'controlPressed',
  'hover',
  'selected',
  'line',
  'lineStrong',
  'media',
  'edge',
  'shade',
  // 文字
  'text1',
  'text2',
  'text3',
  'textDisabled',
  // 强调
  'accent',
  'accentHi',
  'accentHover',
  'accentHoverHi',
  'accentPressed',
  'accentText',
  'accentRing',
  'accentTint',
  'selectedAccent',
  'selectedAccentHover',
  'onAccent',
  // 状态
  'danger',
  'dangerHi',
  'dangerHover',
  'dangerHoverHi',
  'dangerPressed',
  'dangerText',
  'dangerTint',
  'onDanger',
  'success',
  'successText',
  'successTint',
  'onSuccess',
  'warning',
  'warningText',
  'warningTint',
  'onWarning',
  // 素材片段与波形
  'clipVideo',
  'clipVideoLine',
  'clipAudio',
  'clipAudioLine',
  'clipText',
  'clipTextLine',
  'clipWave',
  'wave',
  'wavePlayed',
  'waveCut',
  // 玻璃材质（按模式派生）
  'glassTint',
  'glassEdge',
  'glassSheen',
  'glassHover',
  'glassPressed',
  'glassSelected',
  'glassSelectedAccent',
  'glassDivider',
  'glassControlTint',
  'glassRegionTint',
  'glassSurfaceTint',
  // 遮罩（按模式派生）
  'scrim',
  'scrimSoft',
  'scrimSolid',
  // 固定媒体叠层（压在图片/视频上，不随主题）
  'mediaControl',
  'mediaControlHover',
  'onMedia',
  'mediaScrim',
  'mediaLine',
] as const;

export type ThemeColorTokenName = (typeof THEME_COLOR_TOKEN_NAMES)[number];

export type ThemeColorTokens = Record<ThemeColorTokenName, string>;

export type ThemeTokenOverrides = Partial<Record<ThemeColorTokenName, string>>;

export interface ThemeTokens {
  mode: ThemeMode;
  /** 写入 `color-scheme`，让原生下拉、滚动条、日期/颜色控件跟随主题 */
  colorScheme: ThemeMode;
  colors: ThemeColorTokens;
}

/** 文字类令牌的最低对比度（WCAG AA 正文）。 */
export const THEME_TEXT_MIN_CONTRAST = 4.5;

/** 深色玻璃底（黑）的不透明度：保证辅助文字在玻璃上 ≥ 4.5:1（任务 4.3，主控决定 ≥ 0.70）。 */
export const DARK_GLASS_TINT_ALPHA = 0.72;
/** 浅色玻璃底：面板色 82%（纸白下查看器、画布上的玻璃浮层） */
export const LIGHT_GLASS_TINT_ALPHA = 0.82;
/** 玻璃上的强调选中底透明度（深色 / 浅色） */
const GLASS_SELECTED_ACCENT_ALPHA = { dark: 0.28, light: 0.18 } as const;

/** 选中淡强调底的强调色透明度（重要记录 012，任务 4.3）。 */
export const SELECTED_ACCENT_ALPHA = { dark: 0.2, light: 0.18 } as const;
/** 选中项悬停：在选中底上再加一档，不回落中性悬停。 */
export const SELECTED_ACCENT_HOVER_ALPHA = { dark: 0.26, light: 0.22 } as const;
/**
 * 选中淡底必须与悬停、静息一眼可辨（重要记录 012；OKLab ΔE 门槛，四预设的 4.3 断言与 5.11 组合测试共用）：
 * 选中 vs 中性悬停 ≥ vsHover、选中 vs 所在表面 ≥ vsRest、选中项悬停 vs 选中 ≥ hoverVsSelected。
 */
export const SELECTION_MIN_DELTA = { vsHover: 0.03, vsRest: 0.06, hoverVsSelected: 0.015 } as const;
/** 低彩度/很暗的强调色或极端层级对比度下，选中透明度最多提到这里（再高就接近实底，与主动作抢权重）。 */
const SELECTED_ACCENT_ALPHA_MAX = 0.6;

/**
 * 文字求解起点：设计稿“标准”档（contrast = 1）的文字亮度，对所有档位相同。
 * 档位只改变表面；表面变亮（深色）或变暗（浅色）导致不达标时，文字才往远离表面的方向求解，
 * 因此文字亮度随档位单调远离表面，不会因档位升高而变暗。
 */
const TEXT_START_L = {
  dark: { text2: 0.77, text3: 0.63 },
  light: { text2: 0.45, text3: 0.53 },
} as const;

/** 求解后 text2 与 text3 至少保持的亮度差（设计稿标准档层级间距的下限），保证次要/辅助不并档。 */
const TEXT2_MIN_GAP = { dark: 0.12, light: 0.05 } as const;

/** 设计稿强调色亮度夹取范围（深 0.50–0.64 / 浅 0.46–0.60）。 */
const ACCENT_L_RANGE = { dark: { min: 0.5, max: 0.64 }, light: { min: 0.46, max: 0.6 } } as const;

/** 主按钮为白字压暗实底时，相对设计稿推导亮度的最大降幅（主控决定 2026-10-03）。 */
export const ACCENT_MAX_DARKEN = 0.04;

/** 固定媒体叠层：压在画面上，不随主题变化。 */
export const MEDIA_OVERLAY_TOKENS = {
  mediaControl: 'rgba(10,11,13,0.56)',
  mediaControlHover: 'rgba(10,11,13,0.78)',
  onMedia: WHITE,
  mediaScrim: 'rgba(0,0,0,0.55)',
  mediaLine: 'rgba(255,255,255,0.16)',
} as const satisfies ThemeTokenOverrides;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 补默认值并夹到合法范围；非法字段回落到默认种子。 */
export function normalizeThemeSeed(input?: Partial<ThemeSeed> | null, fallback: ThemeSeed = DEFAULT_THEME_SEED): ThemeSeed {
  const source = input ?? {};
  const mode: ThemeMode = source.mode === 'light' || source.mode === 'dark' ? source.mode : fallback.mode;
  const rawHue = finiteOr(source.hue, fallback.hue) % 360;
  const hue = rawHue < 0 ? rawHue + 360 : rawHue;
  return {
    mode,
    hue,
    tint: clamp(finiteOr(source.tint, fallback.tint), THEME_SEED_LIMITS.tint.min, THEME_SEED_LIMITS.tint.max),
    base: clamp(finiteOr(source.base, fallback.base), THEME_SEED_LIMITS.base.min, THEME_SEED_LIMITS.base.max),
    contrast: clamp(
      finiteOr(source.contrast, fallback.contrast),
      THEME_SEED_LIMITS.contrast.min,
      THEME_SEED_LIMITS.contrast.max
    ),
    accent: (typeof source.accent === 'string' && normalizeHex(source.accent)) || fallback.accent,
  };
}

interface SolveOptions {
  startL: number;
  chroma: number;
  hue: number;
  /** 文字可能压上的全部不透明背景 */
  beds: readonly string[];
  target: number;
  /** 'up'：往亮处找（深色模式）；'down'：往暗处找（浅色模式） */
  direction: 'up' | 'down';
}

/**
 * 从起点亮度出发，找离起点最近、且对全部背景都达到目标对比度的亮度。
 * 起点已达标时原样返回（保证设计稿数值达标时不被改动）。
 */
export function solveLightnessForContrast(options: SolveOptions): number {
  const { startL, chroma, hue, beds, target, direction } = options;
  const passes = (L: number) => minContrast(oklchToHex(L, chroma, hue), beds) >= target;
  if (passes(startL)) {
    return startL;
  }
  let near = startL;
  let far = direction === 'up' ? 1 : 0;
  if (!passes(far)) {
    return far;
  }
  for (let i = 0; i < 40; i += 1) {
    const mid = (near + far) / 2;
    if (passes(mid)) {
      far = mid;
    } else {
      near = mid;
    }
  }
  return far;
}

/** 在白字与深色墨水之间按对比度自动选择：白字达标优先，否则墨水达标，再否则取更高者。 */
export function pickOnColor(backgrounds: readonly string[], ink: string): string {
  const white = minContrast(WHITE, backgrounds);
  if (white >= THEME_TEXT_MIN_CONTRAST) {
    return WHITE;
  }
  const dark = minContrast(ink, backgrounds);
  if (dark >= THEME_TEXT_MIN_CONTRAST) {
    return ink;
  }
  return dark > white ? ink : WHITE;
}

/**
 * 非按钮实底（成功/警示徽标等）亮度：白字或深色墨水任一达标时保持起点；
 * 两者都不达标时往暗处找第一个让白字达标的亮度（只影响落在“中灰区”的颜色）。
 */
export function solveSolidFillL(startL: number, chroma: number, hue: number, ink: string): number {
  const fill = (L: number) => oklchToHex(L, chroma, hue);
  const ok = (L: number) => {
    const bg = [fill(L)];
    return minContrast(WHITE, bg) >= THEME_TEXT_MIN_CONTRAST || minContrast(ink, bg) >= THEME_TEXT_MIN_CONTRAST;
  };
  if (ok(startL)) {
    return startL;
  }
  let near = startL;
  let far = 0;
  for (let i = 0; i < 40; i += 1) {
    const mid = (near + far) / 2;
    if (minContrast(WHITE, [fill(mid)]) >= THEME_TEXT_MIN_CONTRAST) {
      far = mid;
    } else {
      near = mid;
    }
  }
  return far;
}

/**
 * 实底按钮各状态相对静息亮度的偏移。静息渐变 = hi → 静息；悬停渐变 = hoverHi → hover；按下为瞬态。
 * 悬停主要靠顶部高光（hoverHi）表达，底色不再提亮（hover = 0），使“悬停中点 − 静息中点”的亮度提升
 * = (hover + hoverHi − hi) / 2 = 0.0175，满足主控“≤ 0.02”（设计稿原为 hover +0.04 / hoverHi +0.075，提升 0.04）；
 * hoverHi 由 0.075 微调到 0.07，给出色域裁剪留余量（深海 0.075 时实测 0.0206）。
 */
export const SOLID_RAMP_OFFSETS = { hi: 0.035, hover: 0, hoverHi: 0.07, pressed: -0.045 } as const;

/**
 * 扁平实底按钮（重要记录 016）的悬停、按下亮度变化幅度（OKLCH L）。
 * 按钮不再有渐变高光，悬停只能靠底色本身变化表达，必须一眼可见：白字实底往暗走（白字对比只会更高），
 * 墨水字实底往亮走（墨水对比只会更高）——两个方向都不会让文字变得更难读，无需再求解。
 */
export const FLAT_SOLID_STATE_DELTA = { hover: 0.06, pressed: 0.11 } as const;

/** 扁平实底按钮悬停、按下的亮度：朝“让文字更清楚”的方向走。 */
export function flatSolidStateL(L: number, on: string, state: keyof typeof FLAT_SOLID_STATE_DELTA): number {
  const delta = FLAT_SOLID_STATE_DELTA[state];
  return on === WHITE ? Math.max(0, L - delta) : Math.min(1, L + delta);
}

export interface SolidRampResult {
  /** 静息实底亮度（OKLCH L） */
  L: number;
  /** 实底上的文字色：白或墨水 */
  on: string;
}

/**
 * 实底按钮标签所占的竖向区间（相对按钮高度，自上而下）。28–36 高的按钮里 11–14 号字的行框约占中间 60%，
 * 像素审计取文字区域最差 10% 分位，落在行框上端附近。
 */
export const SOLID_LABEL_BAND = { top: 0.2, bottom: 0.8 } as const;

/**
 * 判定实底上文字对比度时取哪些位置：
 * - `midpoint`：静息、悬停两条渐变的 OKLab 中点（强调色主按钮，主控 2026-10-03 修订版）；
 * - `labelBand`：两条渐变在标签区间上下两端的实际颜色（CSS 渐变按 sRGB 插值）。危险确认按钮用它：
 *   只判中点会漏掉悬停渐变上半段，5.3 / 5.6 像素审计实测悬停白字只有 4.28–4.43:1（任务 5.7）。
 */
export type SolidLabelCoverage = 'midpoint' | 'labelBand';

/** CSS `linear-gradient` 默认在 sRGB 空间插值：from → to 之间位置 t 处的颜色。 */
function gradientAt(from: string, to: string, t: number): string {
  return compositeOver(withAlpha(from, 1 - t), to);
}

/** 实底按钮上文字实际所在处的颜色（顶端 1px 高光不参与判定；渐变上亮下暗，白字最差在上端、墨水最差在下端）。 */
export function solidLabelBeds(L: number, chroma: number, hue: number, coverage: SolidLabelCoverage = 'midpoint'): string[] {
  const at = (offset: number) => oklchToHex(L + offset, chroma, hue);
  const rest: [string, string] = [at(SOLID_RAMP_OFFSETS.hi), at(0)];
  const hover: [string, string] = [at(SOLID_RAMP_OFFSETS.hoverHi), at(SOLID_RAMP_OFFSETS.hover)];
  if (coverage === 'midpoint') {
    // 扁平实底（重要记录 016）文字直接压在静息纯色上：白字时它比中点更暗（不改变结论），墨水字时它更严格
    return [mixOklab(...rest), mixOklab(...hover), rest[1]];
  }
  const { top, bottom } = SOLID_LABEL_BAND;
  return [rest, hover].flatMap(([from, to]) => [gradientAt(from, to, top), gradientAt(from, to, bottom)]);
}

/** 在 [low, high] 内找满足 ok 的、离 from 最近的亮度（ok 在区间上单调）。 */
function bisectLightness(from: number, to: number, ok: (L: number) => boolean): number {
  let fail = from;
  let pass = to;
  for (let i = 0; i < 40; i += 1) {
    const mid = (fail + pass) / 2;
    if (ok(mid)) {
      pass = mid;
    } else {
      fail = mid;
    }
  }
  return pass;
}

/**
 * 白字实底的悬停渐变上端提亮幅度（相对静息亮度）：默认 `SOLID_RAMP_OFFSETS.hoverHi`；
 * 白字在悬停渐变标签区间（`SOLID_LABEL_BAND` 上下两端）不足 4.5 时，收敛到刚好达标的最大幅度。
 * 只动悬停一档，静息渐变、实底亮度与“最多压暗”上限都不变；墨水字（上端更亮反而更清楚）保持默认（任务 5.7）。
 */
export function solveSolidHoverHiOffset(L: number, chroma: number, hue: number, on: string): number {
  const fallback = SOLID_RAMP_OFFSETS.hoverHi;
  if (on !== WHITE) {
    return fallback;
  }
  const hover = oklchToHex(L + SOLID_RAMP_OFFSETS.hover, chroma, hue);
  const ok = (offset: number) => {
    const top = oklchToHex(L + offset, chroma, hue);
    const { top: t0, bottom: t1 } = SOLID_LABEL_BAND;
    return minContrast(WHITE, [gradientAt(top, hover, t0), gradientAt(top, hover, t1)]) >= THEME_TEXT_MIN_CONTRAST;
  };
  if (ok(fallback)) {
    return fallback;
  }
  return bisectLightness(fallback, SOLID_RAMP_OFFSETS.hover, ok);
}


/**
 * 实底按钮亮度与其上文字（主控决定 2026-10-03 修订版）：判定位置由 `coverage` 决定（默认静息、悬停两个渐变中点，危险确认按钮取标签区间上下两端），均需 ≥ 4.5。
 * - 白字优先：起点已达标不动；否则在 [floorL, 起点] 内整体压暗到刚好达标（只降 L，色相、彩度、偏移不变）；
 * - 压到 floorL 仍不达标：`allowInk` 时改用墨水（起点达标不动，否则往亮处求解到刚好达标）；
 *   不允许墨水（危险确认按钮）时 floorL 应为 0，结果总能让白字达标。
 */
export function solveSolidRamp(options: {
  startL: number;
  floorL: number;
  chroma: number;
  hue: number;
  ink: string;
  allowInk: boolean;
  coverage?: SolidLabelCoverage;
}): SolidRampResult {
  const { startL, floorL, chroma, hue, ink, allowInk, coverage = 'midpoint' } = options;
  // 墨水字的最差处在渐变下端（更暗）。白字的悬停区间由 solveSolidHoverHiOffset 收敛上端保证；墨水字不能靠收上端，
  // 只判中点会漏掉悬停渐变下端（任务 5.11 组合测试：深海 + 亮紫强调色悬停下端 4.47:1），因此墨水还要覆盖悬停标签区间。
  const inkBeds = (L: number) => {
    const beds = solidLabelBeds(L, chroma, hue, coverage);
    if (coverage !== 'midpoint') return beds;
    const top = oklchToHex(L + SOLID_RAMP_OFFSETS.hoverHi, chroma, hue);
    const bottom = oklchToHex(L + SOLID_RAMP_OFFSETS.hover, chroma, hue);
    return [...beds, gradientAt(top, bottom, SOLID_LABEL_BAND.top), gradientAt(top, bottom, SOLID_LABEL_BAND.bottom)];
  };
  const passes = (text: string, L: number) =>
    minContrast(text, text === WHITE ? solidLabelBeds(L, chroma, hue, coverage) : inkBeds(L)) >= THEME_TEXT_MIN_CONTRAST;

  if (passes(WHITE, startL)) {
    return { L: startL, on: WHITE };
  }
  if (floorL <= startL && passes(WHITE, floorL)) {
    return { L: bisectLightness(startL, floorL, (L) => passes(WHITE, L)), on: WHITE };
  }
  if (!allowInk) {
    return { L: floorL, on: WHITE };
  }
  if (passes(ink, startL)) {
    return { L: startL, on: ink };
  }
  const maxL = 1 - SOLID_RAMP_OFFSETS.hoverHi;
  return passes(ink, maxL) ? { L: bisectLightness(startL, maxL, (L) => passes(ink, L)), on: ink } : { L: startL, on: ink };
}

/**
 * 选中淡底与选中项悬停的强调色透明度：默认档位（SELECTED_ACCENT_ALPHA / _HOVER_ALPHA）已满足
 * SELECTION_MIN_DELTA 时原样返回（四个预设取值不变）；否则按 0.01 步进往上找第一个满足的透明度，
 * 上限 SELECTED_ACCENT_ALPHA_MAX。只在强调色彩度很低或很暗、或层级对比度很高（中性悬停被拉亮/拉暗）时触发（任务 5.11）。
 */
export function solveSelectedAccentAlpha(options: {
  accent: string;
  /** 选中项会落在的表面（面板、抬升面） */
  beds: readonly string[];
  hover: string;
  base: number;
  hoverBase: number;
}): { alpha: number; hoverAlpha: number } {
  const { accent, beds, hover, base, hoverBase } = options;
  const over = (alpha: number, bed: string) => compositeOver(withAlpha(accent, alpha), bed);
  const selectedOk = (alpha: number) =>
    beds.every((bed) => {
      const selected = over(alpha, bed);
      return deltaEOK(selected, hover) >= SELECTION_MIN_DELTA.vsHover && deltaEOK(selected, bed) >= SELECTION_MIN_DELTA.vsRest;
    });
  const hoverOk = (alpha: number, hoverAlpha: number) =>
    beds.every((bed) => deltaEOK(over(hoverAlpha, bed), over(alpha, bed)) >= SELECTION_MIN_DELTA.hoverVsSelected);
  const step = 0.01;
  let alpha = base;
  while (!selectedOk(alpha) && alpha + step <= SELECTED_ACCENT_ALPHA_MAX + 1e-9) {
    alpha = Math.round((alpha + step) * 100) / 100;
  }
  let hoverAlpha = Math.round((alpha + (hoverBase - base)) * 100) / 100;
  while (!hoverOk(alpha, hoverAlpha) && hoverAlpha + step <= SELECTED_ACCENT_ALPHA_MAX + (hoverBase - base) + 1e-9) {
    hoverAlpha = Math.round((hoverAlpha + step) * 100) / 100;
  }
  return { alpha, hoverAlpha };
}

/** 从种子推导全部令牌；overrides 按令牌名逐个覆盖最终值（不再参与派生）。 */
export function deriveThemeTokens(seedInput: Partial<ThemeSeed>, overrides?: ThemeTokenOverrides): ThemeTokens {
  const s = normalizeThemeSeed(seedInput);
  const dark = s.mode !== 'light';
  const k = s.contrast;
  const st = 0.024 * k;
  const L0 = s.base;
  const N = (L: number, c: number = s.tint) => oklchToHex(L, c, s.hue);
  const t = {} as ThemeColorTokens;

  // ── 表面（与参考实现一致） ──
  if (dark) {
    Object.assign(t, {
      gap: N(L0 - 0.6 * st),
      window: N(L0),
      panel: N(L0 + st),
      raised: N(L0 + 2 * st),
      control: N(L0 + 2.8 * st),
      controlHover: N(L0 + 3.8 * st),
      controlPressed: N(L0 + 4.8 * st),
      hover: N(L0 + 2.6 * st),
      selected: N(L0 + 4 * st),
      line: N(L0 + 2.2 * st),
      lineStrong: N(L0 + 3.8 * st),
      textDisabled: N(L0 + 0.2),
      edge: 'rgba(255,255,255,0.06)',
      shade: 'rgba(0,0,0,0.5)',
      media: N(L0 - 0.5 * st),
    });
  } else {
    Object.assign(t, {
      gap: N(L0 - 0.05 * k),
      window: N(L0),
      panel: N(Math.min(1, L0 + 0.022)),
      raised: N(L0 - 0.022 * k),
      control: N(L0 - 0.032 * k),
      controlHover: N(L0 - 0.055 * k),
      controlPressed: N(L0 - 0.08 * k),
      hover: N(L0 - 0.035 * k),
      selected: N(L0 - 0.065 * k),
      line: N(L0 - 0.075 * k),
      lineStrong: N(L0 - 0.13 * k),
      textDisabled: N(0.78),
      edge: 'rgba(0,0,0,0.07)',
      shade: 'rgba(28,32,40,0.18)',
      media: N(0.16),
    });
  }
  t.canvas = t.window;

  // ── 强调（先于文字：选中淡底参与文字求解） ──
  const direction = dark ? 'up' : 'down';
  const ink = N(0.17, 0.01);
  const a = hexToOklch(s.accent);
  const accentRange = dark ? ACCENT_L_RANGE.dark : ACCENT_L_RANGE.light;
  const accentStartL = clamp(a.L, accentRange.min, accentRange.max);
  const accentRamp = solveSolidRamp({
    startL: accentStartL,
    floorL: accentStartL - ACCENT_MAX_DARKEN,
    chroma: a.C,
    hue: a.H,
    ink,
    allowInk: true,
  });
  const aL = accentRamp.L;
  const accentHoverHiOffset = solveSolidHoverHiOffset(aL, a.C, a.H, accentRamp.on);
  const A = (L: number, C: number = a.C) => oklchToHex(L, C, a.H);
  const accentTextChroma = dark ? Math.min(a.C, 0.13) : a.C;
  Object.assign(t, {
    accent: A(aL),
    accentHi: A(aL + SOLID_RAMP_OFFSETS.hi),
    accentHover: A(flatSolidStateL(aL, accentRamp.on, 'hover')),
    accentHoverHi: A(aL + accentHoverHiOffset),
    accentPressed: A(flatSolidStateL(aL, accentRamp.on, 'pressed')),
    accentRing: A(dark ? 0.7 : 0.62),
  });
  // 选中淡强调底（重要记录 012，任务 4.3）：强调色低透明度，叠在窗口/面板/抬升面上都与悬停、静息可分。
  // 档位依据见 4.3 执行记录：深色 0.20 / 浅色 0.18（浅色 0.12 时与悬停几乎同色）；选中项悬停再加一档。
  // 5.11：低彩度/很暗的强调色或极端层级对比度下默认档位与悬停难分，按 SELECTION_MIN_DELTA 求解透明度（预设不变）。
  const selectedAlpha = solveSelectedAccentAlpha({
    accent: t.accent,
    beds: [t.panel, t.raised],
    hover: t.hover,
    base: SELECTED_ACCENT_ALPHA[dark ? 'dark' : 'light'],
    hoverBase: SELECTED_ACCENT_HOVER_ALPHA[dark ? 'dark' : 'light'],
  });
  t.selectedAccent = withAlpha(t.accent, selectedAlpha.alpha);
  t.selectedAccentHover = withAlpha(t.accent, selectedAlpha.hoverAlpha);
  // 文字也会压在选中淡底上（导航/菜单选中项的主要与辅助文字、分段与格子的强调文字）：
  // 三档文字与强调文字的求解底集都加入这些合成色，四个预设下保证 ≥ 4.5（4.3：辅助文字在选中导航项上曾 4.17）
  const selectedBeds = [t.selectedAccent, t.selectedAccentHover]
    .flatMap((tint) => [t.window, t.panel, t.raised].map((bed) => compositeOver(tint, bed)));
  // ── 文字（010：按目标对比度求解） ──
  const surfaceTextBeds = [t.window, t.panel, t.raised, t.hover, t.selected, t.control, t.controlHover];
  // 深色玻璃（黑 72%）压在中灰内容上时辅助文字也须达标（4.3 只对标准档断言；5.11 组合测试：柔和档 4.44–4.48）
  const glassTextBeds = dark ? [compositeOver(`rgba(0,0,0,${DARK_GLASS_TINT_ALPHA})`, oklchToHex(0.6, 0, 0))] : [];
  const textBeds = [...surfaceTextBeds, ...selectedBeds, ...glassTextBeds];
  const textChroma = dark
    ? { text1: s.tint * 0.5, text2: s.tint * 0.8, text3: s.tint }
    : { text1: s.tint * 2, text2: s.tint * 2, text3: s.tint * 2 };
  const textStart = dark ? TEXT_START_L.dark : TEXT_START_L.light;
  const textGap = dark ? TEXT2_MIN_GAP.dark : TEXT2_MIN_GAP.light;
  t.text1 = N(dark ? 0.95 : 0.2, textChroma.text1);
  const text3L = solveLightnessForContrast({
    startL: textStart.text3,
    chroma: textChroma.text3,
    hue: s.hue,
    beds: textBeds,
    target: THEME_TEXT_MIN_CONTRAST,
    direction,
  });
  t.text3 = N(text3L, textChroma.text3);
  const text2Start = dark ? Math.max(textStart.text2, text3L + textGap) : Math.min(textStart.text2, text3L - textGap);
  t.text2 = N(
    solveLightnessForContrast({
      startL: text2Start,
      chroma: textChroma.text2,
      hue: s.hue,
      beds: textBeds,
      target: THEME_TEXT_MIN_CONTRAST,
      direction,
    }),
    textChroma.text2
  );

  // 强调文字还会压在两类更深的选中底上（任务 5.7，5.4 转交的纸白 4.36 / 3.77）：
  // ① 控件层表面上的选中淡底（芯片、触发器在控件底或悬停底上被选中）；
  // ② 玻璃浮层压在媒体上时的选中淡底（查看器对比分段：浅色玻璃叠在固定深色媒体底上是中灰）。
  // 只加进强调文字的底集，三档中性文字不受影响。
  const glassOverMedia = compositeOver(
    dark ? `rgba(0,0,0,${DARK_GLASS_TINT_ALPHA})` : withAlpha(t.panel, LIGHT_GLASS_TINT_ALPHA),
    t.media
  );
  const accentTextBeds = [
    ...textBeds,
    ...[t.selectedAccent, t.selectedAccentHover]
      .flatMap((tint) => [t.control, t.controlHover, t.hover].map((bed) => compositeOver(tint, bed))),
    ...[t.selectedAccent, t.selectedAccentHover, withAlpha(t.accent, GLASS_SELECTED_ACCENT_ALPHA[dark ? 'dark' : 'light'])]
      .map((tint) => compositeOver(tint, glassOverMedia)),
  ];
  t.accentText = A(
    solveLightnessForContrast({
      startL: dark ? 0.8 : 0.5,
      chroma: accentTextChroma,
      hue: a.H,
      beds: accentTextBeds,
      target: THEME_TEXT_MIN_CONTRAST,
      direction,
    }),
    accentTextChroma
  );
  t.accentTint = withAlpha(t.accent, dark ? 0.2 : 0.12);
  t.onAccent = accentRamp.on;

  // ── 状态（固定色相、统一亮度） ──
  const statusTintAlpha = dark ? 0.16 : 0.1;
  const statusText = (startL: number, hue: number, tint: string) => {
    // 状态文字不压在选中淡底上：沿用表面底集，状态色取值不受 4.3 选中底影响
    const beds = [...surfaceTextBeds, compositeOver(tint, t.window), compositeOver(tint, t.panel), compositeOver(tint, t.raised)];
    return oklchToHex(
      solveLightnessForContrast({ startL, chroma: 0.15, hue, beds, target: THEME_TEXT_MIN_CONTRAST, direction }),
      0.15,
      hue
    );
  };
  // 危险确认按钮（dangerSolid）必须白字：按需压暗到静息、悬停渐变在标签区间内处处达标，不设降幅上限
  const dangerRamp = solveSolidRamp({
    startL: dark ? 0.6 : 0.55,
    floorL: 0,
    chroma: 0.19,
    hue: 25,
    ink,
    allowInk: false,
    coverage: 'labelBand',
  });
  const D = (offset: number) => oklchToHex(dangerRamp.L + offset, 0.19, 25);
  t.danger = D(0);
  t.dangerHi = D(SOLID_RAMP_OFFSETS.hi);
  t.dangerHover = oklchToHex(flatSolidStateL(dangerRamp.L, dangerRamp.on, 'hover'), 0.19, 25);
  t.dangerHoverHi = D(SOLID_RAMP_OFFSETS.hoverHi);
  t.dangerPressed = oklchToHex(flatSolidStateL(dangerRamp.L, dangerRamp.on, 'pressed'), 0.19, 25);
  // 危险浅底（危险文字、静默危险按钮悬停、状态块）不是确认按钮实底，沿用中点求解的色值，不随标签区间判定加深（5.7）
  const dangerTintRamp = solveSolidRamp({ startL: dark ? 0.6 : 0.55, floorL: 0, chroma: 0.19, hue: 25, ink, allowInk: false });
  t.dangerTint = withAlpha(oklchToHex(dangerTintRamp.L, 0.19, 25), statusTintAlpha);
  t.dangerText = statusText(dark ? 0.74 : 0.5, 25, t.dangerTint);
  t.onDanger = dangerRamp.on;
  t.success = oklchToHex(solveSolidFillL(dark ? 0.76 : 0.55, 0.15, 155, ink), 0.15, 155);
  t.successTint = withAlpha(t.success, statusTintAlpha);
  t.successText = statusText(dark ? 0.76 : 0.5, 155, t.successTint);
  t.onSuccess = pickOnColor([t.success], ink);
  t.warning = oklchToHex(solveSolidFillL(dark ? 0.8 : 0.64, 0.15, 75, ink), 0.15, 75);
  t.warningTint = withAlpha(t.warning, statusTintAlpha);
  t.warningText = statusText(dark ? 0.8 : 0.5, 75, t.warningTint);
  t.onWarning = pickOnColor([t.warning], ink);

  // ── 素材片段与波形（与参考实现一致） ──
  const clipL = dark ? L0 + 6 * st : L0 - 0.12;
  const clipLineL = clipL + (dark ? 0.07 : -0.09);
  Object.assign(t, {
    clipVideo: oklchToHex(clipL, 0.045, 255),
    clipVideoLine: oklchToHex(clipLineL, 0.07, 255),
    clipAudio: oklchToHex(clipL, 0.045, 165),
    clipAudioLine: oklchToHex(clipLineL, 0.07, 165),
    clipText: oklchToHex(clipL, 0.045, 305),
    clipTextLine: oklchToHex(clipLineL, 0.07, 305),
    clipWave: dark ? oklchToHex(0.84, 0.06, 165) : oklchToHex(0.36, 0.07, 165),
    wave: N(0.6),
    wavePlayed: t.text1,
    waveCut: oklchToHex(dark ? 0.42 : 0.78, 0.09, 25),
  });

  // ── 玻璃与遮罩（深色保持现有 index.css 数值；浅色反向派生） ──
  if (dark) {
    Object.assign(t, {
      // 4.3：0.66 时辅助文字压在玻璃上只有 4.16–4.44:1（设置弹窗、画布“更多”菜单、资产浮动面板），提到 0.72，
      // 玻璃下是中灰内容（#808080）时 text3 仍 ≥ 4.5（themeEngine.test 断言）；纸白不变。
      glassTint: `rgba(0,0,0,${DARK_GLASS_TINT_ALPHA})`,
      glassEdge: 'rgba(255,255,255,0.16)',
      glassSheen: 'rgba(255,255,255,0.1)',
      glassHover: 'rgba(255,255,255,0.14)',
      glassPressed: 'rgba(255,255,255,0.22)',
      glassSelected: 'rgba(255,255,255,0.18)',
      glassSelectedAccent: withAlpha(t.accent, GLASS_SELECTED_ACCENT_ALPHA.dark),
      glassDivider: 'rgba(255,255,255,0.12)',
      glassControlTint: 'rgba(255,255,255,0.08)',
      glassRegionTint: withAlpha(t.window, 0.18),
      glassSurfaceTint: withAlpha(t.panel, 0.58),
      scrim: 'rgba(0,0,0,0.42)',
      scrimSoft: 'rgba(0,0,0,0.2)',
      scrimSolid: 'rgba(0,0,0,0.55)',
    });
  } else {
    Object.assign(t, {
      glassTint: withAlpha(t.panel, LIGHT_GLASS_TINT_ALPHA),
      glassEdge: withAlpha(t.text1, 0.12),
      glassSheen: 'rgba(255,255,255,0.6)',
      glassHover: withAlpha(t.text1, 0.06),
      glassPressed: withAlpha(t.text1, 0.12),
      glassSelected: withAlpha(t.text1, 0.09),
      glassSelectedAccent: withAlpha(t.accent, GLASS_SELECTED_ACCENT_ALPHA.light),
      glassDivider: withAlpha(t.text1, 0.1),
      glassControlTint: withAlpha(t.text1, 0.04),
      glassRegionTint: withAlpha(t.window, 0.35),
      glassSurfaceTint: withAlpha(t.panel, 0.7),
      scrim: 'rgba(28,32,40,0.28)',
      scrimSoft: 'rgba(28,32,40,0.12)',
      scrimSolid: 'rgba(28,32,40,0.4)',
    });
  }

  Object.assign(t, MEDIA_OVERLAY_TOKENS);

  if (overrides) {
    for (const name of THEME_COLOR_TOKEN_NAMES) {
      const value = overrides[name];
      if (typeof value === 'string') {
        t[name] = value;
      }
    }
  }

  return { mode: s.mode, colorScheme: s.mode, colors: t };
}
