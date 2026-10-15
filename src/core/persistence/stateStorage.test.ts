import { describe, expect, it, vi } from 'vitest'
import { PERSISTENCE_FORMATS } from './formats'
import { guardedPlainStorage, guardedStateStorage } from './stateStorage'
import { migrateModelDefaultsV1 } from './preferenceSchemas'
import { migrateSettingsV13 } from './settingsSchema'
import { DEFAULT_RECORDING_SHORTCUTS } from '../screenRecording/contracts'
import settingsV13 from '../../../tests/fixtures/persistence/settings/v13.json'
import modelsV1 from '../../../tests/fixtures/persistence/model-defaults/v1.json'

function memoryStorage(key: string, text: string) {
  const values = new Map([[key, text]])
  return {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: vi.fn((name: string, value: string) => { values.set(name, value) }),
    removeItem: vi.fn((name: string) => { values.delete(name) }),
  }
}

describe('旧设置恢复读写与原件保护', () => {
  const cases = [
    { id: 'settings', key: 'settings-storage', fixture: settingsV13, expected: { version: 14, state: { ...settingsV13.state, recordingShortcuts: DEFAULT_RECORDING_SHORTCUTS } } },
    { id: 'model-defaults', key: 'henji-model-defaults', fixture: modelsV1, expected: { ...modelsV1, version: 2, models: { ...modelsV1.models, transcription: '' } } },
  ]
  for (const { id, key, fixture, expected } of cases) {
    const contract = PERSISTENCE_FORMATS.find(format => format.id === id)!
    const wrap = (storage: ReturnType<typeof memoryStorage>, onFailure = vi.fn()) => id === 'settings'
      ? guardedStateStorage(key, contract, storage)
      : guardedPlainStorage(key, contract, storage, onFailure)

    it(`${id} 黄金样本先备份、只在内存迁移，明确保存成功并能再次读取`, () => {
      const text = JSON.stringify(fixture)
      const storage = memoryStorage(key, text)
      const onFailure = vi.fn()
      const guard = wrap(storage, onFailure)
      const upgraded = guard.getItem(key)!
      expect(JSON.parse(upgraded)).toEqual(expected)
      expect(onFailure).not.toHaveBeenCalled()
      expect(storage.getItem(key)).toBe(text)
      expect(storage.getItem(`${key}:backup:v${fixture.version}`)).toBe(text)
      expect(storage.setItem.mock.calls).toEqual([[`${key}:backup:v${fixture.version}`, text]])
      guard.setItem(key, upgraded)
      expect(storage.getItem(key)).toBe(upgraded)
      expect(JSON.parse(wrap(storage).getItem(key)!)).toEqual(expected)
      expect(storage.getItem(`${key}:backup:v${fixture.version}`)).toBe(text)
    })

    it(`${id} 备份失败时不能覆盖原件；存储恢复后重读即可解锁保存`, () => {
      const text = JSON.stringify(fixture)
      const storage = memoryStorage(key, text)
      storage.setItem.mockImplementationOnce(() => { throw new Error('quota') })
      const guard = wrap(storage)
      if (id === 'settings') expect(() => guard.getItem(key)).toThrow('quota')
      else expect(guard.getItem(key)).toBeNull()
      expect(() => guard.setItem(key, '{}')).toThrow('quota')
      expect(storage.getItem(key)).toBe(text)
      const upgraded = guard.getItem(key)!
      expect(() => guard.setItem(key, upgraded)).not.toThrow()
      expect(JSON.parse(storage.getItem(key)!)).toEqual(expected)
    })

    it(`${id} 损坏、新版与非法字段继续保护原件，修复后重新读取能解除失败状态`, () => {
      const invalid = id === 'settings' ? { ...fixture, state: { recordingShortcuts: null } } : { ...fixture, models: null }
      for (const text of ['{broken', JSON.stringify({ ...fixture, version: contract.version + 1 }), JSON.stringify(invalid)]) {
        const storage = memoryStorage(key, text)
        const onFailure = vi.fn()
        const guard = wrap(storage, onFailure)
        if (id === 'settings') expect(() => guard.getItem(key)).toThrow()
        else { expect(guard.getItem(key)).toBeNull(); expect(onFailure).toHaveBeenCalledOnce() }
        expect(() => guard.setItem(key, '{}')).toThrow()
        expect(storage.getItem(key)).toBe(text)
        storage.setItem(key, JSON.stringify(fixture))
        const upgraded = guard.getItem(key)!
        expect(() => guard.setItem(key, upgraded)).not.toThrow()
      }
    })
  }

  it('只补缺失默认值，保留用户选项和未知字段，纯迁移不修改输入', () => {
    const models = { ...modelsV1, providerId: 'fal', models: { image: 'my-image', video: 'my-video', audio: 'my-audio' }, extension: { keep: true } }
    const before = structuredClone(models)
    expect(migrateModelDefaultsV1(models)).toEqual({ ...models, version: 2, models: { ...models.models, transcription: '' } })
    expect(models).toEqual(before)
    expect(migrateModelDefaultsV1({ ...models, models: { ...models.models, transcription: 'chosen' } })).toMatchObject({ models: { transcription: 'chosen' } })
    const settings = { ...settingsV13.state, extension: { keep: true }, recordingShortcuts: { toggle: null, mark: 'Alt+F1', stop: 'Alt+F2' } }
    expect(migrateSettingsV13(settings)).toEqual(settings)
    const migrated = migrateSettingsV13({ extension: { keep: true } }) as { recordingShortcuts: typeof DEFAULT_RECORDING_SHORTCUTS }
    expect(migrated).toEqual({ extension: { keep: true }, recordingShortcuts: DEFAULT_RECORDING_SHORTCUTS })
    expect(migrated.recordingShortcuts).not.toBe(DEFAULT_RECORDING_SHORTCUTS)
  })
})
