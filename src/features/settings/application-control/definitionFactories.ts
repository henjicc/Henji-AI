import { APPLICATION_SETTINGS_CHANGED_EVENT } from '@/core/settings/events'
import { z } from 'zod'

import type { ApplicationSettingDefinition, SettingValue } from './types'

export const hexSettingSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/)

export function storeSetting<TValue extends SettingValue>(
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

export function storageSetting<TValue extends SettingValue>(
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
