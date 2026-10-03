/**
 * 主题数据格式 v2 与 v1 → v2 迁移（纯函数）。
 *
 * v2：`{ version: 2, seed, overrides?, uiRadiusPreset }`。毛玻璃开关仍是本机观感偏好，不进可分享的 payload。
 * v1：9 个手填颜色 + 强调色 + 色调 + 圆角（`runtimeTheme.ts` 的 `RuntimeThemePayload`）。
 *
 * 迁移规则（重要记录 010、1.1 第八节）：
 * - 色调 `themeTonePreset` 从未生效，忽略；
 * - 颜色等于任一 v1 内置方案（当前默认、两代旧默认、4 个内置预设、5 个旧版内置预设）时视为未自定义 9 色
 *   → 石墨预设（主控决定 2026-10-03），不拟合、无覆盖；
 * - 强调色：旧默认强调色（各代均为 #3B82F6）视为“跟随预设”，换成石墨强调色；改过的保留为种子 accent（`seedAccentFromV1`，
 *   迁移、拟合与 settingsStore 的旧设置写入共用这一条）；
 * - 只有真正自定义过 9 色的方案才拟合为种子（模式、色相、倾向、窗口亮度、层级对比度），拟合后色差超过阈值的令牌放进 overrides；
 *   文字类覆盖只在仍满足 4.5:1 时保留，避免把旧方案的对比度缺陷带进新主题。
 *
 * 导入与旧设置读取都走 `parseThemePayload` / `migrateV1ThemeSettings` 这一个入口。
 * v1 类型在此独立声明（结构与 runtimeTheme.ts 一致），第二段接线后由 runtimeTheme 改为引用这里。
 */
import {
  DEFAULT_THEME_COLOR_SCHEME_HEX,
  LEGACY_DEFAULT_THEME_COLOR_SCHEME_HEX,
  LEGACY_NEUTRAL_THEME_COLOR_SCHEME_HEX,
  LEGACY_THEME_PALETTE_PRESET_HEX,
  SETTINGS_ACCENT_HEX,
  THEME_PALETTE_PRESET_HEX,
} from './colorTokens';
import { deltaEOK, hexToOklch, minContrast, normalizeHex, parseColor, rgbaString } from './themeColor';
import {
  DEFAULT_THEME_SEED,
  THEME_COLOR_TOKEN_NAMES,
  THEME_PRESETS,
  THEME_PRESET_IDS,
  THEME_SEED_LIMITS,
  THEME_TEXT_MIN_CONTRAST,
  deriveThemeTokens,
  normalizeThemeSeed,
  type ThemeColorTokenName,
  type ThemePresetId,
  type ThemeSeed,
  type ThemeTokenOverrides,
} from './themeEngine';

export type ThemeUiRadiusPreset = 'compact' | 'default' | 'large';

export const THEME_V1_COLOR_TOKENS = ['bg', 'surface', 'border', 'text', 'textMuted', 'app', 'canvas', 'panel', 'layer'] as const;

export type ThemeV1ColorToken = (typeof THEME_V1_COLOR_TOKENS)[number];

export type ThemeV1ColorScheme = Record<ThemeV1ColorToken, string>;

export interface ThemePayloadV1 {
  version: 1;
  themeTonePreset: 'neutral' | 'warm' | 'cool';
  uiRadiusPreset: ThemeUiRadiusPreset;
  accentColor: string;
  colors: ThemeV1ColorScheme;
}

export interface ThemePayloadV2 {
  version: 2;
  seed: ThemeSeed;
  overrides?: ThemeTokenOverrides;
  uiRadiusPreset: ThemeUiRadiusPreset;
}

/** 旧设置读取入口的输入（settingsStore 持久化字段）。 */
export interface ThemeV1Settings {
  themeColors?: Partial<ThemeV1ColorScheme> | null;
  accentColor?: string | null;
  uiRadiusPreset?: string | null;
}

/** 拟合后 ΔE_OK 超过该值的令牌进入 overrides（约 1.5 倍可察觉差异）。 */
export const THEME_V1_OVERRIDE_DELTA_E = 0.03;

/** v1 颜色 → 新令牌的对应关系（`bg` 旧义按用途拆分到 gap/media，不参与覆盖）。 */
export const THEME_V1_TOKEN_MAP: ReadonlyArray<readonly [ThemeV1ColorToken, ThemeColorTokenName]> = [
  ['app', 'window'],
  ['canvas', 'canvas'],
  ['panel', 'panel'],
  ['surface', 'raised'],
  ['layer', 'hover'],
  ['border', 'line'],
  ['text', 'text1'],
  ['textMuted', 'text2'],
];

const TEXT_TOKENS = new Set<ThemeColorTokenName>(['text1', 'text2', 'text3']);

const OVERRIDABLE_TOKENS = new Set<string>(THEME_COLOR_TOKEN_NAMES);

function isUiRadiusPreset(value: unknown): value is ThemeUiRadiusPreset {
  return value === 'compact' || value === 'default' || value === 'large';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeV1Colors(input?: Partial<Record<string, unknown>> | null): ThemeV1ColorScheme {
  const result = { ...DEFAULT_THEME_COLOR_SCHEME_HEX } as ThemeV1ColorScheme;
  for (const token of THEME_V1_COLOR_TOKENS) {
    const value = input?.[token];
    const hex = typeof value === 'string' ? normalizeHex(value) : null;
    result[token] = hex ?? DEFAULT_THEME_COLOR_SCHEME_HEX[token].toUpperCase();
  }
  return result;
}

/** v1 全部内置方案：默认、两代旧默认、4 个内置预设、5 个旧版内置预设（旧版预设已由 settingsStore 映射到内置预设）。 */
const V1_BUILT_IN_SCHEMES = [
  DEFAULT_THEME_COLOR_SCHEME_HEX,
  LEGACY_DEFAULT_THEME_COLOR_SCHEME_HEX,
  LEGACY_NEUTRAL_THEME_COLOR_SCHEME_HEX,
  ...THEME_PALETTE_PRESET_HEX.map((preset) => preset.colors),
  ...LEGACY_THEME_PALETTE_PRESET_HEX.map((preset) => preset.colors),
].map((scheme) => normalizeV1Colors(scheme));

/** 颜色等于任一 v1 内置方案，即用户没有自定义过 9 色。 */
export function isV1BuiltInColors(colors: ThemeV1ColorScheme): boolean {
  return V1_BUILT_IN_SCHEMES.some((scheme) => THEME_V1_COLOR_TOKENS.every((token) => scheme[token] === colors[token]));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/** v1 强调色 → 种子强调色：旧默认值视为“跟随预设”。 */
export function seedAccentFromV1(accentColor: string | null | undefined): string {
  const accent = (accentColor && normalizeHex(accentColor)) || null;
  return !accent || accent === normalizeHex(SETTINGS_ACCENT_HEX) ? DEFAULT_THEME_SEED.accent : accent;
}

/** 只拟合种子（不含覆盖），供迁移与测试使用。 */
export function fitSeedFromV1Colors(colors: ThemeV1ColorScheme, accentColor: string): ThemeSeed {
  const lch = Object.fromEntries(THEME_V1_COLOR_TOKENS.map((token) => [token, hexToOklch(colors[token])])) as Record<
    ThemeV1ColorToken,
    ReturnType<typeof hexToOklch>
  >;
  const L0 = lch.app.L;
  const dark = L0 < 0.6;

  // 色相与倾向：表面类颜色的彩度加权圆周平均
  const surfaces: ThemeV1ColorToken[] = ['app', 'canvas', 'panel', 'surface', 'layer', 'bg'];
  let x = 0;
  let y = 0;
  let chromaSum = 0;
  for (const token of surfaces) {
    const { C, H } = lch[token];
    x += C * Math.cos((H * Math.PI) / 180);
    y += C * Math.sin((H * Math.PI) / 180);
    chromaSum += C;
  }
  const tint = chromaSum / surfaces.length;
  const hue = tint < 0.002 ? DEFAULT_THEME_SEED.hue : ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

  // 层级对比度：对“表面 = 窗口 ± 系数 × k”做过原点的最小二乘
  let numerator = 0;
  let denominator = 0;
  const steps: ReadonlyArray<readonly [ThemeV1ColorToken, number]> = dark
    ? [
        ['panel', 0.024],
        ['surface', 0.048],
        ['layer', 0.0624],
        ['border', 0.0528],
      ]
    : [
        ['surface', -0.022],
        ['layer', -0.035],
        ['border', -0.075],
      ];
  for (const [token, coefficient] of steps) {
    numerator += coefficient * (lch[token].L - L0);
    denominator += coefficient * coefficient;
  }
  const contrast = denominator > 0 ? numerator / denominator : 1;

  return normalizeThemeSeed({
    mode: dark ? 'dark' : 'light',
    hue: round(hue, 1),
    tint: round(clamp(tint, THEME_SEED_LIMITS.tint.min, THEME_SEED_LIMITS.tint.max), 4),
    base: round(L0, 3),
    contrast: round(clamp(contrast, THEME_SEED_LIMITS.contrast.min, THEME_SEED_LIMITS.contrast.max), 2),
    accent: seedAccentFromV1(accentColor),
  });
}

export interface ThemeV1FitEntry {
  v1Token: ThemeV1ColorToken;
  token: ThemeColorTokenName;
  v1: string;
  derived: string;
  deltaE: number;
  overridden: boolean;
  /** 色差超阈值但未覆盖的原因 */
  rejected?: 'contrast';
}

export interface ThemeV1MigrationResult {
  payload: ThemePayloadV2;
  /** builtIn：未自定义 9 色，换成石墨；fit：拟合 */
  strategy: 'builtIn' | 'fit';
  report: ThemeV1FitEntry[];
}

export interface ThemeV1FitResult {
  seed: ThemeSeed;
  overrides: ThemeTokenOverrides;
  report: ThemeV1FitEntry[];
}

/** 拟合种子并计算覆盖（不判断内置方案；迁移入口只对自定义 9 色调用）。 */
export function fitV1Colors(colors: ThemeV1ColorScheme, accentColor: string): ThemeV1FitResult {
  const seed = fitSeedFromV1Colors(colors, accentColor);
  const derived = deriveThemeTokens(seed).colors;
  const overrides: ThemeTokenOverrides = {};
  const report: ThemeV1FitEntry[] = [];
  for (const [v1Token, token] of THEME_V1_TOKEN_MAP) {
    const v1 = colors[v1Token];
    const deltaE = deltaEOK(v1, derived[token]);
    const entry: ThemeV1FitEntry = { v1Token, token, v1, derived: derived[token], deltaE, overridden: false };
    if (deltaE > THEME_V1_OVERRIDE_DELTA_E) {
      const textBeds = [derived.window, derived.panel, derived.raised, derived.hover, derived.selected];
      if (TEXT_TOKENS.has(token) && minContrast(v1, textBeds) < THEME_TEXT_MIN_CONTRAST) {
        entry.rejected = 'contrast';
      } else {
        overrides[token] = v1;
        entry.overridden = true;
      }
    }
    report.push(entry);
  }
  return { seed, overrides, report };
}

export function migrateV1Theme(input: {
  colors: ThemeV1ColorScheme;
  accentColor: string;
  uiRadiusPreset: ThemeUiRadiusPreset;
}): ThemeV1MigrationResult {
  const colors = normalizeV1Colors(input.colors);
  const accent = normalizeHex(input.accentColor) ?? SETTINGS_ACCENT_HEX;
  const uiRadiusPreset = isUiRadiusPreset(input.uiRadiusPreset) ? input.uiRadiusPreset : 'default';

  if (isV1BuiltInColors(colors)) {
    const seed = normalizeThemeSeed({ ...DEFAULT_THEME_SEED, accent: seedAccentFromV1(accent) });
    return { payload: createThemePayloadV2({ seed, uiRadiusPreset }), strategy: 'builtIn', report: [] };
  }

  const { seed, overrides, report } = fitV1Colors(colors, accent);
  return { payload: createThemePayloadV2({ seed, overrides, uiRadiusPreset }), strategy: 'fit', report };
}

/** 旧设置（settingsStore 持久化字段）读取入口。 */
export function migrateV1ThemeSettings(settings: ThemeV1Settings): ThemePayloadV2 {
  return migrateV1Theme({
    colors: normalizeV1Colors(settings.themeColors ?? undefined),
    accentColor: settings.accentColor ?? SETTINGS_ACCENT_HEX,
    uiRadiusPreset: isUiRadiusPreset(settings.uiRadiusPreset) ? settings.uiRadiusPreset : 'default',
  }).payload;
}

function normalizeOverrideValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const hex = normalizeHex(value);
  if (hex) {
    return hex;
  }
  const rgba = parseColor(value);
  return rgba ? rgbaString(rgba) : null;
}

export function normalizeThemeOverrides(input: unknown): ThemeTokenOverrides | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const result: ThemeTokenOverrides = {};
  for (const [name, value] of Object.entries(input)) {
    if (!OVERRIDABLE_TOKENS.has(name)) {
      continue;
    }
    const normalized = normalizeOverrideValue(value);
    if (normalized) {
      result[name as ThemeColorTokenName] = normalized;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function createThemePayloadV2(input: {
  seed: Partial<ThemeSeed>;
  overrides?: ThemeTokenOverrides;
  uiRadiusPreset?: ThemeUiRadiusPreset;
}): ThemePayloadV2 {
  const payload: ThemePayloadV2 = {
    version: 2,
    seed: normalizeThemeSeed(input.seed),
    uiRadiusPreset: isUiRadiusPreset(input.uiRadiusPreset) ? input.uiRadiusPreset : 'default',
  };
  const overrides = normalizeThemeOverrides(input.overrides);
  if (overrides) {
    payload.overrides = overrides;
  }
  return payload;
}

function parseV2(input: Record<string, unknown>): ThemePayloadV2 | null {
  const seed = input.seed;
  if (!isRecord(seed) || (seed.mode !== 'dark' && seed.mode !== 'light')) {
    return null;
  }
  if (!isUiRadiusPreset(input.uiRadiusPreset)) {
    return null;
  }
  return createThemePayloadV2({
    seed: seed as Partial<ThemeSeed>,
    overrides: normalizeThemeOverrides(input.overrides),
    uiRadiusPreset: input.uiRadiusPreset,
  });
}

function parseV1(input: Record<string, unknown>): ThemePayloadV2 | null {
  const tone = input.themeTonePreset;
  if (tone !== 'neutral' && tone !== 'warm' && tone !== 'cool') {
    return null;
  }
  if (!isUiRadiusPreset(input.uiRadiusPreset)) {
    return null;
  }
  return migrateV1Theme({
    colors: normalizeV1Colors(isRecord(input.colors) ? input.colors : undefined),
    accentColor: typeof input.accentColor === 'string' ? input.accentColor : SETTINGS_ACCENT_HEX,
    uiRadiusPreset: input.uiRadiusPreset,
  }).payload;
}

/** 导入入口：接受 v1（自动迁移）或 v2；格式不对返回 null。 */
export function parseThemePayload(input: unknown): ThemePayloadV2 | null {
  if (!isRecord(input)) {
    return null;
  }
  if (input.version === 2) {
    return parseV2(input);
  }
  if (input.version === 1) {
    return parseV1(input);
  }
  return null;
}

/** 种子的底色部分（模式、色相、倾向、窗口亮度）与某个预设相同则返回该预设，供设置界面高亮。 */
export function findThemePresetId(seed: ThemeSeed): ThemePresetId | null {
  for (const id of THEME_PRESET_IDS) {
    const preset = THEME_PRESETS[id].seed;
    if (preset.mode === seed.mode && preset.hue === seed.hue && preset.tint === seed.tint && preset.base === seed.base) {
      return id;
    }
  }
  return null;
}
