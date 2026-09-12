// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition, ParamDef } from '@/core/types'
import { CANVAS_NODE_TYPES as TYPES, type CanvasNodeData } from '../domain/canvasNodes'
import { canvasNodeDefinitions as definitions } from '../domain/nodeRegistry'
import { nodeCatalog } from './nodeCatalog'
import { CanvasNodeFactory } from './nodeFactory'
import {
  collectNodeParameterDefaults, NODE_PARAMETER_DEFAULTS_KEY, NodeParameterDefaults,
  nodeParameterDefaults, selectDefaultModelParams, supportsNodeParameterDefaults,
} from './nodeParameterDefaults'

const schema: ParamDef[] = [
  { id: 'count', type: 'number', name: 'Count', order: 1, default: 1 },
  { id: 'sound', type: 'switch', name: 'Sound', order: 2, default: true },
  { id: 'prompt', type: 'textarea', name: 'Prompt', order: 3, default: '' },
  { id: 'mask', type: 'image-upload', name: 'Mask', order: 4, default: [] },
  { id: 'negative', type: 'text', name: 'Negative', order: 5, default: '' },
]

beforeEach(() => {
  window.localStorage.clear()
  vi.spyOn(registry, 'getModel').mockImplementation((id) => (
    id === 'test-model' ? { meta: { id, type: 'image' }, params: schema } as ModelDefinition : undefined
  ))
  vi.spyOn(registry, 'getSchema').mockImplementation((id) => id === 'test-model' ? schema : [])
})
afterEach(() => { vi.restoreAllMocks() })

describe('节点参数默认值', () => {
  it.each([TYPES.imageEdit, TYPES.videoGen, TYPES.audioGen, TYPES.storyboardGen])('保存 %s 的参数并排除输入与结果', (type) => {
    const definition = definitions[type]
    const data = {
      ...definition.createDefaultData(), modelId: 'test-model', prompt: 'private',
      imageUrl: 'result.png', mediaInputs: { image: ['input.png'] }, isGenerating: true,
      params: { count: 4, sound: false, prompt: 'private', negative: 'private', mask: ['mask.png'], unknown: 'private' },
    } as CanvasNodeData
    nodeParameterDefaults.save(definition, data)
    const persisted = window.localStorage.getItem(NODE_PARAMETER_DEFAULTS_KEY)!
    expect(persisted).not.toMatch(/private|\.png|isGenerating|mediaInputs/)
    const reloaded = new NodeParameterDefaults(() => window.localStorage)
    expect(reloaded.resolve(definition, {})).toMatchObject({ modelId: 'test-model', params: { count: 4, sound: false } })
    expect(data.params).toHaveProperty('mask')
  })

  it('统一工厂只为新节点应用默认值，显式值与不同模型优先，数据互不共享', () => {
    const definition = definitions[TYPES.imageEdit]
    const factory = new CanvasNodeFactory({ next: () => crypto.randomUUID() }, nodeCatalog)
    const existing = factory.createNode(TYPES.imageEdit, { x: 0, y: 0 })
    nodeParameterDefaults.save(definition, { ...definition.createDefaultData(), modelId: 'test-model', params: { count: 6 } } as CanvasNodeData)
    const first = factory.createNode(TYPES.imageEdit, { x: 0, y: 0 })
    expect(first.data.params).toEqual({ count: 6, sound: true })
    expect(existing.data.params).toEqual({})
    expect(factory.createNode(TYPES.imageEdit, { x: 0, y: 0 }, { params: { count: 2 } }).data.params).toEqual({ count: 2 })
    expect(factory.createNode(TYPES.imageEdit, { x: 0, y: 0 }, { modelId: 'another-model' }).data.params).toEqual({})
    ;(first.data.params as DynamicValueMap).count = 99
    expect(factory.createNode(TYPES.imageEdit, { x: 0, y: 0 }).data.params).toMatchObject({ count: 6 })
  })

  it('打光只保存模式和光照参数，不保存嵌套提示词与参考图', () => {
    const definition = definitions[TYPES.relightGen]
    const defaults = collectNodeParameterDefaults(definition, {
      relightSettings: { lightingMode: 'smart', manual: { brightness: 2, extraPrompt: 'private' }, smart: { preset: 'neon', prompt: 'private', lightingReferenceImages: ['private.png'] } },
    })
    expect(defaults.relightSettings).toMatchObject({ lightingMode: 'smart', manual: { brightness: 2 }, smart: { preset: 'neon' } })
    expect(JSON.stringify(defaults)).not.toContain('private')
  })

  it('枚举全部手动节点，只有纯输入与纯文本展示不提供参数默认值', () => {
    const excluded = new Set([TYPES.universalUpload, TYPES.stringSource, TYPES.textAnnotation])
    for (const definition of Object.values(definitions).filter((item) => item.visibleInMenu)) {
      expect(supportsNodeParameterDefaults(definition), definition.type).toBe(!excluded.has(definition.type as typeof TYPES.universalUpload))
    }
  })

  it('数字和开关源保留零与 false；损坏存储不阻断新建，写失败向调用方报告', () => {
    const definition = definitions[TYPES.booleanSource]
    window.localStorage.setItem(NODE_PARAMETER_DEFAULTS_KEY, '{broken')
    expect(nodeParameterDefaults.resolve(definition, {})).toEqual({})
    nodeParameterDefaults.save(definition, { ...definition.createDefaultData(), value: false } as CanvasNodeData)
    expect(nodeParameterDefaults.resolve(definition, {})).toMatchObject({ value: false })
    const failed = new NodeParameterDefaults(() => ({ getItem: () => null, setItem: () => { throw new Error('disk full') } }))
    expect(() => failed.save(definition, definition.createDefaultData())).toThrow('disk full')
  })

  it('分组与复合参数只保留参数控件，上传和自由文本不进入默认值', () => {
    const grouped: ParamDef[] = [{ id: 'group', type: 'panel', name: 'Group', order: 1, default: {}, children: schema }]
    expect(selectDefaultModelParams(grouped, { count: 0, sound: false, prompt: 'private', mask: ['private'] })).toEqual({ count: 0, sound: false })
  })
})
