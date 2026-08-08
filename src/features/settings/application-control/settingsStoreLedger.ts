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

const PROTECTED_GAP_REASON = 'protected 设置对应的写入动作，尚未注册为反射属性（4.4 处理，'
  + '模型显示范围/软件更新会松绑，其余含密钥或系统路径的项目预期继续保持只读并改写理由）。'

export const SETTINGS_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'settingsStore',
  title: '设置',
  entries: {
    /*
     * setProviderApiKey 对应 security.provider_keys，是当前唯一一个在整个仓库里
     * 除自身定义外找不到任何调用方的 protected 相关动作——真正的密钥写入走
     * aiSetProviderApiKey 这个 IPC 命令，这个 store 方法本身是死代码。仍然登记为
     * gap 而不是 excluded：4.4 要统一审视全部 7 项 protected 设置，这一条留给它判断。
     */
    setProviderApiKey: { kind: 'gap', plannedPhase: '4.4', reason: PROTECTED_GAP_REASON },
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
     * setDownloadPresetPaths 对应 storage.download_paths，同样在整个仓库里没有任何
     * UI 调用方——用户目前无法通过界面配置下载预设路径，这个字段只被读取
     * （canvasDownloadService.ts）从未被写入。与 setProviderApiKey 同理，仍登记为
     * gap 交给 4.4 统一处理，而不是自行判定为死代码排除。
     */
    setDownloadPresetPaths: { kind: 'gap', plannedPhase: '4.4', reason: PROTECTED_GAP_REASON },
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
