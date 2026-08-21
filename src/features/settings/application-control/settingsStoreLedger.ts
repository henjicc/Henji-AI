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
     * 此前这条被记成"没有调用方的死方法"——当时确实如此：字段只被 canvasDownloadService.ts
     * 读取，界面上没有任何配置入口，而画布下载菜单为空时却提示"请在设置 - 通用中添加"，
     * 等于让用户去做一件做不到的事。设置分区补上入口后（DownloadSection），人能做了，
     * 于是它变成一条真正的「人能做、助手不能做」。
     *
     * 归类为 user_only 而不是 gap：添加一条预设路径必须在系统目录选择器里选一个**真实存在**
     * 的目录，那个对话框由 OS 弹出、不在渲染进程里，助手没有办法代替用户点；凭空写一个路径
     * 字符串只会在下载菜单里造出一条点了就失败的项。
     *
     * 移除已有路径在技术上不需要选择器，助手是做得到的——但只能删不能加的半截能力比没有更让
     * 人困惑，而且用户要清理预设路径，在设置里直接点删除比让助手代劳更快。这是权衡后的取舍，
     * 不是安全顾虑；若将来有实际场景需要助手批量清理，再单独放开移除方向。
     */
    setDownloadPresetPaths: {
      kind: 'excluded',
      category: 'user_only',
      reason: '添加预设路径要在系统目录选择器里选一个真实存在的目录，该对话框由 OS 弹出、'
        + '不在渲染进程里，助手无法代劳；凭空写路径只会造出点了就失败的菜单项。'
        + '助手可用 open_application_surface 把用户带到 general-storage 分区自行配置。',
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
    setAutoInsertTextDisplayNode: property('canvas.auto_insert_text_display'),
    setLogCaptureMode: property('diagnostics.log_capture_mode'),
    setUiScaleMode: property('interface.scale'),
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
