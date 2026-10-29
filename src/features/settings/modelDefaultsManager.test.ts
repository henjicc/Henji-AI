import { describe, expect, it } from 'vitest'

import type { ModelDefinition } from '@/core/types'
import modelsV2 from '../../../tests/fixtures/persistence/model-defaults/v2.json'
import modelsV1 from '../../../tests/fixtures/persistence/model-defaults/v1.json'

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
  it.each([modelsV1, { ...modelsV1, models: { ...modelsV1.models, image: '' } }])('恢复已存的默认模型，读取只备份，明确保存后可再次加载', fixture => {
    const storage = new MemoryStorage()
    const text = JSON.stringify(fixture)
    storage.setItem(MODEL_DEFAULTS_STORAGE_KEY, text)
    const manager = new ModelDefaultsManager(storage, catalog([]))
    expect(manager.getSnapshot()).toEqual({ ...fixture, version: 2, models: { ...fixture.models, transcription: '' } })
    expect(storage.getItem(MODEL_DEFAULTS_STORAGE_KEY)).toBe(text)
    expect(storage.getItem(`${MODEL_DEFAULTS_STORAGE_KEY}:backup:v1`)).toBe(text)
    manager.setProvider('fal')
    expect(new ModelDefaultsManager(storage, catalog([])).getSnapshot()).toEqual(manager.getSnapshot())
    expect(storage.getItem(`${MODEL_DEFAULTS_STORAGE_KEY}:backup:v1`)).toBe(text)
  })

  it('当前版本黄金样本原样加载，用户修改保存为当前版本并可再次加载', () => {
    const storage = new MemoryStorage()
    const text = JSON.stringify(modelsV2)
    storage.setItem(MODEL_DEFAULTS_STORAGE_KEY, text)
    const models = catalog([model('kie-image', 'selected-image', 'kie', 'image')])
    const manager = new ModelDefaultsManager(storage, models)
    expect(manager.getSnapshot()).toEqual(modelsV2)
    expect(storage.getItem(MODEL_DEFAULTS_STORAGE_KEY)).toBe(text)
    manager.setDefaultModel('image', 'selected-image')
    expect(JSON.parse(storage.getItem(MODEL_DEFAULTS_STORAGE_KEY)!)).toEqual(manager.getSnapshot())
    expect(manager.getSnapshot()).toMatchObject({ version: 2, models: { image: 'selected-image' } })
    expect(new ModelDefaultsManager(storage, models).getSnapshot()).toEqual(manager.getSnapshot())
  })
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
      transcription: '',
    })
  })

  it('拒绝当前供应商不存在的默认模型，并列出可选值', () => {
    const manager = new ModelDefaultsManager(new MemoryStorage(), catalog([
      model('kie-image', 'available-image', 'kie', 'image'),
    ]))

    expect(() => manager.setDefaultModel('image', 'missing-image'))
      .toThrow('DEFAULT_MODEL_NOT_AVAILABLE:image:missing-image:available=available-image')
  })

  it('转写复用同一设置保存重开、拒绝失效选择，供应商变化清空', () => {
    const storage = new MemoryStorage()
    let configured = true
    const manager = new ModelDefaultsManager(storage, catalog([]), (provider) => provider === 'bailian' && configured)
    manager.setDefaultModel('transcription', 'bailian.speech-recognition.qwen3-asr-flash-filetrans')
    const reopened = new ModelDefaultsManager(storage, catalog([]), (provider) => provider === 'bailian' && configured)
    expect(reopened.getSnapshot().models.transcription).toBe(manager.getSnapshot().models.transcription)
    expect(reopened.resolveTranscriptionModelId()).toBe('bailian.speech-recognition.qwen3-asr-flash-filetrans')
    configured = false
    expect(() => reopened.resolveTranscriptionModelId()).toThrow('ASR_MODEL_UNAVAILABLE')
    expect(() => reopened.setDefaultModel('transcription', 'bailian.speech-recognition.fun-asr')).toThrow('DEFAULT_MODEL_NOT_AVAILABLE')
    expect(reopened.setProvider('fal')).toEqual(['transcription'])
    expect(reopened.getSnapshot().models.transcription).toBe('')
  })

  it('未设置转写时按主供应商优先自动选实际可用模型，排除文本与远端输入', () => {
    const manager = new ModelDefaultsManager(new MemoryStorage(), catalog([]), () => true)
    manager.setProvider('bailian')
    expect(manager.resolveTranscriptionModelId()).toBe('bailian.speech-recognition.fun-asr')
    expect(manager.listTranscriptionModels().map((entry) => entry.descriptor.modelId))
      .not.toContain('seedasr-2.0-file')
    expect(() => manager.setDefaultModel('transcription', 'bailian.speech-recognition.qwen3-asr-flash'))
      .toThrow('DEFAULT_MODEL_NOT_AVAILABLE')
  })
})
