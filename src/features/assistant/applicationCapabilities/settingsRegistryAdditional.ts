import { z } from 'zod'

import {
  PRICE_ESTIMATE_CURRENCY_MODE_STORAGE_KEY,
  PRICE_SETTING_CHANGED_EVENT,
  SHOW_PRICE_ESTIMATE_STORAGE_KEY,
  USD_TO_CNY_RATE_STORAGE_KEY,
} from '@/core/pricing/priceDisplay'
import {
  DEFAULT_THEME_COLOR_SCHEME,
  THEME_COLOR_TOKENS,
  type ThemeColorToken,
} from '@/core/theme/runtimeTheme'
import { SETTINGS_ACCENT_HEX } from '@/core/theme/colorTokens'
import { APPLICATION_SETTINGS_CHANGED_EVENT } from '@/core/settings/events'
import {
  readPromptOptimizationButtonBehavior,
  writePromptOptimizationButtonBehavior,
} from '@/core/llm/promptOptimizationBehavior'
import {
  COLLAPSE_SETTING_CHANGED_EVENT,
  COLLAPSE_SETTING_SPECS,
  QUICK_DOWNLOAD_SETTING_SPECS,
} from '@/hooks/useLocalStorageSetting'
import { changeLanguage, getCurrentLanguage } from '@/utils/language'
import { useSettingsStore } from '@/stores/settingsStore'
import type {
  ApplicationSettingDefinition,
  SettingValue,
} from './settingsRegistry'

const hexSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/)

function storeSetting<TValue extends SettingValue>(
  definition: Omit<ApplicationSettingDefinition, 'schema' | 'defaultValue' | 'read' | 'write'> & {
    schema: z.ZodType<TValue>
    defaultValue: TValue
  },
  read: () => TValue,
  write: (value: TValue) => void
): ApplicationSettingDefinition {
  return {
    ...definition,
    schema: definition.schema as z.ZodType<SettingValue>,
    read,
    write: (value) => write(definition.schema.parse(value)),
  }
}

function storageSetting<TValue extends SettingValue>(
  definition: Omit<ApplicationSettingDefinition, 'schema' | 'defaultValue' | 'read' | 'write'> & {
    schema: z.ZodType<TValue>
    defaultValue: TValue
  },
  key: string,
  parse: (raw: string | null) => TValue,
  eventName?: string
): ApplicationSettingDefinition {
  return {
    ...definition,
    schema: definition.schema as z.ZodType<SettingValue>,
    read: () => parse(localStorage.getItem(key)),
    write: (value) => {
      localStorage.setItem(key, String(definition.schema.parse(value)))
      window.dispatchEvent(new Event(APPLICATION_SETTINGS_CHANGED_EVENT))
      if (eventName) window.dispatchEvent(new Event(eventName))
    },
  }
}

const storeDefinitions: ApplicationSettingDefinition[] = [
  storeSetting({
    id: 'diagnostics.log_capture_mode',
    title: '日志捕获范围',
    description: '设置本次运行记录标准信息或完整诊断内容。',
    aliases: ['完整日志', '日志捕获', '诊断模式'],
    schema: z.enum(['standard', 'full']),
    defaultValue: 'standard',
    target: { tab: 'general', sectionId: 'general-maintenance' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, () => useSettingsStore.getState().logCaptureMode,
  (value) => useSettingsStore.getState().setLogCaptureMode(value)),
  storeSetting({
    id: 'canvas.upload_filename_as_title',
    title: '使用上传文件名作为节点标题',
    description: '上传素材后使用文件名帮助识别画布节点。',
    aliases: ['文件名节点标题', '上传标题'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-canvas' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, () => useSettingsStore.getState().useUploadFilenameAsNodeTitle,
  (value) => useSettingsStore.getState().setUseUploadFilenameAsNodeTitle(value)),
  storeSetting({
    id: 'storyboard.keep_style_consistent',
    title: '分镜保持风格一致',
    description: '生成连续分镜时尽量保持视觉风格一致。',
    aliases: ['分镜风格一致', '保持风格'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-canvas' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, () => useSettingsStore.getState().storyboardGenKeepStyleConsistent,
  (value) => useSettingsStore.getState().setStoryboardGenKeepStyleConsistent(value)),
  storeSetting({
    id: 'storyboard.disable_text_in_image',
    title: '分镜图片避免文字',
    description: '生成分镜图片时尽量避免画面内文字。',
    aliases: ['分镜不要文字', '画面文字'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-canvas' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, () => useSettingsStore.getState().storyboardGenDisableTextInImage,
  (value) => useSettingsStore.getState().setStoryboardGenDisableTextInImage(value)),
  storeSetting({
    id: 'storyboard.auto_infer_empty_frame',
    title: '自动补充分镜空描述',
    description: '分镜描述为空时根据已有内容进行合理补充。',
    aliases: ['空分镜自动推测', '自动补充描述'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-canvas' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, () => useSettingsStore.getState().storyboardGenAutoInferEmptyFrame,
  (value) => useSettingsStore.getState().setStoryboardGenAutoInferEmptyFrame(value)),
  storeSetting({
    id: 'generation.ignore_at_tag_when_copying',
    title: '复制生成时忽略引用标签',
    description: '复制提示词继续生成时不携带界面引用标签。',
    aliases: ['忽略引用标签', '@标签'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-canvas' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, () => useSettingsStore.getState().ignoreAtTagWhenCopyingAndGenerating,
  (value) => useSettingsStore.getState().setIgnoreAtTagWhenCopyingAndGenerating(value)),
  storeSetting({
    id: 'assets.trigger_edge',
    title: '素材库触发边缘',
    description: '选择从窗口左侧或右侧触发素材库。',
    aliases: ['素材库左侧', '素材库右侧', '触发边缘'],
    schema: z.enum(['left', 'right']),
    defaultValue: 'right',
    target: { tab: 'interface', sectionId: 'interface-assets' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, () => useSettingsStore.getState().assetTriggerEdge,
  (value) => useSettingsStore.getState().setAssetTriggerEdge(value)),
  storeSetting({
    id: 'assets.edge_delay_ms',
    title: '素材库边缘触发延迟',
    description: '设置鼠标停在窗口边缘多久后打开素材库。',
    aliases: ['素材库延迟', '边缘延迟'],
    schema: z.number().int().min(100).max(2_000),
    defaultValue: 650,
    target: { tab: 'interface', sectionId: 'interface-assets' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, () => useSettingsStore.getState().assetEdgeDelayMs,
  (value) => useSettingsStore.getState().setAssetEdgeDelayMs(value)),
  storeSetting({
    id: 'assets.card_size',
    title: '素材卡片尺寸',
    description: '设置素材库卡片的显示大小。',
    aliases: ['素材大小', '卡片尺寸'],
    schema: z.number().int().min(112).max(280),
    defaultValue: 180,
    target: { tab: 'interface', sectionId: 'interface-assets' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, () => useSettingsStore.getState().assetCardSize,
  (value) => useSettingsStore.getState().setAssetCardSize(value)),
  storeSetting({
    id: 'interface.accent_color',
    title: '界面强调色',
    description: '设置按钮和选中状态使用的强调色。',
    aliases: ['强调色', '主题蓝色', 'accent'],
    schema: hexSchema,
    defaultValue: SETTINGS_ACCENT_HEX,
    target: { tab: 'interface', sectionId: 'interface-theme' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, () => useSettingsStore.getState().accentColor,
  (value) => useSettingsStore.getState().setAccentColor(value)),
]

function themeColorDefinition(token: ThemeColorToken): ApplicationSettingDefinition {
  return storeSetting({
    id: `interface.theme_color_${token.toLowerCase()}`,
    title: `主题颜色 ${token}`,
    description: '设置界面主题中的一个语义颜色。',
    aliases: ['主题颜色', token],
    schema: hexSchema,
    defaultValue: DEFAULT_THEME_COLOR_SCHEME[token],
    target: { tab: 'interface', sectionId: 'interface-theme' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, () => useSettingsStore.getState().themeColors[token],
  (value) => useSettingsStore.getState().setThemeColor(token, value))
}

const localDefinitions: ApplicationSettingDefinition[] = [
  storeSetting({
    id: 'general.language',
    title: '界面语言',
    description: '设置界面语言或跟随系统。',
    aliases: ['语言', '中文', '英文'],
    schema: z.enum(['auto', 'zh-CN', 'en-US']),
    defaultValue: 'auto',
    target: { tab: 'general', sectionId: 'general-basic' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, getCurrentLanguage, changeLanguage),
  storageSetting({
    id: 'general.max_history_count',
    title: '历史记录保留数量',
    description: '设置生成历史最多保留多少条。',
    aliases: ['历史数量', '保留记录'],
    schema: z.number().int().min(1).max(1_000),
    defaultValue: 50,
    target: { tab: 'general', sectionId: 'general-basic' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, 'max_history_count', (raw) => Number.parseInt(raw ?? '50', 10)),
  storageSetting({
    id: 'generation.max_concurrent_tasks',
    title: '生成并发任务数',
    description: '设置可以同时执行的生成任务数量。',
    aliases: ['并发数', '同时生成'],
    schema: z.number().int().min(1).max(20),
    defaultValue: 2,
    target: { tab: 'general', sectionId: 'general-behavior' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, 'max_concurrent_tasks', (raw) => Number.parseInt(raw ?? '2', 10)),
  storageSetting({
    id: 'generation.auto_focus_model_search',
    title: '自动聚焦模型搜索',
    description: '打开模型选择器时自动定位到搜索输入。',
    aliases: ['模型搜索聚焦', '自动搜索'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'general', sectionId: 'general-behavior' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, 'enable_auto_focus_model_search', (raw) => raw !== 'false'),
  storageSetting({
    id: 'pricing.show_estimate',
    title: '显示费用预估',
    description: '在生成前显示预计费用。',
    aliases: ['价格预估', '费用'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'general', sectionId: 'general-behavior' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, SHOW_PRICE_ESTIMATE_STORAGE_KEY, (raw) => raw !== 'false', PRICE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'pricing.currency_mode',
    title: '费用显示币种',
    description: '设置费用按人民币、美元或自动方式显示。',
    aliases: ['币种', '人民币', '美元'],
    schema: z.enum(['auto', 'cny', 'usd']),
    defaultValue: 'auto',
    target: { tab: 'general', sectionId: 'general-behavior' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, PRICE_ESTIMATE_CURRENCY_MODE_STORAGE_KEY, (raw) => (
    raw === 'cny' || raw === 'usd' ? raw : 'auto'
  ), PRICE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'pricing.usd_to_cny_rate',
    title: '美元人民币换算率',
    description: '设置费用预估使用的美元人民币换算率。',
    aliases: ['汇率', '美元换算'],
    schema: z.number().positive().max(100),
    defaultValue: 6.77,
    target: { tab: 'general', sectionId: 'general-behavior' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, USD_TO_CNY_RATE_STORAGE_KEY, (raw) => Number(raw ?? 6.77), PRICE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'interface.bottom_panel_auto_collapse',
    title: '底部面板自动收起',
    description: '闲置后自动收起生成页底部操作区。',
    aliases: ['底部面板', '自动收起'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-layout' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, COLLAPSE_SETTING_SPECS.enableAutoCollapse.key,
  COLLAPSE_SETTING_SPECS.enableAutoCollapse.parse, COLLAPSE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'interface.bottom_panel_collapse_delay',
    title: '底部面板收起延迟',
    description: '设置底部操作区自动收起前的等待时间。',
    aliases: ['收起延迟', '底部面板延迟'],
    schema: z.number().int().min(0).max(10_000),
    defaultValue: 500,
    target: { tab: 'interface', sectionId: 'interface-layout' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, COLLAPSE_SETTING_SPECS.collapseDelay.key,
  COLLAPSE_SETTING_SPECS.collapseDelay.parse, COLLAPSE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'interface.bottom_panel_scroll_only',
    title: '仅滚动时收起底部面板',
    description: '只在用户滚动内容时自动收起底部操作区。',
    aliases: ['滚动收起', '底部面板'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-layout' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, COLLAPSE_SETTING_SPECS.collapseOnScrollOnly.key,
  COLLAPSE_SETTING_SPECS.collapseOnScrollOnly.parse, COLLAPSE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'downloads.quick_enabled',
    title: '快速下载',
    description: '启用生成结果快速下载。',
    aliases: ['快速下载', '一键下载'],
    schema: z.boolean(),
    defaultValue: false,
    target: { tab: 'general', sectionId: 'general-storage' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, QUICK_DOWNLOAD_SETTING_SPECS.enableQuickDownload.key,
  QUICK_DOWNLOAD_SETTING_SPECS.enableQuickDownload.parse),
  storageSetting({
    id: 'downloads.button_only',
    title: '仅显示快速下载按钮',
    description: '启用快速下载后只显示直接下载动作。',
    aliases: ['下载按钮', '快速下载'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'general', sectionId: 'general-storage' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, QUICK_DOWNLOAD_SETTING_SPECS.quickDownloadButtonOnly.key,
  QUICK_DOWNLOAD_SETTING_SPECS.quickDownloadButtonOnly.parse),
  storeSetting({
    id: 'generation.prompt_optimization_behavior',
    title: '提示词优化按钮行为',
    description: '设置优化按钮直接运行还是先选择优化方案。',
    aliases: ['提示词优化', '优化按钮'],
    schema: z.enum(['select-profile', 'direct-optimize']),
    defaultValue: 'select-profile',
    target: { tab: 'general', sectionId: 'general-behavior' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
  }, readPromptOptimizationButtonBehavior, writePromptOptimizationButtonBehavior),
]

export const ADDITIONAL_APPLICATION_SETTING_DEFINITIONS: ApplicationSettingDefinition[] = [
  ...storeDefinitions,
  ...THEME_COLOR_TOKENS.map(themeColorDefinition),
  ...localDefinitions,
]
