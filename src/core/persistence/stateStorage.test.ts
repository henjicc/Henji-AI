import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { guardedPlainStorage, guardedStateStorage } from './stateStorage'
import type { PersistenceContract } from './migrations'

// 兼容起点之后的第一次升版本形态：v1 → v2 只补新字段默认值，保留用户值与未知字段。
const settingsV1 = { version: 1, state: { theme: 'dark', extension: { keep: true } } }
const settingsContract: PersistenceContract = { id: 'settings', name: '界面设置', version: 2, schema: z.object({ theme: z.string(), shortcut: z.string() }).passthrough(),
  migrations: { 1: content => ({ ...(content as object), shortcut: 'Alt+F1' }) } }
const modelsV1 = { version: 1, providerId: 'fal', models: { image: 'my-image' } }
const modelsContract: PersistenceContract = { id: 'model-defaults', name: '默认生成与转写模型', version: 2, schema: z.object({ version: z.literal(2), providerId: z.string(), models: z.object({ image: z.string(), transcription: z.string() }) }),
  migrations: { 1: content => { const value = content as typeof modelsV1; return { ...value, version: 2, models: { ...value.models, transcription: '' } } } } }

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
    { id: 'settings', key: 'settings-storage', contract: settingsContract, fixture: settingsV1 as Record<string, unknown> & { version: number }, expected: { version: 2, state: { ...settingsV1.state, shortcut: 'Alt+F1' } } },
    { id: 'model-defaults', key: 'henji-model-defaults', contract: modelsContract, fixture: modelsV1 as Record<string, unknown> & { version: number }, expected: { ...modelsV1, version: 2, models: { ...modelsV1.models, transcription: '' } } },
  ]
  for (const { id, key, contract, fixture, expected } of cases) {
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
      const invalid = id === 'settings' ? { ...fixture, state: { theme: null } } : { ...fixture, models: null }
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

})
