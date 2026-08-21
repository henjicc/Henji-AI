import { describe, expect, it } from 'vitest'

import type { ModelDefinition } from '@/core/types'

import {
  MODEL_DEFAULTS_STORAGE_KEY,
  ModelDefaultsManager,
  type DefaultModelMediaType,
  type ModelDefaultsCatalog,
  type ModelDefaultsStorage,
} from './modelDefaultsManager'

class MemoryStorage implements ModelDefaultsStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function model(
  id: string,
  canonicalModelId: string,
  provider: string,
  type: DefaultModelMediaType,
): ModelDefinition {
  return {
    meta: {
      id,
      canonicalModelId,
      provider,
      type,
      name: { zh: canonicalModelId, en: canonicalModelId },
      tags: [],
    },
    inputLimits: { images: { max: 0 }, videos: { max: 0 }, audios: { max: 0 } },
    params: [],
    linkages: [],
    endpoints: '/test',
    request: { builder: (params) => params },
    pricing: { currency: '$', fixed: 1 },
  }
}

function catalog(models: ModelDefinition[]): ModelDefaultsCatalog {
  return {
    getModelsByType: (mediaType) => models.filter((item) => item.meta.type === mediaType),
  }
}

describe('ModelDefaultsManager', () => {
  it('首次创建独立默认项时迁移旧引导里的供应商', () => {
    const storage = new MemoryStorage()
    storage.setItem('henji-onboarding-state', JSON.stringify({ primaryProvider: 'fal' }))

    const manager = new ModelDefaultsManager(storage, catalog([]))

    expect(manager.getSnapshot()).toMatchObject({
      providerId: 'fal',
      models: { image: '', video: '', audio: '' },
    })
    expect(JSON.parse(storage.getItem(MODEL_DEFAULTS_STORAGE_KEY) ?? '{}'))
      .toMatchObject({ providerId: 'fal' })
  })

  it('切换供应商时按统一模型标识保留同名默认模型', () => {
    const storage = new MemoryStorage()
    const manager = new ModelDefaultsManager(storage, catalog([
      model('kie-nano-banana-2', 'nano-banana-2', 'kie', 'image'),
      model('fal-nano-banana-2', 'nano-banana-2', 'fal', 'image'),
    ]))
    manager.setDefaultModel('image', 'nano-banana-2')

    expect(manager.setProvider('fal')).toEqual([])
    expect(manager.getSnapshot().models.image).toBe('nano-banana-2')
    expect(manager.resolveModelId('image')).toBe('fal-nano-banana-2')
  })

  it('新供应商缺少某个默认模型时只清空受影响的类别', () => {
    const storage = new MemoryStorage()
    const manager = new ModelDefaultsManager(storage, catalog([
      model('kie-image', 'image-only-on-kie', 'kie', 'image'),
      model('kie-video', 'shared-video', 'kie', 'video'),
      model('fal-video', 'shared-video', 'fal', 'video'),
    ]))
    manager.setDefaultModel('image', 'image-only-on-kie')
    manager.setDefaultModel('video', 'shared-video')

    expect(manager.setProvider('fal')).toEqual(['image'])
    expect(manager.getSnapshot().models).toEqual({
      image: '',
      video: 'shared-video',
      audio: '',
    })
  })

  it('拒绝当前供应商不存在的默认模型，并列出可选值', () => {
    const manager = new ModelDefaultsManager(new MemoryStorage(), catalog([
      model('kie-image', 'available-image', 'kie', 'image'),
    ]))

    expect(() => manager.setDefaultModel('image', 'missing-image'))
      .toThrow('DEFAULT_MODEL_NOT_AVAILABLE:image:missing-image:available=available-image')
  })
})
