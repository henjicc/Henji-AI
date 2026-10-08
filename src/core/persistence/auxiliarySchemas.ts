import { CANVAS_LAYER_PACKAGE_VERSION, KEYSTORE_VERSION, MEDIA_GRANTS_VERSION, LLM_JOURNAL_VERSION } from './schemaVersions'
import { z } from 'zod'

const jsonObject = z.record(z.string(), z.json())
export const presetExportSchema = z.object({ version: z.literal('1.0'), name: z.string().min(1), description: z.string().nullable().optional(), modelId: z.string().nullable().optional(), params: jsonObject })
export const themeSeedSchema = z.object({ mode: z.enum(['dark', 'light']), hue: z.number(), tint: z.number(), base: z.number(), contrast: z.number(), accent: z.string() }).passthrough()
export const themePayloadSchema = z.object({ version: z.literal(2), seed: themeSeedSchema, overrides: z.record(z.string(), z.string()).optional(), uiRadiusPreset: z.enum(['compact', 'default', 'large']) })
export const encryptedKeystoreSchema = z.object({ version: z.literal(KEYSTORE_VERSION), keys: z.record(z.string(), z.string()) })
export const mediaGrantsSchema = z.object({ version: z.literal(MEDIA_GRANTS_VERSION), roots: z.array(z.object({ path: z.string(), grantedAt: z.number() })) })
export const canvasLayerHeaderSchema = z.object({ format: z.literal('henji-canvas-layer'), version: z.literal(CANVAS_LAYER_PACKAGE_VERSION), documentId: z.string(), contentRevision: z.number().int().nonnegative() })
// Provider/model extension fields are deliberate JSON data; secrets stay in the keystore.
export const llmStoredConfigSchema = z.object({ providers: z.array(jsonObject), models: z.array(jsonObject), promptProfiles: z.array(jsonObject), selectedPromptProfileId: z.string().optional(), textProcessingPromptTemplates: z.array(jsonObject), agentProfiles: z.array(jsonObject), selectedAgentProfileId: z.string().optional(), tools: z.array(jsonObject), policy: jsonObject, memory: jsonObject }).passthrough()
export const providerSettingsJournalSchema = z.object({ version: z.literal(LLM_JOURNAL_VERSION), configBefore: llmStoredConfigSchema.nullable(), credentialBefore: z.object({ storeKey: z.string(), encrypted: z.string().nullable() }).optional() })
