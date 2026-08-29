/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  catalog,
  getModelscopeCustomModel,
  replaceModelscopeCustomModels,
} from '@henjicc/ai-sdk'

interface StoredCustomModel {
  id: string
  name: string
  providerId: string
  baseModel: string | null
  config: DynamicValueMap
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

const databaseState = vi.hoisted(() => ({
  records: [] as StoredCustomModel[],
}))

vi.mock('@/services/database', () => ({
  databaseService: {
    init: vi.fn(async () => undefined),
    getCustomModels: vi.fn(async (providerId?: string) =>
      databaseState.records.filter((record) => !providerId || record.providerId === providerId)
    ),
    getCustomModelById: vi.fn(async (id: string) =>
      databaseState.records.find((record) => record.id === id) ?? null
    ),
    insertCustomModel: vi.fn(async (model: Omit<StoredCustomModel, 'createdAt' | 'updatedAt'>) => {
      databaseState.records.push({
        ...model,
        createdAt: '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z',
      })
    }),
    updateCustomModel: vi.fn(async (id: string, updates: Partial<StoredCustomModel>) => {
      const record = databaseState.records.find((item) => item.id === id)
      if (record) Object.assign(record, updates)
    }),
    deleteCustomModel: vi.fn(async (id: string) => {
      databaseState.records = databaseState.records.filter((record) => record.id !== id)
    }),
  },
}))

import { formatPanelDisplayValue } from '@/components/params/panelDisplay'
import { modelscopeCustomModelService } from './ModelscopeCustomModelService'

describe('ModelScope 自建模型 SDK 单实例链路', () => {
  beforeEach(() => {
    databaseState.records = []
    window.localStorage.clear()
    replaceModelscopeCustomModels([])
    vi.clearAllMocks()
  })

  it('应用服务添加后，展示与运行时 builder 读取同一份 SDK registry', async () => {
    await modelscopeCustomModelService.addModel({
      id: 'Acme/Image-Editor',
      name: 'Acme 图片编辑器',
      costTier: 'ultra',
      magicGrainCost: 2,
      modelType: { imageGeneration: false, imageEditing: true },
    })

    expect(getModelscopeCustomModel('Acme/Image-Editor')).toEqual({
      id: 'Acme/Image-Editor',
      name: 'Acme 图片编辑器',
      costTier: 'ultra',
      magicGrainCost: 2,
      modelType: { imageGeneration: false, imageEditing: true },
    })
    expect(formatPanelDisplayValue('Acme/Image-Editor', 'modelscope-custom-model', 'zh-CN')).toBe(
      'Acme 图片编辑器'
    )

    const runtimeModel = catalog.find((model) => model.meta.id === 'modelscope-custom')
    expect(runtimeModel).toBeTruthy()
    expect(typeof runtimeModel!.inputLimits).toBe('function')
    const limits = typeof runtimeModel!.inputLimits === 'function'
      ? runtimeModel!.inputLimits({ modelscopeCustomModel: 'Acme/Image-Editor' })
      : runtimeModel!.inputLimits
    expect(limits).toEqual({ images: { max: 1 }, videos: { max: 0 } })

    const request = await runtimeModel!.request?.builder?.({
      modelscopeCustomModel: 'Acme/Image-Editor',
      prompt: '修复图片',
      modelscopeImageSize: '1:1',
      resolutionBaseSize: 1024,
      uploadedFilePaths: ['https://example.com/input.png'],
    })
    expect(request).toMatchObject({
      model: 'Acme/Image-Editor',
      prompt: '修复图片',
      size: '1024x1024',
      image_url: ['https://example.com/input.png'],
    })

    expect(runtimeModel!.pricing.calculator?.({
      modelscopeCustomModel: 'Acme/Image-Editor',
    })).toBe(2)

    await modelscopeCustomModelService.updateModel('Acme/Image-Editor', {
      name: 'Acme 编辑器（已更新）',
      modelType: { imageGeneration: false, imageEditing: true },
    })
    expect(getModelscopeCustomModel('Acme/Image-Editor')).toMatchObject({
      name: 'Acme 编辑器（已更新）',
      costTier: 'ultra',
      magicGrainCost: 2,
    })
  })
})
