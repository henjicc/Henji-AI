import { createLogger } from '@/core/logging'
import { useSettingsStore } from '@/stores/settingsStore'

import { GENERAL_APPLICATION_SETTING_DEFINITIONS } from './generalSettingDefinitions'
import { INTERFACE_APPLICATION_SETTING_DEFINITIONS } from './interfaceSettingDefinitions'
import { PROTECTED_APPLICATION_SETTING_DEFINITIONS } from './protectedSettingDefinitions'
import type { ApplicationSettingDefinition, SettingChangePlan } from './types'

const logger = createLogger('features.settings.application_control')
const MAX_SETTING_PLANS = 64

const definitions = [
  ...GENERAL_APPLICATION_SETTING_DEFINITIONS,
  ...INTERFACE_APPLICATION_SETTING_DEFINITIONS,
]
const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]))
if (definitionMap.size !== definitions.length) throw new Error('应用设置定义 ID 重复')

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
    for (const change of completed.reverse()) definitionMap.get(change.id)?.write(change.before)
    throw error
  }
}

export function searchApplicationSettings(query: string, limit: number): Record<string, unknown>[] {
  const normalized = query.normalize('NFKC').trim().toLowerCase()
  const searchable = [
    ...definitions.map((definition) => publicDefinition(definition)),
    ...Object.values(PROTECTED_APPLICATION_SETTING_DEFINITIONS),
  ]
  return searchable
    .map((definition) => {
      const aliases = Array.isArray(definition.aliases)
        ? definition.aliases.filter((alias): alias is string => typeof alias === 'string')
        : []
      const text = [definition.id, definition.title, definition.description, ...aliases]
        .join(' ')
        .toLowerCase()
      const score = !normalized ? 1 : text.includes(normalized) ? 100 : normalized
        .split(/\s+/)
        .filter(Boolean)
        .reduce((total, term) => total + (text.includes(term) ? 10 : 0), 0)
      return { definition, score }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score
      || String(left.definition.id).localeCompare(String(right.definition.id)))
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
        ...PROTECTED_APPLICATION_SETTING_DEFINITIONS[id],
        configured: { ...useSettingsStore.getState().providerKeyStatus },
      }
    }
    if (id === 'storage.download_paths') {
      return {
        ...PROTECTED_APPLICATION_SETTING_DEFINITIONS[id],
        configured: useSettingsStore.getState().downloadPresetPaths.length > 0,
        configuredCount: useSettingsStore.getState().downloadPresetPaths.length,
      }
    }
    const protectedDefinition = PROTECTED_APPLICATION_SETTING_DEFINITIONS[id]
    if (protectedDefinition) return protectedDefinition
    const definition = definitionMap.get(id)
    if (!definition) throw new Error('NOT_FOUND')
    return { ...publicDefinition(definition), value: definition.sensitive ? undefined : definition.read() }
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
  const plan: SettingChangePlan = { planRef: createPlanRef(), revision, changes: parsedChanges }
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

  logger.info('设置提交开始', {
    event: 'settings.apply.start',
    settingIds: plan.changes.map((change) => change.id),
  })
  try {
    applySettingChangesAtomically(plan.changes)
  } catch (error) {
    logger.error('设置提交失败', error, {
      event: 'settings.apply.failed',
      settingIds: plan.changes.map((change) => change.id),
    })
    throw error
  }
  if (plan.revision === revision) revision += 1
  plans.delete(planRef)
  const undoPlan: SettingChangePlan = {
    planRef: createPlanRef(),
    revision,
    changes: plan.changes.map((change) => ({ ...change, before: change.after, after: change.before })),
  }
  plans.set(undoPlan.planRef, undoPlan)
  trimPlans()
  logger.info('设置提交完成', {
    event: 'settings.apply.completed',
    settingIds: plan.changes.map((change) => change.id),
    revision,
  })
  return {
    applied: plan.changes.map((change) => ({
      id: change.id,
      title: change.title,
      value: definitionMap.get(change.id)?.read(),
    })),
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
  return [...definitions.map((definition) => definition.id), ...Object.keys(PROTECTED_APPLICATION_SETTING_DEFINITIONS)]
}

export function listApplicationSettingDefinitions(): ApplicationSettingDefinition[] {
  return [...definitions]
}
