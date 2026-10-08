import { z } from 'zod'
export const NODE_DEFAULTS_VERSION = 1
export const MODEL_DEFAULTS_VERSION = 1
export const ONBOARDING_VERSION = 2
export const SUBTITLE_MANIFEST_VERSION = 1
export const STORYBOARD_METADATA_VERSION = 1
export const nodeDefaultsSchema = z.record(z.string(), z.record(z.string(), z.json()))
export const modelDefaultsSchema = z.object({ version: z.literal(MODEL_DEFAULTS_VERSION), providerId: z.string(), models: z.object({ image: z.string(), video: z.string(), audio: z.string() }) })
export const onboardingSchema = z.object({ version: z.literal(ONBOARDING_VERSION), status: z.enum(['not_started', 'in_progress', 'completed', 'skipped']), entryReason: z.enum(['fresh_install', 'existing_install', 'manual']), activeStepId: z.enum(['welcome', 'basics', 'provider', 'api-key', 'first-task']), completedStepIds: z.array(z.string()), configuredProviders: z.array(z.string()), verifiedProviders: z.array(z.string()), shownHintIds: z.array(z.string()), firstTaskPrepared: z.boolean(), firstTaskCompleted: z.boolean(), startedAt: z.string().nullable(), completedAt: z.string().nullable() })
export const storyboardMetadataSchema = z.object({ version: z.literal(STORYBOARD_METADATA_VERSION), gridRows: z.number().int().positive(), gridCols: z.number().int().positive(), frameNotes: z.array(z.string()) })
