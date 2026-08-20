import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 下载预设路径的条数上限：菜单里超过这个数就要滚动，反而比「另存为」更慢 */
export const DOWNLOAD_PRESET_PATH_LIMIT = 8;

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
import type { StartupWorkspaceId } from '@/core/types/workspace';

export type ProviderKeyStatusMap = Record<string, boolean>;
/** 超过大文件阈值的本地媒体上传处理方式：每次询问 / 复制进数据目录 / 直接引用原文件 */
export type LargeUploadStrategy = 'ask' | 'copy' | 'reference';
/** 画布缩放简化（LOD）等级：off 不简化；detail 只在极小倍率简化；balanced 默认；performance 更早简化 */
export type CanvasLodLevel = 'off' | 'detail' | 'balanced' | 'performance';
export type AssetTabAction = 'floating' | 'workspace';
export type AssetPanelPosition = 'top' | 'left' | 'right';
export type AssetTriggerEdge = 'left' | 'right';
export type AssetThumbnailFit = 'cover' | 'contain';
const KNOWN_PROVIDER_IDS = ['ppio', 'fal', 'kie', 'apimart', 'bailian', 'volcengine', 'modelscope'] as const;
const DEFAULT_UPLOAD_PROVIDER: UploadProvider = 'kie';

interface SettingsState {
  providerKeyStatus: ProviderKeyStatusMap;
  uploadProvider: UploadProvider;
  uploadFallbackEnabled: boolean;
  /** 本地媒体超过 100MB 时的处理策略（阈值见 services/largeUploadPolicy.ts） */
  largeUploadStrategy: LargeUploadStrategy;
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
  /** 画布低倍率简化等级（阈值映射见 features/canvas/nodes/shared/useCanvasContentLod.ts） */
  canvasLodLevel: CanvasLodLevel;
  /** 文本处理连接生成节点时，是否自动插入共享文本展示节点。 */
  autoInsertTextDisplayNode: boolean;
  /**
   * 日志捕获模式：standard 沿用截断策略节省体积；full 长文本/图片 base64 不截断。
   * 不持久化——应用重启回落 standard，避免用户忘记关闭导致日志膨胀（见 `partialize`）。
   */
  logCaptureMode: LogCaptureMode;
  uiRadiusPreset: UiRadiusPreset;
  themeTonePreset: ThemeTonePreset;
  /** 界面毛玻璃效果。关闭后 `--ui-blur` 置 0，所有走该令牌的浮层一起变成不模糊 */
  uiBlurEnabled: boolean;
  accentColor: string;
  themeColors: ThemeColorScheme;
  /** 启动时默认停在哪个工作区。常用画布/工具箱的用户不必每次开机再切一次 */
  startupWorkspace: StartupWorkspaceId;
  assetTabAction: AssetTabAction;
  assetPanelPosition: AssetPanelPosition;
  assetEdgeTriggerEnabled: boolean;
  assetTriggerEdge: AssetTriggerEdge;
  assetEdgeDelayMs: number;
  assetDragEdgeDelayMs: number;
  assetCardSize: number;
  assetThumbnailFit: AssetThumbnailFit;
  setProviderApiKey: (providerId: string, key: string) => void;
  setProviderKeyStatus: (providerId: string, configured: boolean) => void;
  setProviderKeyStatuses: (status: ProviderKeyStatusMap) => void;
  setUploadProvider: (provider: UploadProvider) => void;
  setUploadFallbackEnabled: (enabled: boolean) => void;
  setLargeUploadStrategy: (strategy: LargeUploadStrategy) => void;
  /** 画布节点下载菜单的「保存到…」预设目录，上限 DOWNLOAD_PRESET_PATH_LIMIT 条 */
  setDownloadPresetPaths: (paths: string[]) => void;
  setUseUploadFilenameAsNodeTitle: (enabled: boolean) => void;
  setEnableImageViewerInfoPanel: (enabled: boolean) => void;
  setImageViewerInfoPanelCollapsed: (collapsed: boolean) => void;
  setStoryboardGenKeepStyleConsistent: (enabled: boolean) => void;
  setStoryboardGenDisableTextInImage: (enabled: boolean) => void;
  setStoryboardGenAutoInferEmptyFrame: (enabled: boolean) => void;
  setIgnoreAtTagWhenCopyingAndGenerating: (enabled: boolean) => void;
  setCanvasLodLevel: (level: CanvasLodLevel) => void;
  setAutoInsertTextDisplayNode: (enabled: boolean) => void;
  setLogCaptureMode: (mode: LogCaptureMode) => void;
  setUiRadiusPreset: (preset: UiRadiusPreset) => void;
  setThemeTonePreset: (preset: ThemeTonePreset) => void;
  setUiBlurEnabled: (enabled: boolean) => void;
  setAccentColor: (color: string) => void;
  setThemeColor: (token: ThemeColorToken, color: string) => void;
  setThemeColors: (colors: Partial<ThemeColorScheme>) => void;
  resetThemeColors: () => void;
  setStartupWorkspace: (workspace: StartupWorkspaceId) => void;
  setAssetTabAction: (action: AssetTabAction) => void;
  setAssetPanelPosition: (position: AssetPanelPosition) => void;
  setAssetEdgeTriggerEnabled: (enabled: boolean) => void;
  setAssetTriggerEdge: (edge: AssetTriggerEdge) => void;
  setAssetEdgeDelayMs: (delay: number) => void;
  setAssetCardSize: (size: number) => void;
  setAssetThumbnailFit: (fit: AssetThumbnailFit) => void;
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
  return input === 'fal' || input === 'kie'
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
      largeUploadStrategy: 'ask',
      downloadPresetPaths: [],
      useUploadFilenameAsNodeTitle: true,
      enableImageViewerInfoPanel: true,
      imageViewerInfoPanelCollapsed: true,
      storyboardGenKeepStyleConsistent: true,
      storyboardGenDisableTextInImage: true,
      storyboardGenAutoInferEmptyFrame: true,
      ignoreAtTagWhenCopyingAndGenerating: true,
      canvasLodLevel: 'balanced',
      autoInsertTextDisplayNode: false,
      logCaptureMode: 'standard',
      uiRadiusPreset: 'default',
      themeTonePreset: 'neutral',
      uiBlurEnabled: true,
      accentColor: SETTINGS_ACCENT_HEX,
      themeColors: DEFAULT_THEME_COLOR_SCHEME,
      startupWorkspace: 'generation',
      assetTabAction: 'floating',
      assetPanelPosition: 'top',
      assetEdgeTriggerEnabled: true,
      assetTriggerEdge: 'right',
      assetEdgeDelayMs: 650,
      assetDragEdgeDelayMs: 180,
      assetCardSize: 180,
      assetThumbnailFit: 'cover',
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
      setLargeUploadStrategy: (largeUploadStrategy) => set({ largeUploadStrategy }),
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
      setCanvasLodLevel: (canvasLodLevel) => set({ canvasLodLevel }),
      setAutoInsertTextDisplayNode: (autoInsertTextDisplayNode) => set({ autoInsertTextDisplayNode }),
      setLogCaptureMode: (mode) => {
        set({ logCaptureMode: mode });
        void syncLogCaptureMode(mode).catch(() => undefined);
      },
      setUiRadiusPreset: (uiRadiusPreset) => set({ uiRadiusPreset }),
      setThemeTonePreset: (themeTonePreset) => set({ themeTonePreset }),
      setUiBlurEnabled: (uiBlurEnabled) => set({ uiBlurEnabled }),
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
      setStartupWorkspace: (startupWorkspace) => set({ startupWorkspace }),
      setAssetTabAction: (assetTabAction) => set({ assetTabAction }),
      setAssetPanelPosition: (assetPanelPosition) => set({ assetPanelPosition }),
      setAssetEdgeTriggerEnabled: (assetEdgeTriggerEnabled) => set({ assetEdgeTriggerEnabled }),
      setAssetTriggerEdge: (assetTriggerEdge) => set({ assetTriggerEdge }),
      setAssetEdgeDelayMs: (assetEdgeDelayMs) => set({ assetEdgeDelayMs: Math.min(2000, Math.max(100, assetEdgeDelayMs)) }),
      setAssetCardSize: (assetCardSize) => set({ assetCardSize: Math.min(280, Math.max(112, assetCardSize)) }),
      setAssetThumbnailFit: (assetThumbnailFit) => set({ assetThumbnailFit }),
    }),
    {
      name: 'settings-storage',
      // v10：BizyAir 上传服务下线，旧值需重新归一化到 KIE
      version: 10,
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
