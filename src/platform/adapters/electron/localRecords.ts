import type { GenerationHistoryPlatform, PresetsPlatform, SettingsPlatform } from '@/platform/contracts/localRecords'

/** 本地记录（生成记录、预设、设置）：preload 桥已按平台接口实现，这里只做可用性检查与转发。 */

type LocalRecordDomain = 'generationHistory' | 'presets' | 'settings'

function getNative<K extends LocalRecordDomain>(domain: K): NonNullable<typeof window.henjiNative>[K] {
  const native = window.henjiNative
  if (!native?.[domain]) {
    throw new Error(`[platform:${domain}] henjiNative.${domain} is not available`)
  }
  return native[domain]
}

export function createElectronGenerationHistory(): GenerationHistoryPlatform {
  return {
    list: (query) => getNative('generationHistory').list(query),
    get: (id) => getNative('generationHistory').get(id),
    count: () => getNative('generationHistory').count(),
    insert: (record) => getNative('generationHistory').insert(record),
    insertMany: (records) => getNative('generationHistory').insertMany(records),
    update: (id, updates) => getNative('generationHistory').update(id, updates),
    delete: (id) => getNative('generationHistory').delete(id),
    deleteMany: (ids) => getNative('generationHistory').deleteMany(ids),
    clear: (olderThan) => getNative('generationHistory').clear(olderThan),
  }
}

export function createElectronPresets(): PresetsPlatform {
  return {
    list: (query) => getNative('presets').list(query),
    get: (id) => getNative('presets').get(id),
    insert: (preset) => getNative('presets').insert(preset),
    update: (id, updates) => getNative('presets').update(id, updates),
    delete: (id) => getNative('presets').delete(id),
    incrementUsage: (id) => getNative('presets').incrementUsage(id),
  }
}

export function createElectronSettings(): SettingsPlatform {
  return {
    get: (key) => getNative('settings').get(key),
    set: (key, value, type) => getNative('settings').set(key, value, type),
    delete: (key) => getNative('settings').delete(key),
  }
}
