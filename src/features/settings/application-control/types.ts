import type { SettingsNavigationTarget } from '@/core/types/settingsNavigation'
import type { z } from 'zod'

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

export interface SettingChangePlan {
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
