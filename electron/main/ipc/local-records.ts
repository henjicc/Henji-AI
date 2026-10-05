import type { z } from 'zod'

import {
  generationHistoryClearRequestSchema,
  generationHistoryDeleteManyRequestSchema,
  generationHistoryIdRequestSchema,
  generationHistoryInsertManyRequestSchema,
  generationHistoryInsertSchema,
  generationHistoryQuerySchema,
  generationHistoryUpdateRequestSchema,
  presetIdRequestSchema,
  presetInsertSchema,
  presetQuerySchema,
  presetUpdateRequestSchema,
  settingKeyRequestSchema,
  settingSetRequestSchema,
} from '../../../src/core/localRecords/requests'
import {
  GENERATION_HISTORY_IPC_CHANNELS,
  PRESETS_IPC_CHANNELS,
  SETTINGS_IPC_CHANNELS,
} from '../../../src/platform/contracts/localRecords'
import { getGenerationHistoryStore } from '../services/generation-history/store'
import { getPresetStore } from '../services/presets/store'
import { getSettingsStore } from '../services/settings/store'
import { parseVoid, registerIpcHandler } from './registry'

/*
 * 本地记录 IPC（存储底座 2.3 数据库收口）：生成记录、预设、设置。
 * 入参用共享 schema 校验后交给主进程仓库；渲染层经 preload `henjiNative.generationHistory / presets / settings`
 * → PAL → `src/commands/` 调用，不再执行 SQL。
 */

function parseWith<T>(schema: z.ZodType<T>, optional = false): (input: unknown) => T {
  return (input) => schema.parse(optional && input === undefined ? {} : input)
}

export function registerLocalRecordsIpc(): void {
  const history = GENERATION_HISTORY_IPC_CHANNELS
  registerIpcHandler(history.list, parseWith(generationHistoryQuerySchema, true), (query) => getGenerationHistoryStore().list(query))
  registerIpcHandler(history.get, parseWith(generationHistoryIdRequestSchema), ({ id }) => getGenerationHistoryStore().get(id))
  registerIpcHandler(history.count, parseVoid, () => getGenerationHistoryStore().count())
  registerIpcHandler(history.insert, parseWith(generationHistoryInsertSchema), (record) => getGenerationHistoryStore().insert(record))
  registerIpcHandler(history.insertMany, parseWith(generationHistoryInsertManyRequestSchema), ({ records }) => getGenerationHistoryStore().insertMany(records))
  registerIpcHandler(history.update, parseWith(generationHistoryUpdateRequestSchema), ({ id, updates }) => getGenerationHistoryStore().update(id, updates))
  registerIpcHandler(history.delete, parseWith(generationHistoryIdRequestSchema), ({ id }) => getGenerationHistoryStore().delete(id))
  registerIpcHandler(history.deleteMany, parseWith(generationHistoryDeleteManyRequestSchema), ({ ids }) => getGenerationHistoryStore().deleteMany(ids))
  registerIpcHandler(history.clear, parseWith(generationHistoryClearRequestSchema, true), ({ olderThan }) => getGenerationHistoryStore().clear(olderThan))

  const presets = PRESETS_IPC_CHANNELS
  registerIpcHandler(presets.list, parseWith(presetQuerySchema, true), (query) => getPresetStore().list(query))
  registerIpcHandler(presets.get, parseWith(presetIdRequestSchema), ({ id }) => getPresetStore().get(id))
  registerIpcHandler(presets.insert, parseWith(presetInsertSchema), (preset) => getPresetStore().insert(preset))
  registerIpcHandler(presets.update, parseWith(presetUpdateRequestSchema), ({ id, updates }) => getPresetStore().update(id, updates))
  registerIpcHandler(presets.delete, parseWith(presetIdRequestSchema), ({ id }) => getPresetStore().delete(id))
  registerIpcHandler(presets.incrementUsage, parseWith(presetIdRequestSchema), ({ id }) => getPresetStore().incrementUsage(id))

  const settings = SETTINGS_IPC_CHANNELS
  registerIpcHandler(settings.get, parseWith(settingKeyRequestSchema), ({ key }) => getSettingsStore().getEntry(key))
  registerIpcHandler(settings.set, parseWith(settingSetRequestSchema), ({ key, value, type }) => getSettingsStore().set(key, value, type))
  registerIpcHandler(settings.delete, parseWith(settingKeyRequestSchema), ({ key }) => getSettingsStore().delete(key))
}
