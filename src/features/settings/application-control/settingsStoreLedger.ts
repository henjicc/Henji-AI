import type { ApplicationStoreActionBinding, ApplicationStoreActionLedger } from '@/core/application-control'

import type { useSettingsStore } from '@/stores/settingsStore'
import { THEME_COLOR_TOKENS } from '@/core/theme/runtimeTheme'

type State = ReturnType<typeof useSettingsStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

function property(...propertyIds: [string, ...string[]]): ApplicationStoreActionBinding {
  return { kind: 'property', propertyIds }
}

const THEME_COLOR_PROPERTY_IDS = THEME_COLOR_TOKENS.map(
  (token) => `interface.theme_color_${token.toLowerCase()}`,
) as [string, ...string[]]

export const SETTINGS_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'settingsStore',
  title: '设置',
  entries: {
    /*
     * 4.4 的判断结论：这一条不是 gap。
     *
     * gap 的定义是「人能做、助手不能做」，而这个 store 方法在整个仓库里没有任何调用方——
     * 界面上没有任何入口会触发它，人也一样做不了。真正的密钥写入走 aiRuntime 的
     * setProviderApiKey（IPC → keystore），根本不经过这个 store；它只维护
     * providerKeyStatus 这张"某供应商配没配密钥"的布尔表，而那张表由
     * services/providerKeyStatus.ts 在启动时批量同步（见下面的 syncProviderKeyStatus）。
     */
    setProviderApiKey: {
      kind: 'excluded',
      category: 'internal',
      reason: '整个仓库没有任何调用方，界面上不存在触发入口，人同样做不了，因此不构成人机差集。'
        + '它只写 providerKeyStatus 布尔表，而该表由 services/providerKeyStatus.ts 启动时批量同步；'
        + '真实密钥写入走 aiRuntime 的 IPC 通道进 keystore，不经过这个 store。',
    },
    setProviderKeyStatus: {
      kind: 'excluded',
      category: 'derived',
      reason: '由 aiSetProviderApiKey/aiRemoveProviderApiKey 真正写入密钥后同步的派生标志位；'
        + '密钥本身是凭据类操作，必须由用户在系统级密钥输入框完成，助手不能代为输入。',
    },
    setProviderKeyStatuses: {
      kind: 'excluded',
      category: 'internal',
      reason: '启动时批量同步各服务密钥配置状态（services/providerKeyStatus.ts），'
        + '不是独立可触发的用户动作。',
    },
    setUploadProvider: property('generation.upload_provider'),
    setUploadFallbackEnabled: property('generation.upload_fallback'),
    setLargeUploadStrategy: property('generation.large_upload_strategy'),
    /*
     * 4.4 的判断结论：同样不是 gap，同样是没有调用方的死方法。
     *
     * downloadPresetPaths 这个字段只被 canvasDownloadService.ts 读取，从未被写入——
     * 也就是说界面上现在根本没有配置下载预设路径的入口，人配不了，助手自然也谈不上差集。
     * 这是产品侧的一个待补功能，不是助手覆盖问题；等界面补上入口时，这条账要跟着改成
     * 对应的设置属性绑定（storage.download_paths 届时也要注册成正规设置定义）。
     */
    setDownloadPresetPaths: {
      kind: 'excluded',
      category: 'internal',
      reason: '整个仓库没有任何写入方，界面上不存在配置下载预设路径的入口，人同样做不了，'
        + '因此不构成人机差集；该字段目前只被 canvasDownloadService.ts 读取。'
        + '界面补上入口后需回来改成 storage.download_paths 的属性绑定。',
    },
    setUseUploadFilenameAsNodeTitle: property('canvas.upload_filename_as_title'),
    setEnableImageViewerInfoPanel: property('generation.viewer_info'),
    setImageViewerInfoPanelCollapsed: {
      kind: 'excluded',
      category: 'view_state',
      reason: '图片信息面板的展开/收起是查看时的显示状态（Tab 键切换）；面板是否存在已经由 '
        + 'generation.viewer_info 覆盖，这里只是面板内部的折叠开关，不进工程内容。',
    },
    setStoryboardGenKeepStyleConsistent: property('storyboard.keep_style_consistent'),
    setStoryboardGenDisableTextInImage: property('storyboard.disable_text_in_image'),
    setStoryboardGenAutoInferEmptyFrame: property('storyboard.auto_infer_empty_frame'),
    setIgnoreAtTagWhenCopyingAndGenerating: property('generation.ignore_at_tag_when_copying'),
    setCanvasLodLevel: property('canvas.detail_level'),
    setLogCaptureMode: property('diagnostics.log_capture_mode'),
    setUiRadiusPreset: property('interface.radius'),
    setThemeTonePreset: property('interface.theme_tone'),
    setUiBlurEnabled: property('interface.blur_enabled'),
    setAccentColor: property('interface.accent_color'),
    setThemeColor: { kind: 'property', propertyIds: THEME_COLOR_PROPERTY_IDS },
    setThemeColors: { kind: 'property', propertyIds: THEME_COLOR_PROPERTY_IDS },
    resetThemeColors: { kind: 'property', propertyIds: THEME_COLOR_PROPERTY_IDS },
    setStartupWorkspace: property('general.startup_workspace'),
    setAssetTabAction: property('assets.open_mode'),
    setAssetPanelPosition: property('assets.panel_position'),
    setAssetEdgeTriggerEnabled: property('assets.edge_trigger'),
    setAssetTriggerEdge: property('assets.trigger_edge'),
    setAssetEdgeDelayMs: property('assets.edge_delay_ms'),
    setAssetCardSize: property('assets.card_size'),
    setAssetThumbnailFit: property('assets.thumbnail_fit'),
  },
}
