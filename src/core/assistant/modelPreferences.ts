import { z } from 'zod'

export const ASSISTANT_MODEL_PREFERENCES_SCHEMA_VERSION = 'assistant-model-preferences/v1' as const

const stringListSchema = z.array(z.string().trim().min(1).max(200)).max(100)
const mediaModelPreferencesSchema = z.object({
  image: stringListSchema.default([]),
  video: stringListSchema.default([]),
  audio: stringListSchema.default([]),
}).strict()
const mediaModelPreferencesUpdateSchema = z.object({
  image: stringListSchema.optional(),
  video: stringListSchema.optional(),
  audio: stringListSchema.optional(),
}).strict()

export const assistantModelSelectionStrategySchema = z.enum([
  'balanced',
  'quality',
  'speed',
  'cost',
])

export const assistantModelPreferencesSchema = z.object({
  schemaVersion: z.literal(ASSISTANT_MODEL_PREFERENCES_SCHEMA_VERSION),
  strategy: assistantModelSelectionStrategySchema,
  preferredProviders: stringListSchema,
  avoidedProviders: stringListSchema,
  preferredModels: mediaModelPreferencesSchema,
  avoidedModels: mediaModelPreferencesSchema,
  notes: z.string().max(4_000),
  updatedAt: z.string().datetime(),
}).strict()

export const assistantModelPreferencesUpdateSchema = z.object({
  strategy: assistantModelSelectionStrategySchema.optional(),
  preferredProviders: stringListSchema.optional(),
  avoidedProviders: stringListSchema.optional(),
  preferredModels: mediaModelPreferencesUpdateSchema.optional(),
  avoidedModels: mediaModelPreferencesUpdateSchema.optional(),
  notes: z.string().max(4_000).optional(),
}).strict()

export type AssistantModelSelectionStrategy = z.infer<typeof assistantModelSelectionStrategySchema>
export type AssistantModelPreferences = z.infer<typeof assistantModelPreferencesSchema>
export type AssistantModelPreferencesUpdate = z.infer<typeof assistantModelPreferencesUpdateSchema>

function uniqueTrimmed(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function normalizeMediaPreferences(
  value: AssistantModelPreferences['preferredModels']
): AssistantModelPreferences['preferredModels'] {
  return {
    image: uniqueTrimmed(value.image),
    video: uniqueTrimmed(value.video),
    audio: uniqueTrimmed(value.audio),
  }
}

export function createDefaultAssistantModelPreferences(
  updatedAt = new Date().toISOString()
): AssistantModelPreferences {
  return {
    schemaVersion: ASSISTANT_MODEL_PREFERENCES_SCHEMA_VERSION,
    strategy: 'balanced',
    preferredProviders: [],
    avoidedProviders: [],
    preferredModels: { image: [], video: [], audio: [] },
    avoidedModels: { image: [], video: [], audio: [] },
    notes: '',
    updatedAt,
  }
}

export function normalizeAssistantModelPreferences(
  value: AssistantModelPreferences
): AssistantModelPreferences {
  return assistantModelPreferencesSchema.parse({
    ...value,
    preferredProviders: uniqueTrimmed(value.preferredProviders),
    avoidedProviders: uniqueTrimmed(value.avoidedProviders),
    preferredModels: normalizeMediaPreferences(value.preferredModels),
    avoidedModels: normalizeMediaPreferences(value.avoidedModels),
    notes: value.notes.trim(),
  })
}

export function applyAssistantModelPreferencesUpdate(
  current: AssistantModelPreferences,
  update: AssistantModelPreferencesUpdate,
  updatedAt = new Date().toISOString()
): AssistantModelPreferences {
  const parsedUpdate = assistantModelPreferencesUpdateSchema.parse(update)
  return normalizeAssistantModelPreferences({
    ...current,
    ...parsedUpdate,
    preferredModels: {
      ...current.preferredModels,
      ...parsedUpdate.preferredModels,
    },
    avoidedModels: {
      ...current.avoidedModels,
      ...parsedUpdate.avoidedModels,
    },
    updatedAt,
  })
}

export function formatAssistantModelPreferencesForPrompt(
  preferences: AssistantModelPreferences
): string {
  const normalized = normalizeAssistantModelPreferences(preferences)
  return JSON.stringify({
    strategy: normalized.strategy,
    preferredProviders: normalized.preferredProviders,
    avoidedProviders: normalized.avoidedProviders,
    preferredModels: normalized.preferredModels,
    avoidedModels: normalized.avoidedModels,
    notes: normalized.notes,
  })
}
