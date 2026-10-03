/**
 * 外观设置的选择状态（纯函数）：预设 + 强调色 + 层级对比度 → 主题种子与覆盖。
 *
 * 设置界面与助手只开放这三项（重要记录 002）；引擎与 payload v2 支持完整种子与单令牌覆盖，
 * 不能用预设表达的种子（v1 自定义九色的拟合结果、导入的非预设种子）作为“自定义”底色保留，
 * 切到预设后仍可切回，不会因为点一下预设就永久丢失。
 *
 * - 强调色 `accent = null` 表示跟随底色（预设或自定义）自带的强调色；
 * - 对比度档位是相对底色的倍数：预设底色的对比度为 1，因此档位值即最终对比度；
 *   自定义底色保留拟合出的对比度，“标准”档不改变它。
 */
import {
  DEFAULT_THEME_PRESET_ID,
  THEME_CONTRAST_LEVELS,
  THEME_PRESETS,
  THEME_PRESET_IDS,
  normalizeThemeSeed,
  type ThemeContrastLevel,
  type ThemePresetId,
  type ThemeSeed,
  type ThemeTokenOverrides,
} from './themeEngine';
import { findThemePresetId, normalizeThemeOverrides } from './themeMigration';
import { normalizeHex } from './themeColor';

export const THEME_CUSTOM_PRESET = 'custom' as const;

export type ThemeSelectionPreset = ThemePresetId | typeof THEME_CUSTOM_PRESET;

export const THEME_SELECTION_PRESETS: readonly ThemeSelectionPreset[] = [...THEME_PRESET_IDS, THEME_CUSTOM_PRESET];

export const THEME_CONTRAST_LEVEL_IDS = Object.keys(THEME_CONTRAST_LEVELS) as ThemeContrastLevel[];

export interface ThemeCustomBase {
  seed: ThemeSeed;
  overrides: ThemeTokenOverrides;
}

export interface ThemeSelection {
  preset: ThemeSelectionPreset;
  /** 用户选定的强调色 `#RRGGBB`；`null` 跟随底色自带的强调色 */
  accent: string | null;
  contrast: ThemeContrastLevel;
  /** 自定义底色；只来自 v1 自定义九色迁移或导入的非预设主题 */
  custom: ThemeCustomBase | null;
}

export const DEFAULT_THEME_SELECTION: ThemeSelection = {
  preset: DEFAULT_THEME_PRESET_ID,
  accent: null,
  contrast: 'standard',
  custom: null,
};

const CONTRAST_EPSILON = 1e-6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isThemeSelectionPreset(value: unknown): value is ThemeSelectionPreset {
  return typeof value === 'string' && (THEME_SELECTION_PRESETS as readonly string[]).includes(value);
}

export function isThemeContrastLevel(value: unknown): value is ThemeContrastLevel {
  return typeof value === 'string' && (THEME_CONTRAST_LEVEL_IDS as readonly string[]).includes(value);
}

/** 当前选择实际使用的底色种子（预设或自定义；“自定义”缺失时回落默认预设）。 */
export function resolveThemeBaseSeed(selection: Pick<ThemeSelection, 'preset' | 'custom'>): ThemeSeed {
  if (selection.preset === THEME_CUSTOM_PRESET) {
    return selection.custom?.seed ?? THEME_PRESETS[DEFAULT_THEME_PRESET_ID].seed;
  }
  return THEME_PRESETS[selection.preset].seed;
}

/** 选择 → 生效的种子与覆盖（应用、导出与界面小样共用）。 */
export function resolveThemeSelection(selection: ThemeSelection): { seed: ThemeSeed; overrides: ThemeTokenOverrides } {
  const base = resolveThemeBaseSeed(selection);
  const seed = normalizeThemeSeed({
    ...base,
    contrast: base.contrast * THEME_CONTRAST_LEVELS[selection.contrast],
    accent: selection.accent ?? base.accent,
  });
  const overrides = selection.preset === THEME_CUSTOM_PRESET && selection.custom ? { ...selection.custom.overrides } : {};
  return { seed, overrides };
}

function contrastLevelOf(contrast: number): ThemeContrastLevel | null {
  return THEME_CONTRAST_LEVEL_IDS.find((level) => Math.abs(THEME_CONTRAST_LEVELS[level] - contrast) < CONTRAST_EPSILON) ?? null;
}

/**
 * 种子 + 覆盖 → 选择（旧设置迁移与导入共用）。
 * 底色等于某个预设、无覆盖、对比度正好是某一档 → 该预设；强调色等于预设自带的视为跟随预设。
 * 其余一律作为自定义底色保存（强调色、对比度都并入底色，档位为“标准”、强调色跟随底色）。
 * `previousCustom`：结果是预设时沿用原有的自定义底色，导入预设主题不清掉用户的自定义配色。
 */
export function selectionFromThemeSeed(
  seedInput: Partial<ThemeSeed>,
  overridesInput?: ThemeTokenOverrides,
  previousCustom: ThemeCustomBase | null = null
): ThemeSelection {
  const seed = normalizeThemeSeed(seedInput);
  const overrides = normalizeThemeOverrides(overridesInput) ?? {};
  const presetId = findThemePresetId(seed);
  const level = contrastLevelOf(seed.contrast);
  if (presetId && level && Object.keys(overrides).length === 0) {
    const presetAccent = normalizeThemeSeed(THEME_PRESETS[presetId].seed).accent;
    return { preset: presetId, accent: seed.accent === presetAccent ? null : seed.accent, contrast: level, custom: previousCustom };
  }
  return { preset: THEME_CUSTOM_PRESET, accent: null, contrast: 'standard', custom: { seed, overrides } };
}

function normalizeCustomBase(input: unknown): ThemeCustomBase | null {
  if (!isRecord(input) || !isRecord(input.seed)) return null;
  const seed = input.seed as Partial<ThemeSeed>;
  if (seed.mode !== 'dark' && seed.mode !== 'light') return null;
  return { seed: normalizeThemeSeed(seed), overrides: normalizeThemeOverrides(input.overrides) ?? {} };
}

/** 持久化值规范化；结构不对返回 null（由调用方回落到迁移入口）。 */
export function normalizeThemeSelection(input: unknown): ThemeSelection | null {
  if (!isRecord(input) || !isThemeSelectionPreset(input.preset)) return null;
  const custom = normalizeCustomBase(input.custom);
  const preset = input.preset === THEME_CUSTOM_PRESET && !custom ? DEFAULT_THEME_PRESET_ID : input.preset;
  const accent = typeof input.accent === 'string' ? normalizeHex(input.accent) : null;
  return {
    preset,
    accent,
    contrast: isThemeContrastLevel(input.contrast) ? input.contrast : 'standard',
    custom,
  };
}
