import { THEME_PRESET_IDS, type ThemeContrastLevel } from '@/core/theme/themeEngine'
import {
  THEME_CONTRAST_LEVEL_IDS,
  THEME_CUSTOM_PRESET,
  type ThemeSelectionPreset,
} from '@/core/theme/themeSelection'
import { DEFAULT_UI_SCALE_MODE, UI_SCALE_MODES } from '@/core/theme/uiScale'
import {
  COLLAPSE_SETTING_CHANGED_EVENT,
  COLLAPSE_SETTING_SPECS,
} from '@/hooks/useLocalStorageSetting'
import { useSettingsStore } from '@/stores/settingsStore'
import { videoEditShortcutOverridesSchema, type VideoEditShortcutOverrides } from '@/core/videoEdit/commands'
import { z } from 'zod'

import { hexSettingSchema, storageSetting, storeSetting } from './definitionFactories'
import type { ApplicationSettingDefinition } from './types'

/** 强调色：`preset` 跟随预设，或 `#RRGGBB`。 */
const THEME_ACCENT_FOLLOW_PRESET = 'preset'
const themeAccentSchema = z.union([z.literal(THEME_ACCENT_FOLLOW_PRESET), hexSettingSchema])
const themePresetSchema = z.enum([...THEME_PRESET_IDS, THEME_CUSTOM_PRESET] as unknown as [ThemeSelectionPreset, ...ThemeSelectionPreset[]])
const themeContrastSchema = z.enum(THEME_CONTRAST_LEVEL_IDS as [ThemeContrastLevel, ...ThemeContrastLevel[]])

function writeThemePreset(preset: ThemeSelectionPreset): void {
  const store = useSettingsStore.getState()
  if (preset === THEME_CUSTOM_PRESET && !store.themeSelection.custom) {
    throw new Error('当前没有自定义配色：自定义配色只来自旧版自定义颜色或导入的非预设主题文件，可选 graphite、ocean、film、paper。')
  }
  store.setThemePreset(preset)
}

export const INTERFACE_APPLICATION_SETTING_DEFINITIONS: ApplicationSettingDefinition[] = [
  storeSetting({
    id: 'video_edit.shortcuts', title: '剪辑快捷键', description: '设置剪辑命令的键位；同一面板作用域的冲突会被拒绝，空配置恢复默认。',
    aliases: ['剪辑快捷键', '改键', '时间线键位', 'shortcuts'], schema: videoEditShortcutOverridesSchema, defaultValue: {},
    target: { tab: 'interface', sectionId: 'interface-layout' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => videoEditShortcutOverridesSchema.parse(useSettingsStore.getState().videoEditShortcuts),
  (value) => useSettingsStore.getState().setVideoEditShortcuts(value as VideoEditShortcutOverrides)),
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
    id: 'interface.theme_preset', title: '主题预设',
    description: '切换界面配色预设：graphite 石墨（深色，默认）、ocean 深海（深色偏蓝）、film 胶片（深色偏暖）、paper 纸白（浅色）；'
      + 'custom 是用户从旧版自定义颜色或主题文件导入的配色，只有存在时才能切回。切换预设保留当前强调色选择与层级对比度。',
    aliases: ['主题', '配色', '深色', '浅色', '暗色', '亮色', '石墨', '深海', '胶片', '纸白', 'theme', 'dark mode', 'light mode'],
    schema: themePresetSchema, defaultValue: 'graphite',
    target: { tab: 'interface', sectionId: 'interface-theme' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().themeSelection.preset,
  writeThemePreset),
  storeSetting({
    id: 'interface.accent_color', title: '界面强调色',
    description: '设置主按钮、焦点与选中指示使用的强调色：preset 跟随当前预设，或填写 #RRGGBB。'
      + '实际显示的按钮颜色会按对比度自动微调，保证按钮文字清晰。',
    aliases: ['强调色', '主题色', '高亮色', 'accent'], schema: themeAccentSchema, defaultValue: THEME_ACCENT_FOLLOW_PRESET,
    target: { tab: 'interface', sectionId: 'interface-theme' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().themeSelection.accent ?? THEME_ACCENT_FOLLOW_PRESET,
  (value) => useSettingsStore.getState().setThemeAccent(value === THEME_ACCENT_FOLLOW_PRESET ? null : value)),
  storeSetting({
    id: 'interface.theme_contrast', title: '层级对比',
    description: '设置面板、输入框、悬停与选中之间的明暗差：soft 柔和、standard 标准、strong 更强。文字始终保持清晰可读。',
    aliases: ['层级对比', '对比度', '明暗差', 'contrast'], schema: themeContrastSchema, defaultValue: 'standard',
    target: { tab: 'interface', sectionId: 'interface-theme' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().themeSelection.contrast,
  (value) => useSettingsStore.getState().setThemeContrast(value)),
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
]
