import { z } from 'zod'

import type {
  GenerationHistoryInsertDto,
  GenerationHistoryQuery,
  GenerationHistoryUpdateDto,
  PresetInsertDto,
  PresetQuery,
  PresetUpdateDto,
  SettingValueType,
} from './types'

/*
 * 本地记录接口的请求校验（主进程 IPC 入口使用；与 types.ts 逐一对应）。
 * 路径只做通用检查（非空、不含 NUL），位置换算由主进程仓库负责。
 */

const idSchema = z.string().min(1).max(512)
const pathSchema = z.string().min(1).max(32_767).refine((value) => !value.includes('\0'), '路径无效。')
const paramsSchema = z.record(z.string(), z.unknown())
const mediaTypeSchema = z.enum(['image', 'video', 'audio'])
const statusSchema = z.enum(['queued', 'pending', 'generating', 'success', 'error', 'timeout', 'cancelled', 'completed', 'failed'])
const limitSchema = z.number().int().min(1).max(100_000)
const offsetSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

export const generationHistoryInsertSchema: z.ZodType<GenerationHistoryInsertDto> = z.object({
  id: idSchema,
  providerId: z.string().max(512),
  modelId: z.string().min(1).max(512),
  type: mediaTypeSchema,
  prompt: z.string().nullable(),
  params: paramsSchema,
  resultPaths: z.array(pathSchema).max(10_000),
  taskId: z.string().max(4_096).nullable(),
  status: statusSchema,
  errorMessage: z.string().nullable(),
  cost: z.number().finite().nullable(),
  duration: z.number().finite().nullable(),
  createdAt: z.string().min(1).max(64).optional(),
}).strict()

export const generationHistoryUpdateSchema: z.ZodType<GenerationHistoryUpdateDto> = z.object({
  providerId: z.string().max(512).optional(),
  modelId: z.string().min(1).max(512).optional(),
  type: mediaTypeSchema.optional(),
  prompt: z.string().nullable().optional(),
  params: paramsSchema.optional(),
  resultPaths: z.array(pathSchema).max(10_000).optional(),
  taskId: z.string().max(4_096).nullable().optional(),
  status: statusSchema.optional(),
  errorMessage: z.string().nullable().optional(),
  cost: z.number().finite().nullable().optional(),
  duration: z.number().finite().nullable().optional(),
}).strict()

export const generationHistoryQuerySchema: z.ZodType<GenerationHistoryQuery> = z.object({
  providerId: z.string().max(512).optional(),
  modelId: z.string().max(512).optional(),
  type: mediaTypeSchema.optional(),
  status: statusSchema.optional(),
  search: z.string().max(1_000).optional(),
  idPrefix: z.string().min(1).max(512).optional(),
  limit: limitSchema.optional(),
  offset: offsetSchema.optional(),
}).strict()

export const generationHistoryIdRequestSchema = z.object({ id: idSchema }).strict()
export const generationHistoryUpdateRequestSchema = z.object({ id: idSchema, updates: generationHistoryUpdateSchema }).strict()
export const generationHistoryInsertManyRequestSchema = z.object({ records: z.array(generationHistoryInsertSchema).min(1).max(5_000) }).strict()
export const generationHistoryDeleteManyRequestSchema = z.object({ ids: z.array(idSchema).min(1).max(100_000) }).strict()
export const generationHistoryClearRequestSchema = z.object({ olderThan: z.string().min(1).max(64).optional() }).strict()

export const presetInsertSchema: z.ZodType<PresetInsertDto> = z.object({
  id: idSchema,
  name: z.string().min(1).max(1_024),
  description: z.string().nullable(),
  modelId: z.string().max(512).nullable(),
  params: paramsSchema,
  isFavorite: z.boolean(),
}).strict()

export const presetUpdateSchema: z.ZodType<PresetUpdateDto> = z.object({
  name: z.string().min(1).max(1_024).optional(),
  description: z.string().nullable().optional(),
  params: paramsSchema.optional(),
  isFavorite: z.boolean().optional(),
}).strict()

export const presetQuerySchema: z.ZodType<PresetQuery> = z.object({
  modelId: z.string().max(512).nullable().optional(),
  onlyFavorites: z.boolean().optional(),
  limit: limitSchema.optional(),
  offset: offsetSchema.optional(),
}).strict()

export const presetIdRequestSchema = z.object({ id: idSchema }).strict()
export const presetUpdateRequestSchema = z.object({ id: idSchema, updates: presetUpdateSchema }).strict()

const settingKeySchema = z.string().min(1).max(512)
const settingTypeSchema: z.ZodType<SettingValueType> = z.enum(['string', 'number', 'boolean', 'json'])

export const settingKeyRequestSchema = z.object({ key: settingKeySchema }).strict()
export const settingSetRequestSchema = z.object({
  key: settingKeySchema,
  value: z.string().max(16 * 1024 * 1024),
  type: settingTypeSchema.optional(),
}).strict()
