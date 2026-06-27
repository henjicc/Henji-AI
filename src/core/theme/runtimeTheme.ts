export type UiRadiusPreset = 'compact' | 'default' | 'large';
export type ThemeTonePreset = 'neutral' | 'warm' | 'cool';
import {
  ACCENT_PRESET_HEX,
  BLACK_HEX,
  DEFAULT_THEME_COLOR_SCHEME_HEX,
  SETTINGS_ACCENT_HEX,
  THEME_PALETTE_PRESET_HEX,
  WHITE_HEX,
} from './colorTokens';

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
  themeTonePreset: ThemeTonePreset;
  uiRadiusPreset: UiRadiusPreset;
  accentColor: string;
  colors: ThemeColorScheme;
}

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

export const THEME_COLOR_VAR_MAP: Record<ThemeColorToken, string> = {
  bg: '--bg-rgb',
  surface: '--surface-rgb',
  border: '--border-rgb',
  text: '--text-rgb',
  textMuted: '--text-muted-rgb',
  app: '--app-rgb',
  canvas: '--canvas-rgb',
  panel: '--panel-rgb',
  layer: '--layer-rgb',
};

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

function hexToRgbTuple(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex, BLACK_HEX).slice(1);
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

function mixChannel(source: number, target: number, ratio: number): number {
  return Math.round(source + (target - source) * ratio);
}

function mixColor(sourceHex: string, targetHex: string, ratio: number): string {
  const [sr, sg, sb] = hexToRgbTuple(sourceHex);
  const [tr, tg, tb] = hexToRgbTuple(targetHex);
  const r = mixChannel(sr, tr, ratio);
  const g = mixChannel(sg, tg, ratio);
  const b = mixChannel(sb, tb, ratio);
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function toRgbVarValue(hex: string): string {
  const [r, g, b] = hexToRgbTuple(hex);
  return `${r} ${g} ${b}`;
}

function applyAccentScale(root: HTMLElement, accentHex: string): void {
  const accent = normalizeHexColor(accentHex, SETTINGS_ACCENT_HEX);
  const brand300 = mixColor(accent, WHITE_HEX, 0.3);
  const brand500 = mixColor(accent, BLACK_HEX, 0.15);
  const brand600 = mixColor(accent, BLACK_HEX, 0.32);
  const brand700 = mixColor(accent, BLACK_HEX, 0.45);

  root.style.setProperty('--accent-rgb', toRgbVarValue(accent));
  root.style.setProperty('--brand-300-rgb', toRgbVarValue(brand300));
  root.style.setProperty('--brand-500-rgb', toRgbVarValue(brand500));
  root.style.setProperty('--brand-600-rgb', toRgbVarValue(brand600));
  root.style.setProperty('--brand-700-rgb', toRgbVarValue(brand700));
}

export function normalizeThemeColorScheme(input?: Partial<ThemeColorScheme>): ThemeColorScheme {
  return THEME_COLOR_TOKENS.reduce<ThemeColorScheme>((acc, token) => {
    const fallback = DEFAULT_THEME_COLOR_SCHEME[token];
    acc[token] = normalizeHexColor(input?.[token] ?? fallback, fallback);
    return acc;
  }, { ...DEFAULT_THEME_COLOR_SCHEME });
}

export function createRuntimeThemePayload(config: RuntimeThemeConfig): RuntimeThemePayload {
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

export function applyRuntimeTheme(config: RuntimeThemeConfig): void {
  const root = document.documentElement;
  root.dataset.themeTone = config.themeTonePreset;
  if (config.uiRadiusPreset === 'default') {
    delete root.dataset.uiRadius;
  } else {
    root.dataset.uiRadius = config.uiRadiusPreset;
  }

  const normalizedColors = normalizeThemeColorScheme(config.colors);
  for (const token of THEME_COLOR_TOKENS) {
    const cssVarName = THEME_COLOR_VAR_MAP[token];
    root.style.setProperty(cssVarName, toRgbVarValue(normalizedColors[token]));
  }

  applyAccentScale(root, config.accentColor);
}
