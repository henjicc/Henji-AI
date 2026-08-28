import {
  PRICE_ESTIMATE_CURRENCY_MODE_STORAGE_KEY,
  PRICE_SETTING_CHANGED_EVENT,
  SHOW_PRICE_ESTIMATE_STORAGE_KEY,
  USD_TO_CNY_RATE_STORAGE_KEY,
} from '@/core/pricing/priceDisplay'
import {
  readPromptOptimizationButtonBehavior,
  writePromptOptimizationButtonBehavior,
} from '@/core/llm/promptOptimizationBehavior'
import { QUICK_DOWNLOAD_SETTING_SPECS } from '@/hooks/useLocalStorageSetting'
import { useSettingsStore } from '@/stores/settingsStore'
import { changeLanguage, getCurrentLanguage } from '@/utils/language'
import { getUpdateConfig, setUpdateEnabled, setUpdateFrequency } from '@/utils/updateConfig'
import { z } from 'zod'
import { GENERATION_MODEL_DESCRIPTIONS } from '@/core/modelCatalog/generationModelDescriptions'
import { modelDefaultsManager } from '@/features/settings/modelDefaultsManager'

import { storageSetting, storeSetting } from './definitionFactories'
import type { ApplicationSettingDefinition } from './types'

const DEFAULT_MODEL_ID_SCHEMA = z.enum([
  'auto',
  ...Object.keys(GENERATION_MODEL_DESCRIPTIONS),
] as [string, ...string[]])

export const GENERAL_APPLICATION_SETTING_DEFINITIONS: ApplicationSettingDefinition[] = [
  storeSetting({
    id: 'general.primary_provider', title: '默认供应商', description: '设置新节点与首次任务优先使用的模型供应商，不会隐藏其他供应商。',
    aliases: ['主供应商', '首选供应商', '默认平台', 'primary provider', 'default provider'], schema: z.enum(['ppio', 'fal', 'modelscope', 'kie', 'apimart', 'bailian', 'volcengine', 'grsai']), defaultValue: 'kie',
    target: { tab: 'general', sectionId: 'general-onboarding' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => modelDefaultsManager.getSnapshot().providerId,
  (value) => { modelDefaultsManager.setProvider(value) }),
  storeSetting({
    id: 'generation.default_image_model', title: '默认图片模型', description: '设置新图片节点默认使用的模型；auto 表示由默认供应商自动选择。',
    aliases: ['图片默认模型', '默认图像模型', 'default image model'], schema: DEFAULT_MODEL_ID_SCHEMA, defaultValue: 'auto',
    target: { tab: 'general', sectionId: 'general-onboarding' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => modelDefaultsManager.getSnapshot().models.image || 'auto',
  (value) => modelDefaultsManager.setDefaultModel('image', value === 'auto' ? '' : value)),
  storeSetting({
    id: 'generation.default_video_model', title: '默认视频模型', description: '设置新视频节点默认使用的模型；auto 表示由默认供应商自动选择。',
    aliases: ['视频默认模型', 'default video model'], schema: DEFAULT_MODEL_ID_SCHEMA, defaultValue: 'auto',
    target: { tab: 'general', sectionId: 'general-onboarding' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => modelDefaultsManager.getSnapshot().models.video || 'auto',
  (value) => modelDefaultsManager.setDefaultModel('video', value === 'auto' ? '' : value)),
  storeSetting({
    id: 'generation.default_audio_model', title: '默认音频模型', description: '设置新音频节点默认使用的模型；auto 表示由默认供应商自动选择。',
    aliases: ['音频默认模型', '声音默认模型', 'default audio model'], schema: DEFAULT_MODEL_ID_SCHEMA, defaultValue: 'auto',
    target: { tab: 'general', sectionId: 'general-onboarding' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => modelDefaultsManager.getSnapshot().models.audio || 'auto',
  (value) => modelDefaultsManager.setDefaultModel('audio', value === 'auto' ? '' : value)),
  storeSetting({
    id: 'general.startup_workspace', title: '启动工作区', description: '设置应用启动后默认显示生成、画布或工具箱。',
    aliases: ['启动页面', '默认页面', 'startup'], schema: z.enum(['generation', 'nodes', 'tools']), defaultValue: 'generation',
    target: { tab: 'general', sectionId: 'general-basic' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().startupWorkspace,
  (value) => useSettingsStore.getState().setStartupWorkspace(value)),
  storeSetting({
    id: 'general.language', title: '界面语言', description: '设置界面语言或跟随系统。',
    aliases: ['语言', '中文', '英文'], schema: z.enum(['auto', 'zh-CN', 'en-US']), defaultValue: 'auto',
    target: { tab: 'general', sectionId: 'general-basic' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, getCurrentLanguage, changeLanguage),
  storageSetting({
    id: 'general.max_history_count', title: '历史记录保留数量', description: '设置生成历史最多保留多少条。',
    aliases: ['历史数量', '保留记录'], schema: z.number().int().min(1).max(1_000), defaultValue: 50,
    target: { tab: 'general', sectionId: 'general-basic' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, 'max_history_count', (raw) => Number.parseInt(raw ?? '50', 10)),
  storeSetting({
    id: 'diagnostics.log_capture_mode', title: '日志捕获范围', description: '设置本次运行记录标准信息或完整诊断内容。',
    aliases: ['完整日志', '日志捕获', '诊断模式'], schema: z.enum(['standard', 'full']), defaultValue: 'standard',
    target: { tab: 'general', sectionId: 'general-maintenance' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().logCaptureMode,
  (value) => useSettingsStore.getState().setLogCaptureMode(value)),
  /*
   * 原本注册在 protectedSettingDefinitions.ts 的 updates.configuration 占位符（4.4 松绑）。
   * 拆成两条标量设置而不是保留一个组合 id：本注册表里每条设置都是单一标量值
   * （SettingValue = string | number | boolean），没有先例注册组合对象；enabled/frequency
   * 是用户与助手真正会独立调整的两个维度，lastCheckTime/ignoredVersions 是自动写回的派生态
   * 或增长中的列表，本来就不是「配置」，不在这次松绑范围内。
   */
  storeSetting({
    id: 'updates.enabled', title: '启用更新检测', description: '控制应用是否在启动或后台检查新版本。',
    aliases: ['自动更新', '检查更新', 'auto update'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'general', sectionId: 'general-maintenance' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => getUpdateConfig().enabled,
  (value) => setUpdateEnabled(value)),
  storeSetting({
    id: 'updates.check_frequency', title: '更新检查频率', description: '设置多久检查一次新版本。',
    aliases: ['更新频率', '检查频率', 'update frequency'], schema: z.enum(['startup', 'daily', 'weekly', 'never']), defaultValue: 'startup',
    target: { tab: 'general', sectionId: 'general-maintenance' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => getUpdateConfig().frequency,
  (value) => setUpdateFrequency(value)),
  storeSetting({
    id: 'generation.upload_provider', title: '默认上传服务', description: '设置生成任务优先使用的媒体上传服务。',
    aliases: ['上传服务', '上传供应商', 'upload provider'], schema: z.enum(['fal', 'kie']), defaultValue: 'kie',
    target: { tab: 'models', sectionId: 'models-upload' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().uploadProvider,
  (value) => useSettingsStore.getState().setUploadProvider(value)),
  storeSetting({
    id: 'generation.upload_fallback', title: '上传失败自动切换', description: '首选上传服务不可用时，是否自动尝试兼容服务。',
    aliases: ['上传回退', '自动切换上传', 'fallback'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'models', sectionId: 'models-upload' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().uploadFallbackEnabled,
  (value) => useSettingsStore.getState().setUploadFallbackEnabled(value)),
  storeSetting({
    id: 'generation.large_upload_strategy', title: '大文件上传策略', description: '控制大文件上传时询问、复制到数据目录或直接引用原文件。',
    aliases: ['大文件', '复制到数据目录', '引用原文件'], schema: z.enum(['ask', 'copy', 'reference']), defaultValue: 'ask',
    target: { tab: 'models', sectionId: 'models-upload' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().largeUploadStrategy,
  (value) => useSettingsStore.getState().setLargeUploadStrategy(value)),
  storeSetting({
    id: 'generation.viewer_info', title: '图片查看器信息面板', description: '控制图片查看器是否提供图片信息面板。',
    aliases: ['图片信息', '查看器信息', 'metadata'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'general', sectionId: 'general-behavior' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().enableImageViewerInfoPanel,
  (value) => useSettingsStore.getState().setEnableImageViewerInfoPanel(value)),
  storageSetting({
    id: 'generation.max_concurrent_tasks', title: '生成并发任务数', description: '设置可以同时执行的生成任务数量。',
    aliases: ['并发数', '同时生成'], schema: z.number().int().min(1).max(20), defaultValue: 2,
    target: { tab: 'general', sectionId: 'general-behavior' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, 'max_concurrent_tasks', (raw) => Number.parseInt(raw ?? '2', 10)),
  storageSetting({
    id: 'generation.auto_focus_model_search', title: '自动聚焦模型搜索', description: '打开模型选择器时自动定位到搜索输入。',
    aliases: ['模型搜索聚焦', '自动搜索'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'general', sectionId: 'general-behavior' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, 'enable_auto_focus_model_search', (raw) => raw !== 'false'),
  storeSetting({
    id: 'generation.ignore_at_tag_when_copying', title: '复制生成时忽略引用标签', description: '复制提示词继续生成时不携带界面引用标签。',
    aliases: ['忽略引用标签', '@标签'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-canvas' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().ignoreAtTagWhenCopyingAndGenerating,
  (value) => useSettingsStore.getState().setIgnoreAtTagWhenCopyingAndGenerating(value)),
  storeSetting({
    id: 'generation.prompt_optimization_behavior', title: '提示词优化按钮行为', description: '设置优化按钮直接运行还是先选择优化方案。',
    aliases: ['提示词优化', '优化按钮'], schema: z.enum(['select-profile', 'direct-optimize']), defaultValue: 'select-profile',
    target: { tab: 'general', sectionId: 'general-behavior' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, readPromptOptimizationButtonBehavior, writePromptOptimizationButtonBehavior),
  storageSetting({
    id: 'pricing.show_estimate', title: '显示费用预估', description: '在生成前显示预计费用。',
    aliases: ['价格预估', '费用'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'general', sectionId: 'general-behavior' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, SHOW_PRICE_ESTIMATE_STORAGE_KEY, (raw) => raw !== 'false', PRICE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'pricing.currency_mode', title: '费用显示币种', description: '设置费用按人民币、美元或自动方式显示。',
    aliases: ['币种', '人民币', '美元'], schema: z.enum(['auto', 'cny', 'usd']), defaultValue: 'auto',
    target: { tab: 'general', sectionId: 'general-behavior' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, PRICE_ESTIMATE_CURRENCY_MODE_STORAGE_KEY, (raw) => raw === 'cny' || raw === 'usd' ? raw : 'auto', PRICE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'pricing.usd_to_cny_rate', title: '美元人民币换算率', description: '设置费用预估使用的美元人民币换算率。',
    aliases: ['汇率', '美元换算'], schema: z.number().positive().max(100), defaultValue: 6.77,
    target: { tab: 'general', sectionId: 'general-behavior' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, USD_TO_CNY_RATE_STORAGE_KEY, (raw) => Number(raw ?? 6.77), PRICE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'downloads.quick_enabled', title: '快速下载', description: '启用生成结果快速下载。',
    aliases: ['快速下载', '一键下载'], schema: z.boolean(), defaultValue: false,
    target: { tab: 'general', sectionId: 'general-storage' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, QUICK_DOWNLOAD_SETTING_SPECS.enableQuickDownload.key,
  QUICK_DOWNLOAD_SETTING_SPECS.enableQuickDownload.parse),
  storageSetting({
    id: 'downloads.button_only', title: '仅显示快速下载按钮', description: '启用快速下载后只显示直接下载动作。',
    aliases: ['下载按钮', '快速下载'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'general', sectionId: 'general-storage' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, QUICK_DOWNLOAD_SETTING_SPECS.quickDownloadButtonOnly.key,
  QUICK_DOWNLOAD_SETTING_SPECS.quickDownloadButtonOnly.parse),
]
