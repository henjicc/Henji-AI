import {
  GENERATION_HISTORY_IPC_CHANNELS,
  PRESETS_IPC_CHANNELS,
  SETTINGS_IPC_CHANNELS,
  type GenerationHistoryPlatform,
  type PresetsPlatform,
  type SettingsPlatform,
} from '../../src/platform/contracts/localRecords'

type NativeInvoke = <T>(channel: string, payload?: unknown) => Promise<T>

/** 生成记录桥：方法与 GenerationHistoryPlatform 一一对应，通道表与主进程共用。 */
export function createGenerationHistoryApi(invoke: NativeInvoke): GenerationHistoryPlatform {
  const c = GENERATION_HISTORY_IPC_CHANNELS
  return {
    list: (query) => invoke(c.list, query),
    get: (id) => invoke(c.get, { id }),
    count: () => invoke(c.count),
    insert: (record) => invoke(c.insert, record),
    insertMany: (records) => invoke(c.insertMany, { records }),
    update: (id, updates) => invoke(c.update, { id, updates }),
    delete: (id) => invoke(c.delete, { id }),
    deleteMany: (ids) => invoke(c.deleteMany, { ids }),
    clear: (olderThan) => invoke(c.clear, olderThan === undefined ? {} : { olderThan }),
  }
}

/** 预设桥：方法与 PresetsPlatform 一一对应。 */
export function createPresetsApi(invoke: NativeInvoke): PresetsPlatform {
  const c = PRESETS_IPC_CHANNELS
  return {
    list: (query) => invoke(c.list, query),
    get: (id) => invoke(c.get, { id }),
    insert: (preset) => invoke(c.insert, preset),
    update: (id, updates) => invoke(c.update, { id, updates }),
    delete: (id) => invoke(c.delete, { id }),
    incrementUsage: (id) => invoke(c.incrementUsage, { id }),
  }
}

/** 设置桥：方法与 SettingsPlatform 一一对应。 */
export function createSettingsApi(invoke: NativeInvoke): SettingsPlatform {
  const c = SETTINGS_IPC_CHANNELS
  return {
    get: (key) => invoke(c.get, { key }),
    set: (key, value, type) => invoke(c.set, type === undefined ? { key, value } : { key, value, type }),
    delete: (key) => invoke(c.delete, { key }),
  }
}
