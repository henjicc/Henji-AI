import { z } from 'zod'
import { videoEditClipSchema } from '../videoEdit/document'
import { videoEditCaptionSchema } from '../videoEdit/timedContent'
import { SUBTITLE_MANIFEST_VERSION } from './preferenceSchemas'

export const videoEditSubtitleManifestSchema = z.object({ version: z.literal(SUBTITLE_MANIFEST_VERSION).default(SUBTITLE_MANIFEST_VERSION), projectId: z.string(), sequenceId: z.string(), signature: z.string(), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive(), soundClips: z.array(videoEditClipSchema).optional(), soundIdentities: z.record(z.string(), z.string()).optional(), captions: z.array(videoEditCaptionSchema).optional(), committed: z.boolean().optional() }).strict()
import { documentIdSchema } from '../documents/envelope'
import { INTERNAL_FOLDER_NAME } from '../documents/projectManifest'
import { isSafeRelativeSegment } from '../storage/pathSyntax'
import { videoEditTextStyleSchema } from '../videoEdit/text'

// Schemas for previously untyped storage boundaries; the payload itself is unchanged.
export const videoEditTextPresetSchema = z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), style: videoEditTextStyleSchema }).strict()
export const PACKAGE_FORMAT = 'henji-package'
export const PACKAGE_VERSION = 1
const folder = z.string().min(1).max(120).refine(value => isSafeRelativeSegment('win32', value) && value !== INTERNAL_FOLDER_NAME, '包里的文件夹名无效。')
const relative = z.string().min(1).max(4096).refine(value => value.split('/').every(segment => isSafeRelativeSegment('win32', segment)), '包里的位置无效。')
export const packageManifestSchema = z.object({
  format: z.literal(PACKAGE_FORMAT), version: z.literal(PACKAGE_VERSION), type: z.enum(['document', 'project']),
  name: z.string().min(1).max(200), exportedAt: z.string().max(64),
  folders: z.object({ generated: folder, materials: folder }).strict(),
  document: z.object({ id: documentIdSchema, path: relative }).strict().optional(),
  // ZIP directory count is an existing archive safety budget, not a product entity limit.
  documents: z.array(z.object({ id: documentIdSchema, path: relative }).strict()).max(100_000),
}).strict().superRefine((value, ctx) => { if (value.type === 'document' && !value.document) ctx.addIssue({ code: 'custom', message: '文档包缺少主文档。' }) })

export const voiceLibraryRecordSchema = z.object({
  voiceId: z.string().min(1), voiceName: z.string().min(1), providerId: z.string().min(1),
  createdAt: z.string(), updatedAt: z.string(), description: z.string().optional(), modelId: z.string().optional(),
  expiresAt: z.string().optional(), previewPath: z.string().optional(), taskId: z.string().optional(),
  status: z.enum(['training', 'ready', 'failed']).optional(), activated: z.boolean().optional(),
})
export const settingRecordSchema = z.object({ key: z.string(), value: z.string(), type: z.enum(['string', 'number', 'boolean', 'json']) })
export const presetRecordSchema = z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), model_id: z.string().nullable(), params: z.string(), is_favorite: z.number(), use_count: z.number(), created_at: z.string(), updated_at: z.string() })
export const assetRecordSchema = z.object({
  id: z.string(), media_type: z.enum(['image', 'video', 'audio', 'code']), display_name: z.string(), file_path: z.string(),
  source: z.enum(['generated', 'canvas', 'camera-stage', 'imported', 'external', 'video-edit']), mime_type: z.string().nullable(),
  size_bytes: z.number().nullable(), width: z.number().nullable(), height: z.number().nullable(), duration_seconds: z.number().nullable(),
  thumbnail_name: z.string().nullable(), inspection_status: z.enum(['pending', 'ready', 'missing', 'failed']), inspection_error: z.string().nullable(),
  file_modified_at: z.number().nullable(), content_identity: z.string().nullable(), last_used_at: z.number().nullable(), created_at: z.number(), updated_at: z.number(),
})
export const persistenceMetadataSchema = z.object({ version: z.number().int().positive() }).strict()
