/**
 * 运行时主题应用：种子 + 覆盖 → 令牌（themeEngine）→ CSS 变量 + color-scheme（themeCssVars）→ 令牌订阅（themeTokenStore）。
 *
 * 旧 CSS 变量（`--app-rgb`、`--ui-glass-*` 等）是 index.css 里指向新变量的静态别名，运行时不写它们
 * （内联样式会盖掉 `data-ui-blur='off'` 退化规则）。
 *
 * 本文件仍导出 v1 配色方案的类型与工具（9 色、色调、导入导出）：外观设置界面在 1.4 改为种子式之前继续用它们，
 * settingsStore 把这些旧设置统一经 `migrateV1ThemeSettings` 换算成种子。
 */
import {
  ACCENT_PRESET_HEX,
  BLACK_HEX,
  DEFAULT_THEME_COLOR_SCHEME_HEX,
  SETTINGS_ACCENT_HEX,
  THEME_PALETTE_PRESET_HEX,
} from './colorTokens';
import { LEGACY_THEME_CSS_ALIASES, buildThemeCssVariables } from './themeCssVars';
import { deriveThemeTokens, type ThemeSeed, type ThemeTokenOverrides, type ThemeTokens } from './themeEngine';
import { createThemeFirstFrame, writeThemeFirstFrame } from './themeFirstFrame';
import { publishThemeTokens } from './themeTokenStore';

export type UiRadiusPreset = 'compact' | 'default' | 'large';
/** v1 色调：从未生效（内联变量总会盖掉它），迁移时忽略；字段保留到 1.4 外观设置改造。 */
export type ThemeTonePreset = 'neutral' | 'warm' | 'cool';

export type ThemeColorToken =
  | 'bg'
  | 'surface'
  | 'border'
  | 'text'
  | 'textMuted'
  | 'app'
  | 'canvas'
  | 'panel'
  | 'layer';

export type ThemeColorScheme = Record<ThemeColorToken, string>;

export interface RuntimeThemeConfig {
  seed: ThemeSeed;
  overrides?: ThemeTokenOverrides;
  uiRadiusPreset: UiRadiusPreset;
  /**
   * 界面毛玻璃。刻意不进主题 payload——它是观感/性能偏好，
   * 不属于可导出分享的配色方案。这里只负责把它同步到 documentElement。
   */
  uiBlurEnabled: boolean;
}

/** v1 导出格式（外观设置界面 1.4 改造前仍使用；导入经 settingsStore 旧设置写入换算为种子）。 */
export interface RuntimeThemePayload {
  version: 1;
  themeTonePreset: ThemeTonePreset;
  uiRadiusPreset: UiRadiusPreset;
  accentColor: string;
  colors: ThemeColorScheme;
}

export type ThemeImportMode = 'all' | 'colorsOnly' | 'toneRadiusOnly';

const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;

export const THEME_COLOR_TOKENS: ThemeColorToken[] = [
  'bg',
  'surface',
  'border',
  'text',
  'textMuted',
  'app',
  'canvas',
  'panel',
  'layer',
];

export const DEFAULT_THEME_COLOR_SCHEME: ThemeColorScheme = { ...DEFAULT_THEME_COLOR_SCHEME_HEX };

export const ACCENT_PRESET_OPTIONS: string[] = [...ACCENT_PRESET_HEX];

export interface ThemePalettePreset {
  id: string;
  name: { zh: string; en: string };
  colors: ThemeColorScheme;
}

export const THEME_PALETTE_PRESETS: ThemePalettePreset[] = THEME_PALETTE_PRESET_HEX.map((preset) => ({
  id: preset.id,
  name: preset.name,
  colors: normalizeThemeColorScheme(preset.colors),
}));

function dedupeHexColors(colors: string[]): string[] {
  const unique: string[] = [];
  for (const color of colors) {
    const normalized = normalizeHexColor(color, BLACK_HEX);
    if (!unique.includes(normalized)) {
      unique.push(normalized);
    }
  }
  return unique;
}

export function getTokenColorOptions(token: ThemeColorToken): string[] {
  const presetColors = THEME_PALETTE_PRESETS.map((preset) => preset.colors[token]);
  return dedupeHexColors([DEFAULT_THEME_COLOR_SCHEME[token], ...presetColors]).slice(0, 8);
}

function normalizeHexColor(input: string, fallback: string): string {
  const trimmed = input.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return fallback.toUpperCase();
  }
  return (trimmed.startsWith('#') ? trimmed : `#${trimmed}`).toUpperCase();
}

function isThemeTonePreset(value: DynamicValue): value is ThemeTonePreset {
  return value === 'neutral' || value === 'warm' || value === 'cool';
}

function isUiRadiusPreset(value: DynamicValue): value is UiRadiusPreset {
  return value === 'compact' || value === 'default' || value === 'large';
}

export function normalizeThemeColorScheme(input?: Partial<ThemeColorScheme>): ThemeColorScheme {
  return THEME_COLOR_TOKENS.reduce<ThemeColorScheme>((acc, token) => {
    const fallback = DEFAULT_THEME_COLOR_SCHEME[token];
    acc[token] = normalizeHexColor(input?.[token] ?? fallback, fallback);
    return acc;
  }, { ...DEFAULT_THEME_COLOR_SCHEME });
}

/** 导出的是可分享的配色方案，不含 uiBlurEnabled 这类本机观感偏好 */
export function createRuntimeThemePayload(
  config: Omit<RuntimeThemePayload, 'version'>
): RuntimeThemePayload {
  return {
    version: 1,
    themeTonePreset: config.themeTonePreset,
    uiRadiusPreset: config.uiRadiusPreset,
    accentColor: normalizeHexColor(config.accentColor, SETTINGS_ACCENT_HEX),
    colors: normalizeThemeColorScheme(config.colors),
  };
}

export function parseRuntimeThemePayload(input: DynamicValue): RuntimeThemePayload | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const payload = input as Partial<RuntimeThemePayload>;
  if (payload.version !== 1) {
    return null;
  }
  if (!isThemeTonePreset(payload.themeTonePreset)) {
    return null;
  }
  if (!isUiRadiusPreset(payload.uiRadiusPreset)) {
    return null;
  }

  return {
    version: 1,
    themeTonePreset: payload.themeTonePreset,
    uiRadiusPreset: payload.uiRadiusPreset,
    accentColor: normalizeHexColor(String(payload.accentColor ?? ''), SETTINGS_ACCENT_HEX),
    colors: normalizeThemeColorScheme(payload.colors),
  };
}

/**
 * 应用主题到根节点并发布令牌。
 * 只写新变量；旧变量名若残留在内联样式里（旧版本运行时写过）会遮住 index.css 的静态别名，因此逐个清掉。
 */
export function applyRuntimeTheme(config: RuntimeThemeConfig, root: HTMLElement = document.documentElement): ThemeTokens {
  const tokens = deriveThemeTokens(config.seed, config.overrides);
  const vars = buildThemeCssVariables(tokens);

  for (const alias of LEGACY_THEME_CSS_ALIASES) {
    root.style.removeProperty(alias.legacy);
  }
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  root.style.colorScheme = tokens.colorScheme;
  delete root.dataset.themeTone;

  if (config.uiRadiusPreset === 'default') {
    delete root.dataset.uiRadius;
  } else {
    root.dataset.uiRadius = config.uiRadiusPreset;
  }
  if (config.uiBlurEnabled) {
    delete root.dataset.uiBlur;
  } else {
    root.dataset.uiBlur = 'off';
  }

  writeThemeFirstFrame(
    createThemeFirstFrame(tokens, vars, { uiRadiusPreset: config.uiRadiusPreset, uiBlurEnabled: config.uiBlurEnabled })
  );
  publishThemeTokens(tokens);
  return tokens;
}
