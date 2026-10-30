import { z } from 'zod'
import { recordingEncodingFields } from '../screenRecording/encoding'
export const NODE_DEFAULTS_VERSION = 1
export const MODEL_DEFAULTS_VERSION = 2

export const ONBOARDING_VERSION = 2
export const SUBTITLE_MANIFEST_VERSION = 24
export const STORYBOARD_METADATA_VERSION = 1
export const RECORDING_SETUP_VERSION = 5
/** The last screen-recording choices, offered again next time; the session name is per recording and not kept. */
export const recordingSetupSchema = z.object({
  ...recordingEncodingFields,
  range: z.enum(['screen', 'window', 'region']), sourceId: z.string(),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).strict(),
  mode: z.enum(['full', 'quick']), saveDirectory: z.string(),
  microphone: z.boolean(), systemAudio: z.boolean(), camera: z.boolean(), cameraId: z.string(),
  quality: z.enum(['1080p', '1440p', '2160p']), fps: z.union([z.literal(30), z.literal(60)]), insert: z.boolean(),
  /** v4: the backup screen recording (v5 adds its sound choices) kept beside a web app recording; `sourceId` is the monitor for `screen`. */
  webAppBackup: z.object({
    ...recordingEncodingFields,
    enabled: z.boolean(), range: z.enum(['window', 'screen']), sourceId: z.string(), microphone: z.boolean().optional(), systemAudio: z.boolean().optional(),
    quality: z.enum(['1080p', '1440p', '2160p']), fps: z.union([z.literal(30), z.literal(60)]),
  }).strict().optional(),
}).strict()
export const nodeDefaultsSchema = z.record(z.string(), z.record(z.string(), z.json()))
export const modelDefaultsSchema = z.object({ version: z.literal(MODEL_DEFAULTS_VERSION), providerId: z.string(), models: z.object({ image: z.string(), video: z.string(), audio: z.string(), transcription: z.string() }) })
export const onboardingSchema = z.object({ version: z.literal(ONBOARDING_VERSION), status: z.enum(['not_started', 'in_progress', 'completed', 'skipped']), entryReason: z.enum(['fresh_install', 'existing_install', 'manual']), activeStepId: z.enum(['welcome', 'basics', 'provider', 'api-key', 'first-task']), completedStepIds: z.array(z.string()), configuredProviders: z.array(z.string()), verifiedProviders: z.array(z.string()), shownHintIds: z.array(z.string()), firstTaskPrepared: z.boolean(), firstTaskCompleted: z.boolean(), startedAt: z.string().nullable(), completedAt: z.string().nullable() })
export const storyboardMetadataSchema = z.object({ version: z.literal(STORYBOARD_METADATA_VERSION), gridRows: z.number().int().positive(), gridCols: z.number().int().positive(), frameNotes: z.array(z.string()) })
