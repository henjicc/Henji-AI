import {
  DEFAULT_THEME_COLOR_SCHEME,
  THEME_COLOR_TOKENS,
  type ThemeColorToken,
} from '@/core/theme/runtimeTheme'
import { SETTINGS_ACCENT_HEX } from '@/core/theme/colorTokens'
import { DEFAULT_UI_SCALE_MODE, UI_SCALE_MODES } from '@/core/theme/uiScale'
import {
  COLLAPSE_SETTING_CHANGED_EVENT,
  COLLAPSE_SETTING_SPECS,
} from '@/hooks/useLocalStorageSetting'
import { useSettingsStore } from '@/stores/settingsStore'
import { z } from 'zod'

import { hexSettingSchema, storageSetting, storeSetting } from './definitionFactories'
import type { ApplicationSettingDefinition } from './types'

function themeColorDefinition(token: ThemeColorToken): ApplicationSettingDefinition {
  return storeSetting({
    id: `interface.theme_color_${token.toLowerCase()}`,
    title: `主题颜色 ${token}`,
    description: '设置界面主题中的一个语义颜色。',
    aliases: ['主题颜色', token],
    schema: hexSettingSchema,
    defaultValue: DEFAULT_THEME_COLOR_SCHEME[token],
    target: { tab: 'interface', sectionId: 'interface-theme' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, () => useSettingsStore.getState().themeColors[token],
  (value) => useSettingsStore.getState().setThemeColor(token, value))
}

export const INTERFACE_APPLICATION_SETTING_DEFINITIONS: ApplicationSettingDefinition[] = [
  storeSetting({
    id: 'interface.scale', title: '界面缩放', description: '调整整个应用界面的显示大小，自动模式会根据窗口可用空间选择合适比例。',
    aliases: ['界面大小', '显示缩放', 'UI 缩放', 'scale', 'zoom'], schema: z.enum(UI_SCALE_MODES), defaultValue: DEFAULT_UI_SCALE_MODE,
    target: { tab: 'interface', sectionId: 'interface-layout' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().uiScaleMode,
  (value) => useSettingsStore.getState().setUiScaleMode(value)),
  storeSetting({
    id: 'interface.blur_enabled', title: '毛玻璃效果', description: '控制图片、视频和画布上浮层的毛玻璃材质。',
    aliases: ['毛玻璃', '模糊', '玻璃效果', 'blur', 'glass'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-theme' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().uiBlurEnabled,
  (value) => useSettingsStore.getState().setUiBlurEnabled(value)),
  storeSetting({
    id: 'interface.radius', title: '界面圆角', description: '设置全局界面圆角的紧凑、默认或宽松档位。',
    aliases: ['圆角', '紧凑', 'radius'], schema: z.enum(['compact', 'default', 'large']), defaultValue: 'default',
    target: { tab: 'interface', sectionId: 'interface-theme' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().uiRadiusPreset,
  (value) => useSettingsStore.getState().setUiRadiusPreset(value)),
  storeSetting({
    id: 'interface.theme_tone', title: '主题色调', description: '设置界面的中性、暖色或冷色色调。',
    aliases: ['主题', '色调', '暖色', '冷色', 'theme'], schema: z.enum(['neutral', 'warm', 'cool']), defaultValue: 'neutral',
    target: { tab: 'interface', sectionId: 'interface-theme' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().themeTonePreset,
  (value) => useSettingsStore.getState().setThemeTonePreset(value)),
  storeSetting({
    id: 'interface.accent_color', title: '界面强调色', description: '设置按钮和选中状态使用的强调色。',
    aliases: ['强调色', '主题蓝色', 'accent'], schema: hexSettingSchema, defaultValue: SETTINGS_ACCENT_HEX,
    target: { tab: 'interface', sectionId: 'interface-theme' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().accentColor,
  (value) => useSettingsStore.getState().setAccentColor(value)),
  storageSetting({
    id: 'interface.bottom_panel_auto_collapse', title: '底部面板自动收起', description: '闲置后自动收起生成页底部操作区。',
    aliases: ['底部面板', '自动收起'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-layout' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, COLLAPSE_SETTING_SPECS.enableAutoCollapse.key,
  COLLAPSE_SETTING_SPECS.enableAutoCollapse.parse, COLLAPSE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'interface.bottom_panel_collapse_delay', title: '底部面板收起延迟', description: '设置底部操作区自动收起前的等待时间。',
    aliases: ['收起延迟', '底部面板延迟'], schema: z.number().int().min(0).max(10_000), defaultValue: 500,
    target: { tab: 'interface', sectionId: 'interface-layout' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, COLLAPSE_SETTING_SPECS.collapseDelay.key,
  COLLAPSE_SETTING_SPECS.collapseDelay.parse, COLLAPSE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'interface.bottom_panel_scroll_only', title: '仅滚动时收起底部面板', description: '只在用户滚动内容时自动收起底部操作区。',
    aliases: ['滚动收起', '底部面板'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-layout' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, COLLAPSE_SETTING_SPECS.collapseOnScrollOnly.key,
  COLLAPSE_SETTING_SPECS.collapseOnScrollOnly.parse, COLLAPSE_SETTING_CHANGED_EVENT),
  storeSetting({
    id: 'canvas.detail_level', title: '画布细节等级', description: '控制缩小画布时的内容简化程度。',
    aliases: ['画布性能', '画布细节', 'LOD', '简化'], schema: z.enum(['off', 'detail', 'balanced', 'performance']), defaultValue: 'balanced',
    target: { tab: 'interface', sectionId: 'interface-canvas' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().canvasLodLevel,
  (value) => useSettingsStore.getState().setCanvasLodLevel(value)),
  storeSetting({
    id: 'canvas.auto_insert_text_display', title: '自动插入文本展示', description: '连接文本处理节点到生成节点时，自动通过一个可编辑的文本展示节点中转。',
    aliases: ['文本展示中转', '文本处理连线', '自动预览文本'], schema: z.boolean(), defaultValue: false,
    target: { tab: 'interface', sectionId: 'interface-canvas' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().autoInsertTextDisplayNode,
  (value) => useSettingsStore.getState().setAutoInsertTextDisplayNode(value)),
  storeSetting({
    id: 'canvas.upload_filename_as_title', title: '使用上传文件名作为节点标题', description: '上传素材后使用文件名帮助识别画布节点。',
    aliases: ['文件名节点标题', '上传标题'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-canvas' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().useUploadFilenameAsNodeTitle,
  (value) => useSettingsStore.getState().setUseUploadFilenameAsNodeTitle(value)),
  storeSetting({
    id: 'storyboard.keep_style_consistent', title: '分镜保持风格一致', description: '生成连续分镜时尽量保持视觉风格一致。',
    aliases: ['分镜风格一致', '保持风格'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-canvas' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().storyboardGenKeepStyleConsistent,
  (value) => useSettingsStore.getState().setStoryboardGenKeepStyleConsistent(value)),
  storeSetting({
    id: 'storyboard.disable_text_in_image', title: '分镜图片避免文字', description: '生成分镜图片时尽量避免画面内文字。',
    aliases: ['分镜不要文字', '画面文字'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-canvas' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().storyboardGenDisableTextInImage,
  (value) => useSettingsStore.getState().setStoryboardGenDisableTextInImage(value)),
  storeSetting({
    id: 'storyboard.auto_infer_empty_frame', title: '自动补充分镜空描述', description: '分镜描述为空时根据已有内容进行合理补充。',
    aliases: ['空分镜自动推测', '自动补充描述'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-canvas' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().storyboardGenAutoInferEmptyFrame,
  (value) => useSettingsStore.getState().setStoryboardGenAutoInferEmptyFrame(value)),
  storeSetting({
    id: 'assets.open_mode', title: '素材库打开方式', description: '设置素材库按钮打开浮层还是完整工作区。',
    aliases: ['素材库入口', '素材库浮层', 'asset'], schema: z.enum(['floating', 'workspace']), defaultValue: 'floating',
    target: { tab: 'interface', sectionId: 'interface-assets' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().assetTabAction,
  (value) => useSettingsStore.getState().setAssetTabAction(value)),
  storeSetting({
    id: 'assets.panel_position', title: '素材面板位置', description: '设置素材浮层显示在顶部、左侧或右侧。',
    aliases: ['素材位置', '面板位置', '左侧', '右侧'], schema: z.enum(['top', 'left', 'right']), defaultValue: 'top',
    target: { tab: 'interface', sectionId: 'interface-assets' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().assetPanelPosition,
  (value) => useSettingsStore.getState().setAssetPanelPosition(value)),
  storeSetting({
    id: 'assets.edge_trigger', title: '素材库边缘触发', description: '控制鼠标靠近屏幕边缘时是否打开素材库。',
    aliases: ['边缘触发', '鼠标靠边', 'edge trigger'], schema: z.boolean(), defaultValue: false,
    target: { tab: 'interface', sectionId: 'interface-assets' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().assetEdgeTriggerEnabled,
  (value) => useSettingsStore.getState().setAssetEdgeTriggerEnabled(value)),
  storeSetting({
    id: 'assets.thumbnail_fit', title: '素材缩略图适应方式', description: '设置素材缩略图填充裁切或完整显示。',
    aliases: ['缩略图', '裁切', '完整显示', 'thumbnail'], schema: z.enum(['cover', 'contain']), defaultValue: 'cover',
    target: { tab: 'interface', sectionId: 'interface-assets' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().assetThumbnailFit,
  (value) => useSettingsStore.getState().setAssetThumbnailFit(value)),
  storeSetting({
    id: 'assets.trigger_edge', title: '素材库触发边缘', description: '选择从窗口左侧或右侧触发素材库。',
    aliases: ['素材库左侧', '素材库右侧', '触发边缘'], schema: z.enum(['left', 'right']), defaultValue: 'right',
    target: { tab: 'interface', sectionId: 'interface-assets' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().assetTriggerEdge,
  (value) => useSettingsStore.getState().setAssetTriggerEdge(value)),
  storeSetting({
    id: 'assets.edge_delay_ms', title: '素材库边缘触发延迟', description: '设置鼠标停在窗口边缘多久后打开素材库。',
    aliases: ['素材库延迟', '边缘延迟'], schema: z.number().int().min(100).max(2_000), defaultValue: 650,
    target: { tab: 'interface', sectionId: 'interface-assets' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().assetEdgeDelayMs,
  (value) => useSettingsStore.getState().setAssetEdgeDelayMs(value)),
  storeSetting({
    id: 'assets.card_size', title: '素材卡片尺寸', description: '设置素材库卡片的显示大小。',
    aliases: ['素材大小', '卡片尺寸'], schema: z.number().int().min(112).max(280), defaultValue: 180,
    target: { tab: 'interface', sectionId: 'interface-assets' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().assetCardSize,
  (value) => useSettingsStore.getState().setAssetCardSize(value)),
  ...THEME_COLOR_TOKENS.map(themeColorDefinition),
]
