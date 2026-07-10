import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setLogCaptureMode as syncLogCaptureMode, type LogCaptureMode } from '@/commands/logging';
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
  /** 图片查看器是否显示图片信息面板 */
  enableImageViewerInfoPanel: boolean;
  /** 图片信息面板折叠状态（Tab 键切换） */
  imageViewerInfoPanelCollapsed: boolean;
  storyboardGenKeepStyleConsistent: boolean;
  storyboardGenDisableTextInImage: boolean;
  /** 分镜格子描述为空时，自动在 prompt 中补一句"依据之前的内容进行推测" */
  storyboardGenAutoInferEmptyFrame: boolean;
  ignoreAtTagWhenCopyingAndGenerating: boolean;
  /**
   * 日志捕获模式：standard 沿用截断策略节省体积；full 长文本/图片 base64 不截断。
   * 不持久化——应用重启回落 standard，避免用户忘记关闭导致日志膨胀（见 `partialize`）。
   */
  logCaptureMode: LogCaptureMode;
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
  setEnableImageViewerInfoPanel: (enabled: boolean) => void;
  setImageViewerInfoPanelCollapsed: (collapsed: boolean) => void;
  setStoryboardGenKeepStyleConsistent: (enabled: boolean) => void;
  setStoryboardGenDisableTextInImage: (enabled: boolean) => void;
  setStoryboardGenAutoInferEmptyFrame: (enabled: boolean) => void;
  setIgnoreAtTagWhenCopyingAndGenerating: (enabled: boolean) => void;
  setLogCaptureMode: (mode: LogCaptureMode) => void;
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

function normalizeProviderKeyStatus(input: DynamicValue): ProviderKeyStatusMap {
  const defaults = createDefaultProviderKeyStatus();
  if (!input || typeof input !== 'object') {
    return defaults;
  }

  const entries = Object.entries(input as DynamicValueMap);
  entries.forEach(([providerId, configured]) => {
    if (!providerId.trim()) return;
    defaults[providerId] = configured === true;
  });

  return defaults;
}

function normalizeUploadProvider(input: DynamicValue): UploadProvider {
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
      enableImageViewerInfoPanel: true,
      imageViewerInfoPanelCollapsed: true,
      storyboardGenKeepStyleConsistent: true,
      storyboardGenDisableTextInImage: true,
      storyboardGenAutoInferEmptyFrame: true,
      ignoreAtTagWhenCopyingAndGenerating: true,
      logCaptureMode: 'standard',
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
      setEnableImageViewerInfoPanel: (enabled) => set({ enableImageViewerInfoPanel: enabled }),
      setImageViewerInfoPanelCollapsed: (collapsed) =>
        set({ imageViewerInfoPanelCollapsed: collapsed }),
      setStoryboardGenKeepStyleConsistent: (enabled) =>
        set({ storyboardGenKeepStyleConsistent: enabled }),
      setStoryboardGenDisableTextInImage: (enabled) =>
        set({ storyboardGenDisableTextInImage: enabled }),
      setStoryboardGenAutoInferEmptyFrame: (enabled) =>
        set({ storyboardGenAutoInferEmptyFrame: enabled }),
      setIgnoreAtTagWhenCopyingAndGenerating: (enabled) =>
        set({ ignoreAtTagWhenCopyingAndGenerating: enabled }),
      setLogCaptureMode: (mode) => {
        set({ logCaptureMode: mode });
        void syncLogCaptureMode(mode).catch(() => undefined);
      },
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
      // `logCaptureMode` 有意不持久化：应用重启应回落 standard，避免用户忘记关闭
      // "完整捕获" 导致日志长期膨胀（决策见 docs/task/日志调试中心/decisions.md）。
      partialize: (state) => {
        const { logCaptureMode: _logCaptureMode, ...persisted } = state;
        return persisted;
      },
      migrate: (persistedState: DynamicValue) => {
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
