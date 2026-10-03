import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { parseVideoEditShortcutOverrides, type VideoEditShortcutOverrides } from '@/core/videoEdit/commands';

/** 下载预设路径的条数上限：菜单里超过这个数就要滚动，反而比「另存为」更慢 */
export const DOWNLOAD_PRESET_PATH_LIMIT = 8;

import { setLogCaptureMode as syncLogCaptureMode, type LogCaptureMode } from '@/commands/logging';
import { API_KEY_PROVIDER_IDS, type UploadProvider } from '@/core/config/providers';
import type { UiRadiusPreset } from '@/core/theme/runtimeTheme';
import { normalizeHex } from '@/core/theme/themeColor';
import {
  normalizeThemeSeed,
  type ThemeContrastLevel,
  type ThemeSeed,
  type ThemeTokenOverrides,
} from '@/core/theme/themeEngine';
import {
  migrateV1ThemeSettings,
  normalizeThemeOverrides,
  type ThemePayloadV2,
  type ThemeV1ColorScheme,
} from '@/core/theme/themeMigration';
import {
  DEFAULT_THEME_SELECTION,
  THEME_CUSTOM_PRESET,
  normalizeThemeSelection,
  resolveThemeSelection,
  selectionFromThemeSeed,
  type ThemeSelection,
  type ThemeSelectionPreset,
} from '@/core/theme/themeSelection';
import type { StartupWorkspaceId } from '@/core/types/workspace';
import {
  DEFAULT_UI_SCALE_MODE,
  type UiScaleMode,
} from '@/core/theme/uiScale';

export type ProviderKeyStatusMap = Record<string, boolean>;
/** 超过大文件阈值的本地媒体上传处理方式：每次询问 / 复制进数据目录 / 直接引用原文件 */
export type LargeUploadStrategy = 'ask' | 'copy' | 'reference';
/** 画布缩放简化（LOD）等级：off 不简化；detail 只在极小倍率简化；balanced 默认；performance 更早简化 */
export type CanvasLodLevel = 'off' | 'detail' | 'balanced' | 'performance';
export type AssetTabAction = 'floating' | 'workspace';
export type AssetPanelPosition = 'top' | 'left' | 'right';
export type AssetTriggerEdge = 'left' | 'right';
export type AssetThumbnailFit = 'cover' | 'contain';
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
  /** 整个可见应用窗口的界面缩放；auto 按窗口逻辑尺寸在 90%/100% 间选择。 */
  uiScaleMode: UiScaleMode;
  uiRadiusPreset: UiRadiusPreset;
  /** 界面毛玻璃效果。关闭后 `--ui-blur` 置 0，所有走该令牌的浮层一起变成不模糊 */
  uiBlurEnabled: boolean;
  /** 外观选择（预设 / 强调色 / 层级对比度 / 自定义底色）：主题颜色的唯一可写来源。 */
  themeSelection: ThemeSelection;
  /** 由 `themeSelection` 派生的生效种子（`applyRuntimeTheme` 由它推导全部令牌）；只由主题动作同步写入。 */
  themeSeed: ThemeSeed;
  /** 由 `themeSelection` 派生的单令牌覆盖（仅自定义底色带覆盖）。 */
  themeOverrides: ThemeTokenOverrides;
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
  videoEditShortcuts: VideoEditShortcutOverrides;
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
  setUiScaleMode: (mode: UiScaleMode) => void;
  setUiRadiusPreset: (preset: UiRadiusPreset) => void;
  setUiBlurEnabled: (enabled: boolean) => void;
  /** 切换主题预设；`custom` 只在存在自定义底色时生效。保留当前强调色选择与对比度档位。 */
  setThemePreset: (preset: ThemeSelectionPreset) => void;
  /** 设置强调色 `#RRGGBB`；`null` 跟随预设。 */
  setThemeAccent: (accent: string | null) => void;
  setThemeContrast: (contrast: ThemeContrastLevel) => void;
  /** 应用导入的主题文件（v1 已由 `parseThemePayload` 迁移为 v2）。 */
  importThemePayload: (payload: ThemePayloadV2, mode: ThemeImportMode) => void;
  setStartupWorkspace: (workspace: StartupWorkspaceId) => void;
  setAssetTabAction: (action: AssetTabAction) => void;
  setAssetPanelPosition: (position: AssetPanelPosition) => void;
  setAssetEdgeTriggerEnabled: (enabled: boolean) => void;
  setAssetTriggerEdge: (edge: AssetTriggerEdge) => void;
  setAssetEdgeDelayMs: (delay: number) => void;
  setAssetCardSize: (size: number) => void;
  setAssetThumbnailFit: (fit: AssetThumbnailFit) => void;
  setVideoEditShortcuts: (shortcuts: VideoEditShortcutOverrides) => void;
}

/** 主题文件导入范围：全部 / 仅配色 / 仅圆角。 */
export type ThemeImportMode = 'all' | 'colorsOnly' | 'radiusOnly';

/** 选择 → 写入 store 的三项（选择本身与派生的种子、覆盖），保证三者始终一致。 */
function themeSelectionState(themeSelection: ThemeSelection): Pick<SettingsState, 'themeSelection' | 'themeSeed' | 'themeOverrides'> {
  const { seed, overrides } = resolveThemeSelection(themeSelection);
  return { themeSelection, themeSeed: seed, themeOverrides: overrides };
}

const DEFAULT_THEME_STATE = themeSelectionState(DEFAULT_THEME_SELECTION);

function normalizeApiKey(input: string): string {
  return input.trim();
}

function createDefaultProviderKeyStatus(): ProviderKeyStatusMap {
  return API_KEY_PROVIDER_IDS.reduce<ProviderKeyStatusMap>((acc, providerId) => {
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
      uiScaleMode: DEFAULT_UI_SCALE_MODE,
      uiRadiusPreset: 'default',
      uiBlurEnabled: true,
      ...DEFAULT_THEME_STATE,
      startupWorkspace: 'generation',
      assetTabAction: 'floating',
      assetPanelPosition: 'top',
      assetEdgeTriggerEnabled: false,
      assetTriggerEdge: 'right',
      assetEdgeDelayMs: 650,
      assetDragEdgeDelayMs: 180,
      assetCardSize: 180,
      assetThumbnailFit: 'cover',
      videoEditShortcuts: {},
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
      setUiScaleMode: (uiScaleMode) => set({ uiScaleMode }),
      setUiRadiusPreset: (uiRadiusPreset) => set({ uiRadiusPreset }),
      setUiBlurEnabled: (uiBlurEnabled) => set({ uiBlurEnabled }),
      setThemePreset: (preset) =>
        set((state) => {
          if (preset === THEME_CUSTOM_PRESET && !state.themeSelection.custom) return {};
          return themeSelectionState({ ...state.themeSelection, preset });
        }),
      setThemeAccent: (accent) =>
        set((state) => {
          const normalized = accent === null ? null : normalizeHex(accent);
          if (accent !== null && !normalized) return {};
          return themeSelectionState({ ...state.themeSelection, accent: normalized });
        }),
      setThemeContrast: (contrast) =>
        set((state) => themeSelectionState({ ...state.themeSelection, contrast })),
      importThemePayload: (payload, mode) =>
        set((state) => {
          const colors = mode === 'radiusOnly'
            ? {}
            : themeSelectionState(selectionFromThemeSeed(payload.seed, payload.overrides, state.themeSelection.custom));
          const radius = mode === 'colorsOnly' ? {} : { uiRadiusPreset: payload.uiRadiusPreset };
          return { ...colors, ...radius };
        }),
      setStartupWorkspace: (startupWorkspace) => set({ startupWorkspace }),
      setAssetTabAction: (assetTabAction) => set({ assetTabAction }),
      setAssetPanelPosition: (assetPanelPosition) => set({ assetPanelPosition }),
      setAssetEdgeTriggerEnabled: (assetEdgeTriggerEnabled) => set({ assetEdgeTriggerEnabled }),
      setAssetTriggerEdge: (assetTriggerEdge) => set({ assetTriggerEdge }),
      setAssetEdgeDelayMs: (assetEdgeDelayMs) => set({ assetEdgeDelayMs: Math.min(2000, Math.max(100, assetEdgeDelayMs)) }),
      setAssetCardSize: (assetCardSize) => set({ assetCardSize: Math.min(280, Math.max(112, assetCardSize)) }),
      setAssetThumbnailFit: (assetThumbnailFit) => set({ assetThumbnailFit }),
      setVideoEditShortcuts: (shortcuts) => set({ videoEditShortcuts: parseVideoEditShortcutOverrides(shortcuts) }),
    }),
    {
      name: 'settings-storage',
      // v11：边缘唤起改为显式选择，避免旧默认值让窗口边缘成为隐藏触发区
      // v12：主题改为种子推导；旧九色 + 强调色经 migrateV1ThemeSettings 换算（内置方案一律石墨）
      // v13：外观改为选择式（预设 / 强调色 / 对比度 / 自定义底色）；由已有种子反推选择，删除 v1 字段
      version: 13,
      // `logCaptureMode` 有意不持久化：应用重启应回落 standard，避免用户忘记关闭
      // "完整捕获" 导致日志长期膨胀。
      partialize: (state) => {
        const { logCaptureMode: _logCaptureMode, ...persisted } = state;
        return persisted;
      },
      migrate: (persistedState: DynamicValue, persistedVersion) => {
        const state = (persistedState ?? {}) as {
          apiKey?: string;
          apiKeys?: Record<string, string>;
          providerKeyStatus?: ProviderKeyStatusMap;
          uploadProvider?: UploadProvider;
          uploadFallbackEnabled?: boolean;
          ignoreAtTagWhenCopyingAndGenerating?: boolean;
          themeColors?: Partial<ThemeV1ColorScheme>;
          accentColor?: string;
          uiRadiusPreset?: string;
          themeSeed?: Partial<ThemeSeed>;
          themeOverrides?: unknown;
          themeSelection?: unknown;
          assetEdgeTriggerEnabled?: boolean;
          assetTriggerEdge?: AssetTriggerEdge;
          assetEdgeDelayMs?: number;
          assetDragEdgeDelayMs?: number;
        };
        // 主题：已有选择只规范化；否则由种子（v12）或 v1 九色 + 强调色（v11 及更早，内置方案一律石墨）反推
        const legacyThemePayload = state.themeSeed && typeof state.themeSeed === 'object'
          ? { seed: normalizeThemeSeed(state.themeSeed), overrides: normalizeThemeOverrides(state.themeOverrides) }
          : migrateV1ThemeSettings({ themeColors: state.themeColors, accentColor: state.accentColor, uiRadiusPreset: state.uiRadiusPreset });
        const themeState = themeSelectionState(
          normalizeThemeSelection(state.themeSelection)
          ?? selectionFromThemeSeed(legacyThemePayload.seed, legacyThemePayload.overrides)
        );
        // v1 外观字段（色调、强调色、九色）已由选择取代，不再保留在持久化状态里
        const {
          themeTonePreset: _themeTonePreset,
          accentColor: _accentColor,
          themeColors: _themeColors,
          ...rest
        } = (persistedState ?? {}) as Record<string, unknown>;

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
        const hasUntouchedLegacyEdgeTriggerDefaults =
          persistedVersion < 11
          && state.assetEdgeTriggerEnabled === true
          && (state.assetTriggerEdge === undefined || state.assetTriggerEdge === 'right')
          && (state.assetEdgeDelayMs === undefined || state.assetEdgeDelayMs === 650)
          && (state.assetDragEdgeDelayMs === undefined || state.assetDragEdgeDelayMs === 180);
        return {
          ...rest,
          providerKeyStatus: migratedProviderStatus,
          uploadProvider,
          uploadFallbackEnabled,
          ignoreAtTagWhenCopyingAndGenerating,
          ...themeState,
          assetEdgeTriggerEnabled: hasUntouchedLegacyEdgeTriggerDefaults
            ? false
            : (state.assetEdgeTriggerEnabled ?? false),
        };
      },
    }
  )
);
