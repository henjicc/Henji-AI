import { z } from 'zod'

import type { SettingsNavigationTarget } from '@/core/types/settingsNavigation'
import { createLogger } from '@/core/logging'
import { useSettingsStore } from '@/stores/settingsStore'
import { ADDITIONAL_APPLICATION_SETTING_DEFINITIONS } from './settingsRegistryAdditional'

const logger = createLogger('features.assistant.settings_registry')
const MAX_SETTING_PLANS = 64

export type SettingValue = string | number | boolean

export interface ApplicationSettingDefinition {
  id: string
  title: string
  description: string
  aliases: string[]
  schema: z.ZodType<SettingValue>
  defaultValue: SettingValue
  target: SettingsNavigationTarget
  requiresReload: boolean
  requiresRestart: boolean
  sensitive: boolean
  read: () => SettingValue
  write: (value: SettingValue) => void
}

interface SettingChangePlan {
  planRef: string
  revision: number
  changes: Array<{
    id: string
    before: SettingValue
    after: SettingValue
    title: string
    requiresReload: boolean
    requiresRestart: boolean
  }>
}

const definitions: ApplicationSettingDefinition[] = [
  {
    id: 'interface.blur_enabled',
    title: '毛玻璃效果',
    description: '控制图片、视频和画布上浮层的毛玻璃材质。',
    aliases: ['毛玻璃', '模糊', '玻璃效果', 'blur', 'glass'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-theme' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
    read: () => useSettingsStore.getState().uiBlurEnabled,
    write: (value) => useSettingsStore.getState().setUiBlurEnabled(z.boolean().parse(value)),
  },
  {
    id: 'interface.radius',
    title: '界面圆角',
    description: '设置全局界面圆角的紧凑、默认或宽松档位。',
    aliases: ['圆角', '紧凑', 'radius'],
    schema: z.enum(['compact', 'default', 'large']),
    defaultValue: 'default',
    target: { tab: 'interface', sectionId: 'interface-theme' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
    read: () => useSettingsStore.getState().uiRadiusPreset,
    write: (value) => useSettingsStore.getState().setUiRadiusPreset(
      z.enum(['compact', 'default', 'large']).parse(value)
    ),
  },
  {
    id: 'interface.theme_tone',
    title: '主题色调',
    description: '设置界面的中性、暖色或冷色色调。',
    aliases: ['主题', '色调', '暖色', '冷色', 'theme'],
    schema: z.enum(['neutral', 'warm', 'cool']),
    defaultValue: 'neutral',
    target: { tab: 'interface', sectionId: 'interface-theme' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
    read: () => useSettingsStore.getState().themeTonePreset,
    write: (value) => useSettingsStore.getState().setThemeTonePreset(
      z.enum(['neutral', 'warm', 'cool']).parse(value)
    ),
  },
  {
    id: 'general.startup_workspace',
    title: '启动工作区',
    description: '设置应用启动后默认显示生成、画布或工具箱。',
    aliases: ['启动页面', '默认页面', 'startup'],
    schema: z.enum(['generation', 'nodes', 'tools']),
    defaultValue: 'generation',
    target: { tab: 'general', sectionId: 'general-basic' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
    read: () => useSettingsStore.getState().startupWorkspace,
    write: (value) => useSettingsStore.getState().setStartupWorkspace(
      z.enum(['generation', 'nodes', 'tools']).parse(value)
    ),
  },
  {
    id: 'generation.upload_provider',
    title: '默认上传服务',
    description: '设置生成任务优先使用的媒体上传服务。',
    aliases: ['上传服务', '上传供应商', 'upload provider'],
    schema: z.enum(['fal', 'kie', 'bizyair']),
    defaultValue: 'bizyair',
    target: { tab: 'api', sectionId: 'api-upload' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
    read: () => useSettingsStore.getState().uploadProvider,
    write: (value) => useSettingsStore.getState().setUploadProvider(
      z.enum(['fal', 'kie', 'bizyair']).parse(value)
    ),
  },
  {
    id: 'generation.upload_fallback',
    title: '上传失败自动切换',
    description: '首选上传服务不可用时，是否自动尝试兼容服务。',
    aliases: ['上传回退', '自动切换上传', 'fallback'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'api', sectionId: 'api-upload' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
    read: () => useSettingsStore.getState().uploadFallbackEnabled,
    write: (value) => useSettingsStore.getState().setUploadFallbackEnabled(z.boolean().parse(value)),
  },
  {
    id: 'generation.large_upload_strategy',
    title: '大文件上传策略',
    description: '控制大文件上传时询问、复制到数据目录或直接引用原文件。',
    aliases: ['大文件', '复制到数据目录', '引用原文件'],
    schema: z.enum(['ask', 'copy', 'reference']),
    defaultValue: 'ask',
    target: { tab: 'api', sectionId: 'api-upload' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
    read: () => useSettingsStore.getState().largeUploadStrategy,
    write: (value) => useSettingsStore.getState().setLargeUploadStrategy(
      z.enum(['ask', 'copy', 'reference']).parse(value)
    ),
  },
  {
    id: 'canvas.detail_level',
    title: '画布细节等级',
    description: '控制缩小画布时的内容简化程度。',
    aliases: ['画布性能', '画布细节', 'LOD', '简化'],
    schema: z.enum(['off', 'detail', 'balanced', 'performance']),
    defaultValue: 'balanced',
    target: { tab: 'interface', sectionId: 'interface-canvas' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
    read: () => useSettingsStore.getState().canvasLodLevel,
    write: (value) => useSettingsStore.getState().setCanvasLodLevel(
      z.enum(['off', 'detail', 'balanced', 'performance']).parse(value)
    ),
  },
  {
    id: 'assets.open_mode',
    title: '素材库打开方式',
    description: '设置素材库按钮打开浮层还是完整工作区。',
    aliases: ['素材库入口', '素材库浮层', 'asset'],
    schema: z.enum(['floating', 'workspace']),
    defaultValue: 'floating',
    target: { tab: 'interface', sectionId: 'interface-assets' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
    read: () => useSettingsStore.getState().assetTabAction,
    write: (value) => useSettingsStore.getState().setAssetTabAction(
      z.enum(['floating', 'workspace']).parse(value)
    ),
  },
  {
    id: 'assets.panel_position',
    title: '素材面板位置',
    description: '设置素材浮层显示在顶部、左侧或右侧。',
    aliases: ['素材位置', '面板位置', '左侧', '右侧'],
    schema: z.enum(['top', 'left', 'right']),
    defaultValue: 'top',
    target: { tab: 'interface', sectionId: 'interface-assets' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
    read: () => useSettingsStore.getState().assetPanelPosition,
    write: (value) => useSettingsStore.getState().setAssetPanelPosition(
      z.enum(['top', 'left', 'right']).parse(value)
    ),
  },
  {
    id: 'assets.edge_trigger',
    title: '素材库边缘触发',
    description: '控制鼠标靠近屏幕边缘时是否打开素材库。',
    aliases: ['边缘触发', '鼠标靠边', 'edge trigger'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'interface', sectionId: 'interface-assets' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
    read: () => useSettingsStore.getState().assetEdgeTriggerEnabled,
    write: (value) => useSettingsStore.getState().setAssetEdgeTriggerEnabled(z.boolean().parse(value)),
  },
  {
    id: 'assets.thumbnail_fit',
    title: '素材缩略图适应方式',
    description: '设置素材缩略图填充裁切或完整显示。',
    aliases: ['缩略图', '裁切', '完整显示', 'thumbnail'],
    schema: z.enum(['cover', 'contain']),
    defaultValue: 'cover',
    target: { tab: 'interface', sectionId: 'interface-assets' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
    read: () => useSettingsStore.getState().assetThumbnailFit,
    write: (value) => useSettingsStore.getState().setAssetThumbnailFit(
      z.enum(['cover', 'contain']).parse(value)
    ),
  },
  {
    id: 'generation.viewer_info',
    title: '图片查看器信息面板',
    description: '控制图片查看器是否提供图片信息面板。',
    aliases: ['图片信息', '查看器信息', 'metadata'],
    schema: z.boolean(),
    defaultValue: true,
    target: { tab: 'general', sectionId: 'general-behavior' },
    requiresReload: false,
    requiresRestart: false,
    sensitive: false,
    read: () => useSettingsStore.getState().enableImageViewerInfoPanel,
    write: (value) => useSettingsStore.getState().setEnableImageViewerInfoPanel(z.boolean().parse(value)),
  },
  ...ADDITIONAL_APPLICATION_SETTING_DEFINITIONS,
]

const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]))
const protectedDefinitions: Record<string, Record<string, unknown>> = {
  'security.provider_keys': {
    id: 'security.provider_keys',
    title: '服务密钥',
    description: '只能查询各服务是否已配置；密钥值永不返回给助手。',
    aliases: ['API Key', '密钥', '供应商密钥'],
    target: { tab: 'api', sectionId: 'api-keys' },
    sensitive: true,
    writable: false,
  },
  'storage.download_paths': {
    id: 'storage.download_paths',
    title: '下载目录',
    description: '只能查询是否已配置；选择或迁移目录必须由系统选择器和用户完成。',
    aliases: ['下载路径', '保存目录', '本地路径'],
    target: { tab: 'general', sectionId: 'general-storage' },
    sensitive: true,
    writable: false,
  },
  'storage.data_path': {
    id: 'storage.data_path',
    title: '应用数据目录',
    description: '可以定位到数据目录设置；迁移目录必须通过系统确认完成。',
    aliases: ['数据目录', '迁移数据', '存储位置'],
    target: { tab: 'general', sectionId: 'general-storage' },
    sensitive: true,
    writable: false,
  },
  'downloads.quick_path': {
    id: 'downloads.quick_path',
    title: '快速下载目录',
    description: '可以定位到下载目录设置；具体路径只能通过系统选择器确认。',
    aliases: ['快速下载路径', '下载文件夹'],
    target: { tab: 'general', sectionId: 'general-storage' },
    sensitive: true,
    writable: false,
  },
  'models.visibility': {
    id: 'models.visibility',
    title: '模型显示范围',
    description: '可以定位到模型管理；具体模型选择由用户在列表中确认。',
    aliases: ['隐藏模型', '显示模型', '模型管理'],
    target: { tab: 'models', sectionId: 'models-visibility' },
    sensitive: false,
    writable: false,
  },
  'llm.configuration': {
    id: 'llm.configuration',
    title: '助手模型配置',
    description: '可以定位到助手模型配置；密钥值不会提供给助手。',
    aliases: ['大语言模型', '助手模型', 'LLM 配置'],
    target: { tab: 'api', sectionId: 'api-llm' },
    sensitive: true,
    writable: false,
  },
  'updates.configuration': {
    id: 'updates.configuration',
    title: '软件更新',
    description: '可以定位到软件更新与维护设置。',
    aliases: ['检查更新', '自动更新', '维护'],
    target: { tab: 'general', sectionId: 'general-maintenance' },
    sensitive: false,
    writable: false,
  },
}
const plans = new Map<string, SettingChangePlan>()
let revision = 0

useSettingsStore.subscribe((state, previous) => {
  if (state !== previous) revision += 1
})

function createPlanRef(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `settings-plan:${crypto.randomUUID()}`
    : `settings-plan:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function trimPlans(): void {
  while (plans.size > MAX_SETTING_PLANS) {
    const oldest = plans.keys().next().value
    if (typeof oldest !== 'string') break
    plans.delete(oldest)
  }
}

function publicDefinition(definition: ApplicationSettingDefinition): Record<string, unknown> {
  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    aliases: definition.aliases,
    defaultValue: definition.defaultValue,
    target: definition.target,
    requiresReload: definition.requiresReload,
    requiresRestart: definition.requiresRestart,
    sensitive: definition.sensitive,
  }
}

function applySettingChangesAtomically(changes: SettingChangePlan['changes']): void {
  const completed: SettingChangePlan['changes'] = []
  try {
    for (const change of changes) {
      const definition = definitionMap.get(change.id)
      if (!definition) throw new Error('NOT_FOUND')
      definition.write(change.after)
      completed.push(change)
    }
  } catch (error) {
    for (const change of completed.reverse()) {
      definitionMap.get(change.id)?.write(change.before)
    }
    throw error
  }
}

export function searchApplicationSettings(query: string, limit: number): Record<string, unknown>[] {
  const normalized = query.normalize('NFKC').trim().toLowerCase()
  const searchable = [
    ...definitions.map((definition) => publicDefinition(definition)),
    ...Object.values(protectedDefinitions),
  ]
  return searchable
    .map((definition) => {
      const aliases = Array.isArray(definition.aliases)
        ? definition.aliases.filter((alias): alias is string => typeof alias === 'string')
        : []
      const text = [
        definition.id,
        definition.title,
        definition.description,
        ...aliases,
      ].join(' ').toLowerCase()
      const score = !normalized ? 1 : text.includes(normalized) ? 100 : normalized
        .split(/\s+/)
        .filter(Boolean)
        .reduce((total, term) => total + (text.includes(term) ? 10 : 0), 0)
      return { definition, score }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.definition.id).localeCompare(String(right.definition.id)))
    .slice(0, limit)
    .map((item) => item.definition)
}

export function getApplicationSettings(ids: string[]): {
  revision: number
  settings: Record<string, unknown>[]
} {
  const settings = ids.map((id) => {
    if (id === 'security.provider_keys') {
      return {
        ...protectedDefinitions[id],
        configured: { ...useSettingsStore.getState().providerKeyStatus },
      }
    }
    if (id === 'storage.download_paths') {
      return {
        ...protectedDefinitions[id],
        configured: useSettingsStore.getState().downloadPresetPaths.length > 0,
        configuredCount: useSettingsStore.getState().downloadPresetPaths.length,
      }
    }
    const protectedDefinition = protectedDefinitions[id]
    if (protectedDefinition) return protectedDefinition
    const definition = definitionMap.get(id)
    if (!definition) throw new Error('NOT_FOUND')
    return {
      ...publicDefinition(definition),
      value: definition.sensitive ? undefined : definition.read(),
    }
  })
  return { revision, settings }
}

export function planApplicationSettingsChange(
  changes: Array<{ id: string; value: unknown }>
): SettingChangePlan {
  const seen = new Set<string>()
  const parsedChanges = changes.map((change) => {
    if (seen.has(change.id)) throw new Error('INVALID_INPUT')
    seen.add(change.id)
    const definition = definitionMap.get(change.id)
    if (!definition || definition.sensitive) throw new Error('NOT_FOUND')
    const parsed = definition.schema.safeParse(change.value)
    if (!parsed.success) throw new Error('INVALID_INPUT')
    return {
      id: definition.id,
      before: definition.read(),
      after: parsed.data,
      title: definition.title,
      requiresReload: definition.requiresReload,
      requiresRestart: definition.requiresRestart,
    }
  })
  const plan: SettingChangePlan = {
    planRef: createPlanRef(),
    revision,
    changes: parsedChanges,
  }
  plans.set(plan.planRef, plan)
  trimPlans()
  return plan
}

export function applyApplicationSettingsChange(planRef: string): {
  applied: Record<string, unknown>[]
  revision: number
  undoRef: string
  requiresReload: boolean
  requiresRestart: boolean
} {
  const plan = plans.get(planRef)
  if (!plan) throw new Error('NOT_FOUND')
  if (plan.revision !== revision) throw new Error('CONFLICT')

  logger.info('settings.apply.start', {
    event: 'assistant.settings.apply.start',
    settingIds: plan.changes.map((change) => change.id),
  })
  applySettingChangesAtomically(plan.changes)
  if (plan.revision === revision) revision += 1
  plans.delete(planRef)
  const undoPlan: SettingChangePlan = {
    planRef: createPlanRef(),
    revision,
    changes: plan.changes.map((change) => ({
      ...change,
      before: change.after,
      after: change.before,
    })),
  }
  plans.set(undoPlan.planRef, undoPlan)
  trimPlans()
  const applied = plan.changes.map((change) => ({
    id: change.id,
    title: change.title,
    value: definitionMap.get(change.id)?.read(),
  }))
  logger.info('settings.apply.completed', {
    event: 'assistant.settings.apply.completed',
    settingIds: plan.changes.map((change) => change.id),
    revision,
  })
  return {
    applied,
    revision,
    undoRef: undoPlan.planRef,
    requiresReload: plan.changes.some((change) => change.requiresReload),
    requiresRestart: plan.changes.some((change) => change.requiresRestart),
  }
}

export function getSettingsRegistryRevision(): number {
  return revision
}

export function listApplicationSettingIds(): string[] {
  return [...definitions.map((definition) => definition.id), ...Object.keys(protectedDefinitions)]
}
