import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UploadProvider } from '@/core/config/providers';
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

export type ProviderKeyStatusMap = Record<string, boolean>;
const KNOWN_PROVIDER_IDS = ['ppio', 'fal', 'kie', 'modelscope', 'bizyair'] as const;
const DEFAULT_UPLOAD_PROVIDER: UploadProvider = 'bizyair';

interface SettingsState {
  providerKeyStatus: ProviderKeyStatusMap;
  uploadProvider: UploadProvider;
  uploadFallbackEnabled: boolean;
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
  setProviderKeyStatus: (providerId: string, configured: boolean) => void;
  setProviderKeyStatuses: (status: ProviderKeyStatusMap) => void;
  setUploadProvider: (provider: UploadProvider) => void;
  setUploadFallbackEnabled: (enabled: boolean) => void;
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

function createDefaultProviderKeyStatus(): ProviderKeyStatusMap {
  return KNOWN_PROVIDER_IDS.reduce<ProviderKeyStatusMap>((acc, providerId) => {
    acc[providerId] = false;
    return acc;
  }, {});
}

function normalizeProviderKeyStatus(input: unknown): ProviderKeyStatusMap {
  const defaults = createDefaultProviderKeyStatus();
  if (!input || typeof input !== 'object') {
    return defaults;
  }

  const entries = Object.entries(input as Record<string, unknown>);
  entries.forEach(([providerId, configured]) => {
    if (!providerId.trim()) return;
    defaults[providerId] = configured === true;
  });

  return defaults;
}

function normalizeUploadProvider(input: unknown): UploadProvider {
  return input === 'fal' || input === 'kie' || input === 'bizyair'
    ? input
    : DEFAULT_UPLOAD_PROVIDER;
}

function resolveLegacyUploadProvider(): UploadProvider {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_UPLOAD_PROVIDER;
  }
  return normalizeUploadProvider(localStorage.getItem('general_upload_provider'));
}

function resolveLegacyUploadFallback(): boolean {
  if (typeof localStorage === 'undefined') {
    return true;
  }
  const saved = localStorage.getItem('general_upload_fallback');
  return saved !== 'false';
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      providerKeyStatus: createDefaultProviderKeyStatus(),
      uploadProvider: DEFAULT_UPLOAD_PROVIDER,
      uploadFallbackEnabled: true,
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
        set((state) => ({
          providerKeyStatus: {
            ...state.providerKeyStatus,
            [providerId]: normalizedKey.length > 0,
          },
        }));
      },
      setProviderKeyStatus: (providerId, configured) =>
        set((state) => ({
          providerKeyStatus: {
            ...state.providerKeyStatus,
            [providerId]: configured,
          },
        })),
      setProviderKeyStatuses: (status) =>
        set((state) => ({
          providerKeyStatus: {
            ...state.providerKeyStatus,
            ...status,
          },
        })),
      setUploadProvider: (uploadProvider) => set({ uploadProvider }),
      setUploadFallbackEnabled: (uploadFallbackEnabled) => set({ uploadFallbackEnabled }),
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
      version: 8,
      migrate: (persistedState: unknown) => {
        const state = (persistedState ?? {}) as {
          apiKey?: string;
          apiKeys?: Record<string, string>;
          providerKeyStatus?: ProviderKeyStatusMap;
          uploadProvider?: UploadProvider;
          uploadFallbackEnabled?: boolean;
          ignoreAtTagWhenCopyingAndGenerating?: boolean;
          themeColors?: Partial<ThemeColorScheme>;
        };
        const normalizedThemeColors = mapLegacyPaletteTheme(state.themeColors);
        const themeColors = shouldUpgradeLegacyNeutralTheme(state.themeColors)
          ? DEFAULT_THEME_COLOR_SCHEME
          : normalizedThemeColors;

        const migratedProviderStatus = normalizeProviderKeyStatus(state.providerKeyStatus);
        if (state.apiKeys && typeof state.apiKeys === 'object') {
          Object.entries(state.apiKeys).forEach(([providerId, key]) => {
            migratedProviderStatus[providerId] = normalizeApiKey(String(key)).length > 0;
          });
        }
        if (state.apiKey) {
          migratedProviderStatus.ppio = normalizeApiKey(state.apiKey).length > 0;
        }

        const ignoreAtTagWhenCopyingAndGenerating =
          state.ignoreAtTagWhenCopyingAndGenerating ?? true;
        const uploadProvider = normalizeUploadProvider(
          state.uploadProvider ?? resolveLegacyUploadProvider()
        );
        const uploadFallbackEnabled =
          state.uploadFallbackEnabled ?? resolveLegacyUploadFallback();
        return {
          ...(persistedState as object),
          providerKeyStatus: migratedProviderStatus,
          uploadProvider,
          uploadFallbackEnabled,
          ignoreAtTagWhenCopyingAndGenerating,
          themeColors,
        };
      },
    }
  )
);
