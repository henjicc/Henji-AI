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
import { STARTUP_WORKSPACE_IDS } from '@/core/types/workspace'
import { GENERATION_MODEL_DESCRIPTIONS } from '@/core/modelCatalog/generationModelDescriptions'
import { API_KEY_PROVIDER_IDS } from '@/core/config/providers'
import { modelDefaultsManager } from '@/features/settings/modelDefaultsManager'
import { ASR_CATALOG, isTimestampedLocalAsr } from '@/core/audioEdit/asrCatalog'
import { DEFAULT_MEDIA_CACHE_SETTINGS, mediaCacheBudgetGbSchema, mediaCacheRetentionDaysSchema, VIDEO_RENDER_CACHE_FORMATS, VIDEO_RENDER_CACHE_QUALITIES, type MediaCacheSettings } from '@/core/media/mediaCache'
import { getMediaCacheSettings, updateMediaCacheSettings } from '@/services/mediaCache/mediaCacheSettings'

import { storageSetting, storeSetting } from './definitionFactories'
import type { ApplicationSettingDefinition } from './types'

/** 缓存设置的权威值在主进程；这里读同步投影，写入先更新投影再异步保存（失败时投影回滚并记日志）。 */
function writeMediaCacheSetting(patch: Partial<MediaCacheSettings>): void {
  void updateMediaCacheSettings(patch).catch(() => undefined)
}

const DEFAULT_MODEL_ID_SCHEMA = z.enum([
  'auto',
  ...Object.keys(GENERATION_MODEL_DESCRIPTIONS),
] as [string, ...string[]])

export const GENERAL_APPLICATION_SETTING_DEFINITIONS: ApplicationSettingDefinition[] = [
  storeSetting({
    id: 'transcription.default_model', title: '默认转写模型',
    description: '设置录制讲解使用的带词、字或句时间的转写模型；使用完整模型标识。只允许已配置且能处理本地录音的模型。auto 优先默认供应商，再选择可用模型；明确选择失效时必须重选。修改不影响已开始的转写。',
    aliases: ['默认语音识别模型', '讲解转写模型', 'ASR', 'default transcription model'],
    schema: z.enum(['auto', ...ASR_CATALOG.filter(isTimestampedLocalAsr).map((entry) => entry.descriptor.id)] as [string, ...string[]]),
    defaultValue: 'auto', target: { tab: 'workspace', sectionId: 'workspace-generation' },
    requiresReload: false, requiresRestart: false, sensitive: false,
    restore: (value) => modelDefaultsManager.restoreTranscriptionModelId(value === 'auto' ? '' : z.string().parse(value)),
  }, () => modelDefaultsManager.getSnapshot().models.transcription || 'auto',
  (value) => modelDefaultsManager.setDefaultModel('transcription', value === 'auto' ? '' : value)),
  storeSetting({
    id: 'general.primary_provider', title: '默认供应商', description: '设置新节点与首次任务优先使用的模型供应商，不会隐藏其他供应商。',
    aliases: ['主供应商', '首选供应商', '默认平台', 'primary provider', 'default provider'], schema: z.enum(API_KEY_PROVIDER_IDS), defaultValue: 'kie',
    target: { tab: 'workspace', sectionId: 'workspace-generation' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => modelDefaultsManager.getSnapshot().providerId,
  (value) => { modelDefaultsManager.setProvider(value) }),
  storeSetting({
    id: 'generation.default_image_model', title: '默认图片模型', description: '设置新图片节点及助手新建生成任务默认使用的模型；auto 表示由默认供应商自动选择。',
    aliases: ['图片默认模型', '默认图像模型', 'default image model'], schema: DEFAULT_MODEL_ID_SCHEMA, defaultValue: 'auto',
    target: { tab: 'workspace', sectionId: 'workspace-generation' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => modelDefaultsManager.getSnapshot().models.image || 'auto',
  (value) => modelDefaultsManager.setDefaultModel('image', value === 'auto' ? '' : value)),
  storeSetting({
    id: 'generation.default_video_model', title: '默认视频模型', description: '设置新视频节点及助手新建生成任务默认使用的模型；auto 表示由默认供应商自动选择。',
    aliases: ['视频默认模型', 'default video model'], schema: DEFAULT_MODEL_ID_SCHEMA, defaultValue: 'auto',
    target: { tab: 'workspace', sectionId: 'workspace-generation' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => modelDefaultsManager.getSnapshot().models.video || 'auto',
  (value) => modelDefaultsManager.setDefaultModel('video', value === 'auto' ? '' : value)),
  storeSetting({
    id: 'generation.default_audio_model', title: '默认音频模型', description: '设置新音频节点及助手新建生成任务默认使用的模型；auto 表示由默认供应商自动选择。',
    aliases: ['音频默认模型', '声音默认模型', 'default audio model'], schema: DEFAULT_MODEL_ID_SCHEMA, defaultValue: 'auto',
    target: { tab: 'workspace', sectionId: 'workspace-generation' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => modelDefaultsManager.getSnapshot().models.audio || 'auto',
  (value) => modelDefaultsManager.setDefaultModel('audio', value === 'auto' ? '' : value)),
  storeSetting({
    id: 'general.startup_workspace', title: '启动工作区', description: '设置应用启动后默认显示生成、画布、剪辑、工具或资产。',
    aliases: ['启动页面', '默认页面', 'startup'], schema: z.enum(STARTUP_WORKSPACE_IDS), defaultValue: 'generation',
    target: { tab: 'general', sectionId: 'general-basic' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().startupWorkspace,
  (value) => useSettingsStore.getState().setStartupWorkspace(value)),
  storeSetting({
    id: 'general.language', title: '界面语言', description: '设置界面语言或跟随系统。',
    aliases: ['语言', '中文', '英文'], schema: z.enum(['auto', 'zh-CN', 'en-US']), defaultValue: 'auto',
    target: { tab: 'general', sectionId: 'general-basic' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, getCurrentLanguage, changeLanguage),
  storeSetting({
    id: 'diagnostics.log_capture_mode', title: '日志捕获范围', description: '设置本次运行记录标准信息或完整诊断内容。',
    aliases: ['完整日志', '日志捕获', '诊断模式'], schema: z.enum(['standard', 'full']), defaultValue: 'standard',
    target: { tab: 'general', sectionId: 'general-about' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().logCaptureMode,
  (value) => useSettingsStore.getState().setLogCaptureMode(value)),
  /*
   * 原本注册在 protectedSettingDefinitions.ts 的 updates.configuration 占位符（4.4 松绑）。
   * 拆成两条标量设置：enabled/frequency 是用户与助手会独立调整的两个维度，
   * lastCheckTime/ignoredVersions 是自动写回的派生态
   * 或增长中的列表，本来就不是「配置」，不在这次松绑范围内。
   */
  storeSetting({
    id: 'updates.enabled', title: '启用更新检测', description: '控制应用是否在启动或后台检查新版本。',
    aliases: ['自动更新', '检查更新', 'auto update'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'general', sectionId: 'general-about' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => getUpdateConfig().enabled,
  (value) => setUpdateEnabled(value)),
  storeSetting({
    id: 'updates.check_frequency', title: '更新检查频率', description: '设置多久检查一次新版本。',
    aliases: ['更新频率', '检查频率', 'update frequency'], schema: z.enum(['startup', 'daily', 'weekly', 'never']), defaultValue: 'startup',
    target: { tab: 'general', sectionId: 'general-about' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => getUpdateConfig().frequency,
  (value) => setUpdateFrequency(value)),
  storeSetting({
    id: 'generation.upload_provider', title: '默认上传服务', description: '设置生成任务优先使用的媒体上传服务。',
    aliases: ['上传服务', '上传供应商', 'upload provider'], schema: z.enum(['fal', 'kie']), defaultValue: 'kie',
    target: { tab: 'files', sectionId: 'files-upload' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().uploadProvider,
  (value) => useSettingsStore.getState().setUploadProvider(value)),
  storeSetting({
    id: 'generation.upload_fallback', title: '上传失败自动切换', description: '首选上传服务不可用时，是否自动尝试兼容服务。',
    aliases: ['上传回退', '自动切换上传', 'fallback'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'files', sectionId: 'files-upload' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().uploadFallbackEnabled,
  (value) => useSettingsStore.getState().setUploadFallbackEnabled(value)),
  storeSetting({
    id: 'generation.large_upload_strategy', title: '大文件上传策略', description: '控制大文件上传时询问、复制到数据目录或直接引用原文件。',
    aliases: ['大文件', '复制到数据目录', '引用原文件'], schema: z.enum(['ask', 'copy', 'reference']), defaultValue: 'ask',
    target: { tab: 'files', sectionId: 'files-upload' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().largeUploadStrategy,
  (value) => useSettingsStore.getState().setLargeUploadStrategy(value)),
  storeSetting({
    id: 'generation.viewer_info', title: '图片查看器信息面板', description: '控制图片查看器是否提供图片信息面板。',
    aliases: ['图片信息', '查看器信息', 'metadata'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'general', sectionId: 'general-view' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().enableImageViewerInfoPanel,
  (value) => useSettingsStore.getState().setEnableImageViewerInfoPanel(value)),
  storageSetting({
    id: 'generation.max_concurrent_tasks', title: '生成并发任务数', description: '设置可以同时执行的生成任务数量。',
    aliases: ['并发数', '同时生成'], schema: z.number().int().min(1).max(20), defaultValue: 2,
    target: { tab: 'workspace', sectionId: 'workspace-generation' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, 'max_concurrent_tasks', (raw) => Number.parseInt(raw ?? '2', 10)),
  storageSetting({
    id: 'generation.auto_focus_model_search', title: '自动聚焦模型搜索', description: '打开模型选择器时自动定位到搜索输入。',
    aliases: ['模型搜索聚焦', '自动搜索'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'workspace', sectionId: 'workspace-generation' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, 'enable_auto_focus_model_search', (raw) => raw !== 'false'),
  storeSetting({
    id: 'generation.ignore_at_tag_when_copying', title: '复制生成时忽略引用标签', description: '复制提示词继续生成时不携带界面引用标签。',
    aliases: ['忽略引用标签', '@标签'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'workspace', sectionId: 'workspace-canvas' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => useSettingsStore.getState().ignoreAtTagWhenCopyingAndGenerating,
  (value) => useSettingsStore.getState().setIgnoreAtTagWhenCopyingAndGenerating(value)),
  storeSetting({
    id: 'generation.prompt_optimization_behavior', title: '提示词优化按钮行为', description: '设置优化按钮直接运行还是先选择优化方案。',
    aliases: ['提示词优化', '优化按钮'], schema: z.enum(['select-profile', 'direct-optimize']), defaultValue: 'select-profile',
    target: { tab: 'workspace', sectionId: 'workspace-generation' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, readPromptOptimizationButtonBehavior, writePromptOptimizationButtonBehavior),
  storageSetting({
    id: 'pricing.show_estimate', title: '显示费用预估', description: '在生成前显示预计费用。',
    aliases: ['价格预估', '费用'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'workspace', sectionId: 'workspace-generation' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, SHOW_PRICE_ESTIMATE_STORAGE_KEY, (raw) => raw !== 'false', PRICE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'pricing.currency_mode', title: '费用显示币种', description: '设置费用按人民币、美元或自动方式显示。',
    aliases: ['币种', '人民币', '美元'], schema: z.enum(['auto', 'cny', 'usd']), defaultValue: 'auto',
    target: { tab: 'workspace', sectionId: 'workspace-generation' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, PRICE_ESTIMATE_CURRENCY_MODE_STORAGE_KEY, (raw) => raw === 'cny' || raw === 'usd' ? raw : 'auto', PRICE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'pricing.usd_to_cny_rate', title: '美元人民币换算率', description: '设置费用预估使用的美元人民币换算率。',
    aliases: ['汇率', '美元换算'], schema: z.number().positive().max(100), defaultValue: 6.77,
    target: { tab: 'workspace', sectionId: 'workspace-generation' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, USD_TO_CNY_RATE_STORAGE_KEY, (raw) => Number(raw ?? 6.77), PRICE_SETTING_CHANGED_EVENT),
  storageSetting({
    id: 'downloads.quick_enabled', title: '快速下载', description: '启用生成结果快速下载。',
    aliases: ['快速下载', '一键下载'], schema: z.boolean(), defaultValue: false,
    target: { tab: 'files', sectionId: 'files-download' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, QUICK_DOWNLOAD_SETTING_SPECS.enableQuickDownload.key,
  QUICK_DOWNLOAD_SETTING_SPECS.enableQuickDownload.parse),
  storageSetting({
    id: 'downloads.quick_path', title: '快速下载目录', description: '快速下载保存到的文件夹（本机绝对路径）；空字符串表示未设置。',
    aliases: ['快速下载路径', '下载文件夹'], schema: z.string().max(4096), defaultValue: '',
    target: { tab: 'files', sectionId: 'files-download' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, QUICK_DOWNLOAD_SETTING_SPECS.quickDownloadPath.key,
  QUICK_DOWNLOAD_SETTING_SPECS.quickDownloadPath.parse),
  storeSetting({
    id: 'storage.download_paths', title: '常用保存位置', description: '下载与导出时可选的常用文件夹（本机绝对路径列表，按顺序对应 presetIndex，重复项自动去掉）。',
    aliases: ['下载目录', '保存目录', '下载预设路径', '本地路径'], schema: z.array(z.string().min(1).max(4096)).max(32), defaultValue: [],
    target: { tab: 'files', sectionId: 'files-download' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => [...useSettingsStore.getState().downloadPresetPaths], paths => useSettingsStore.getState().setDownloadPresetPaths(paths)),
  storageSetting({
    id: 'downloads.button_only', title: '仅显示快速下载按钮', description: '启用快速下载后只显示直接下载动作。',
    aliases: ['下载按钮', '快速下载'], schema: z.boolean(), defaultValue: true,
    target: { tab: 'files', sectionId: 'files-download' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, QUICK_DOWNLOAD_SETTING_SPECS.quickDownloadButtonOnly.key,
  QUICK_DOWNLOAD_SETTING_SPECS.quickDownloadButtonOnly.parse),
  storeSetting({
    id: 'storage.cache_budget_gb', title: '缓存容量上限', description: '作品目录下可重建缓存（预渲染、代理、智能分析、缩略图与波形、口播处理）的总容量上限，单位 GB，10–4096；null 表示自动（所在盘可用空间的 10%，10–50GB）。超过上限时先删最久未用的。',
    aliases: ['缓存上限', '缓存大小', '缓存容量', 'cache size', 'cache limit'], schema: mediaCacheBudgetGbSchema.nullable(), defaultValue: DEFAULT_MEDIA_CACHE_SETTINGS.budgetGb,
    target: { tab: 'files', sectionId: 'files-cache' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => getMediaCacheSettings().budgetGb, budgetGb => writeMediaCacheSetting({ budgetGb })),
  storeSetting({
    id: 'storage.cache_retention_days', title: '缓存自动清理', description: '超过这么多天没有用到的缓存自动删除：7、30（默认）、90，0 表示从不按时间清理（仍受容量上限约束）。',
    aliases: ['缓存清理', '自动清理缓存', '缓存保留', 'cache retention'], schema: mediaCacheRetentionDaysSchema, defaultValue: DEFAULT_MEDIA_CACHE_SETTINGS.retentionDays,
    target: { tab: 'files', sectionId: 'files-cache' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => getMediaCacheSettings().retentionDays, retentionDays => writeMediaCacheSetting({ retentionDays })),
  storeSetting({
    id: 'video_edit.render_format', title: '预渲染格式', description: '剪辑预渲染文件的编码：auto（默认）在本机硬件能编码并解码 HEVC 时用 HEVC，否则 H.264；avc 固定 H.264；hevc 固定 HEVC。分辨率始终跟随序列；改动后旧格式的段落在空闲时按新格式重新渲染。',
    aliases: ['预渲染格式', '渲染格式', '预览文件格式', 'render format', 'HEVC', 'H.264'], schema: z.enum(VIDEO_RENDER_CACHE_FORMATS), defaultValue: DEFAULT_MEDIA_CACHE_SETTINGS.renderFormat,
    target: { tab: 'workspace', sectionId: 'workspace-video-edit' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => getMediaCacheSettings().renderFormat, renderFormat => writeMediaCacheSetting({ renderFormat })),
  storeSetting({
    id: 'video_edit.render_quality', title: '预渲染画质', description: '剪辑预渲染的画质：standard（默认）按序列分辨率与帧率查码率表（H.264 4K60 50Mbps、4K30 40、1440p60 30、1080p 20，HEVC ×0.7，最低 20Mbps），high 为其 1.3 倍；改动后旧段落在空闲时重新渲染。',
    aliases: ['预渲染画质', '渲染画质', 'render quality'], schema: z.enum(VIDEO_RENDER_CACHE_QUALITIES), defaultValue: DEFAULT_MEDIA_CACHE_SETTINGS.renderQuality,
    target: { tab: 'workspace', sectionId: 'workspace-video-edit' }, requiresReload: false, requiresRestart: false, sensitive: false,
  }, () => getMediaCacheSettings().renderQuality, renderQuality => writeMediaCacheSetting({ renderQuality })),
]
