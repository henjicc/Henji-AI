/**
 * 可分享主题数据格式 v2（纯函数）：`{ version: 2, seed, overrides?, uiRadiusPreset }`。
 * 毛玻璃开关仍是本机观感偏好，不进可分享的 payload。
 *
 * 2026-10-21 起持久格式正式向后兼容，兼容起点即 v2；此前的 v1 手填颜色主题与其转换已按用户决定清除，
 * 导入 v1 文件按格式不对返回 null，由设置页走现有失败提示。
 */
import { normalizeHex, parseColor, rgbaString } from './themeColor';
import {
  THEME_COLOR_TOKEN_NAMES,
  THEME_PRESETS,
  THEME_PRESET_IDS,
  normalizeThemeSeed,
  type ThemeColorTokenName,
  type ThemePresetId,
  type ThemeSeed,
  type ThemeTokenOverrides,
} from './themeEngine';

export type ThemeUiRadiusPreset = 'compact' | 'default' | 'large';

export interface ThemePayloadV2 {
  version: 2;
  seed: ThemeSeed;
  overrides?: ThemeTokenOverrides;
  uiRadiusPreset: ThemeUiRadiusPreset;
}

const OVERRIDABLE_TOKENS = new Set<string>(THEME_COLOR_TOKEN_NAMES);

function isUiRadiusPreset(value: unknown): value is ThemeUiRadiusPreset {
  return value === 'compact' || value === 'default' || value === 'large';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

/** 导入入口：只接受当前 v2；格式或版本不对返回 null。 */
export function parseThemePayload(input: unknown): ThemePayloadV2 | null {
  return isRecord(input) && input.version === 2 ? parseV2(input) : null;
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
