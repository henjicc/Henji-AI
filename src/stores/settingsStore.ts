import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  LEGACY_DEFAULT_THEME_COLOR_SCHEME_HEX,
  LEGACY_THEME_PALETTE_PRESET_HEX,
  SETTINGS_ACCENT_HEX,
  THEME_PALETTE_PRESET_HEX,
} from '@/core/theme/colorTokens';
import {
  DEFAULT_THEME_COLOR_SCHEME,
  normalizeThemeColorScheme,
  type ThemeColorScheme,
  type ThemeColorToken,
  type ThemeTonePreset,
  type UiRadiusPreset,
} from '@/core/theme/runtimeTheme';

export type ProviderApiKeys = Record<string, string>;
const KNOWN_PROVIDER_IDS = ['ppio', 'fal', 'kie', 'modelscope'] as const;

interface SettingsState {
  apiKeys: ProviderApiKeys;
  downloadPresetPaths: string[];
  useUploadFilenameAsNodeTitle: boolean;
  storyboardGenKeepStyleConsistent: boolean;
  storyboardGenDisableTextInImage: boolean;
  ignoreAtTagWhenCopyingAndGenerating: boolean;
  uiRadiusPreset: UiRadiusPreset;
  themeTonePreset: ThemeTonePreset;
  accentColor: string;
  themeColors: ThemeColorScheme;
  setProviderApiKey: (providerId: string, key: string) => void;
  setDownloadPresetPaths: (paths: string[]) => void;
  setUseUploadFilenameAsNodeTitle: (enabled: boolean) => void;
  setStoryboardGenKeepStyleConsistent: (enabled: boolean) => void;
  setStoryboardGenDisableTextInImage: (enabled: boolean) => void;
  setIgnoreAtTagWhenCopyingAndGenerating: (enabled: boolean) => void;
  setUiRadiusPreset: (preset: UiRadiusPreset) => void;
  setThemeTonePreset: (preset: ThemeTonePreset) => void;
  setAccentColor: (color: string) => void;
  setThemeColor: (token: ThemeColorToken, color: string) => void;
  setThemeColors: (colors: Partial<ThemeColorScheme>) => void;
  resetThemeColors: () => void;
}

const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;
const LEGACY_DEFAULT_THEME_COLOR_SCHEME: ThemeColorScheme = {
  ...LEGACY_DEFAULT_THEME_COLOR_SCHEME_HEX,
};

function normalizeHexColor(input: string): string {
  const trimmed = input.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return SETTINGS_ACCENT_HEX;
  }
  return trimmed.startsWith('#') ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
}

function normalizeApiKey(input: string): string {
  return input.trim();
}

function normalizeApiKeys(input: ProviderApiKeys | null | undefined): ProviderApiKeys {
  if (!input) {
    return {};
  }

  return Object.entries(input).reduce<ProviderApiKeys>((acc, [providerId, key]) => {
    const normalizedProviderId = providerId.trim();
    if (!normalizedProviderId) {
      return acc;
    }

    acc[normalizedProviderId] = normalizeApiKey(key);
    return acc;
  }, {});
}

function shouldUpgradeLegacyNeutralTheme(input?: Partial<ThemeColorScheme>): boolean {
  if (!input) {
    return false;
  }
  const normalized = normalizeThemeColorScheme(input);
  return Object.entries(LEGACY_DEFAULT_THEME_COLOR_SCHEME).every(([token, value]) => {
    return normalized[token as ThemeColorToken] === value;
  });
}

function mapLegacyPaletteTheme(input?: Partial<ThemeColorScheme>): ThemeColorScheme {
  const normalized = normalizeThemeColorScheme(input);
  for (const legacyPreset of LEGACY_THEME_PALETTE_PRESET_HEX) {
    const legacyColors = normalizeThemeColorScheme(legacyPreset.colors);
    const isMatch = Object.entries(legacyColors).every(([token, value]) => {
      return normalized[token as ThemeColorToken] === value;
    });

    if (!isMatch) {
      continue;
    }

    const nextPreset = THEME_PALETTE_PRESET_HEX.find((preset) => preset.id === legacyPreset.id);
    if (nextPreset) {
      return normalizeThemeColorScheme(nextPreset.colors);
    }
  }

  return normalized;
}

function readLegacyApiKeysFromLocalStorage(): ProviderApiKeys {
  return KNOWN_PROVIDER_IDS.reduce<ProviderApiKeys>((acc, providerId) => {
    const key = localStorage.getItem(`${providerId}_api_key`)?.trim() || '';
    if (key) {
      acc[providerId] = key;
    }
    return acc;
  }, {});
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiKeys: readLegacyApiKeysFromLocalStorage(),
      downloadPresetPaths: [],
      useUploadFilenameAsNodeTitle: true,
      storyboardGenKeepStyleConsistent: true,
      storyboardGenDisableTextInImage: true,
      ignoreAtTagWhenCopyingAndGenerating: true,
      uiRadiusPreset: 'default',
      themeTonePreset: 'neutral',
      accentColor: SETTINGS_ACCENT_HEX,
      themeColors: DEFAULT_THEME_COLOR_SCHEME,
      setProviderApiKey: (providerId, key) => {
        const normalizedKey = normalizeApiKey(key);
        localStorage.setItem(`${providerId}_api_key`, normalizedKey);
        set((state) => ({
          apiKeys: {
            ...state.apiKeys,
            [providerId]: normalizedKey,
          },
        }));
      },
      setDownloadPresetPaths: (paths) => {
        const uniquePaths = Array.from(
          new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0))
        ).slice(0, 8);
        set({ downloadPresetPaths: uniquePaths });
      },
      setUseUploadFilenameAsNodeTitle: (enabled) => set({ useUploadFilenameAsNodeTitle: enabled }),
      setStoryboardGenKeepStyleConsistent: (enabled) =>
        set({ storyboardGenKeepStyleConsistent: enabled }),
      setStoryboardGenDisableTextInImage: (enabled) =>
        set({ storyboardGenDisableTextInImage: enabled }),
      setIgnoreAtTagWhenCopyingAndGenerating: (enabled) =>
        set({ ignoreAtTagWhenCopyingAndGenerating: enabled }),
      setUiRadiusPreset: (uiRadiusPreset) => set({ uiRadiusPreset }),
      setThemeTonePreset: (themeTonePreset) => set({ themeTonePreset }),
      setAccentColor: (color) => set({ accentColor: normalizeHexColor(color) }),
      setThemeColor: (token, color) =>
        set((state) => ({
          themeColors: normalizeThemeColorScheme({
            ...state.themeColors,
            [token]: color,
          }),
        })),
      setThemeColors: (colors) =>
        set((state) => ({
          themeColors: normalizeThemeColorScheme({
            ...state.themeColors,
            ...colors,
          }),
        })),
      resetThemeColors: () => set({ themeColors: DEFAULT_THEME_COLOR_SCHEME }),
    }),
    {
      name: 'settings-storage',
      version: 6,
      migrate: (persistedState: unknown) => {
        const state = (persistedState ?? {}) as {
          apiKey?: string;
          apiKeys?: ProviderApiKeys;
          ignoreAtTagWhenCopyingAndGenerating?: boolean;
          themeColors?: Partial<ThemeColorScheme>;
        };
        const normalizedThemeColors = mapLegacyPaletteTheme(state.themeColors);
        const themeColors = shouldUpgradeLegacyNeutralTheme(state.themeColors)
          ? DEFAULT_THEME_COLOR_SCHEME
          : normalizedThemeColors;

        const migratedApiKeys = {
          ...readLegacyApiKeysFromLocalStorage(),
          ...normalizeApiKeys(state.apiKeys),
        };
        const ignoreAtTagWhenCopyingAndGenerating =
          state.ignoreAtTagWhenCopyingAndGenerating ?? true;
        if (Object.keys(migratedApiKeys).length > 0) {
          return {
            ...(persistedState as object),
            apiKeys: migratedApiKeys,
            ignoreAtTagWhenCopyingAndGenerating,
            themeColors,
          };
        }

        return {
          ...(persistedState as object),
          apiKeys: state.apiKey ? { ppio: normalizeApiKey(state.apiKey) } : {},
          ignoreAtTagWhenCopyingAndGenerating,
          themeColors,
        };
      },
    }
  )
);
