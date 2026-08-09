// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import { extractDefaults } from '@/hooks/utils/defaultExtractor'

import {
  reconcileGenerationParams,
  resolveGenerationParamOptions,
  validateGenerationParams,
} from './generationParams'

/*
 * 5.2 任务文档要求挑联动最复杂的 2-3 个模型做等价性验证。按 linkage 数量实测排序（
 * grep 每个 *.model.ts 里 linkages 数组的 trigger 条目数）选出前三，覆盖三种不同的
 * 联动效果组合：
 * - ppio-kling-o1：5 条，全是 autoSwitch（模式与画幅比互相联动，条件最复杂）
 * - ppio-vidu-q3：4 条，autoSwitch + hide（hide 不改参数值，只影响可见性，不在
 *   reconcile 的覆盖范围内，这里只验证它的 2 条 autoSwitch）
 * - ppio-seedance-v1.5-pro：3 条，autoSwitch + filterOptions（选项会随图片上传状态多出
 *   一项 adaptive）
 *
 * 用的是 loadRealModelsIntoRegistry() 装进注册表的真实生产模型定义，不是手写 fixture——
 * 这样测试跟着模型 schema 一起演进，模型文件改了联动规则这里就会跟着变红，不会变成
 * 一份很快过期的快照。
 */
describe('generationParams：联动纯函数（对照真实模型 schema）', () => {
  beforeAll(async () => {
    await loadRealModelsIntoRegistry()
  })

  describe('ppio-kling-o1（5 条 autoSwitch，模式 × 画幅比）', () => {
    const modelId = 'ppio-kling-o1'

    it('上传 2 张图后模式自动切到 start-end-frame，画幅比自动切到 smart', () => {
      const model = registry.getModel(modelId)
      const schema = registry.getSchema(modelId)
      if (!model?.linkages) throw new Error(`模型 ${modelId} 缺少 linkages，检查测试环境`)

      const base = {
        ...extractDefaults(schema),
        ppioKlingO1Mode: 'text-image-to-video',
        uploadedImages: ['a.png', 'b.png'],
      }

      const reconciled = reconcileGenerationParams(schema, base, model.linkages, ['uploadedImages'])
      expect(reconciled.ppioKlingO1Mode).toBe('start-end-frame')
      expect(reconciled.ppioKlingO1AspectRatio).toBe('smart')
    })

    it('删光图片后（画幅比曾是 smart）画幅比回落到 16:9', () => {
      const model = registry.getModel(modelId)
      const schema = registry.getSchema(modelId)
      if (!model?.linkages) throw new Error(`模型 ${modelId} 缺少 linkages`)

      const base = {
        ...extractDefaults(schema),
        ppioKlingO1Mode: 'text-image-to-video',
        ppioKlingO1AspectRatio: 'smart',
        uploadedImages: [],
      }

      const reconciled = reconcileGenerationParams(schema, base, model.linkages, ['uploadedImages'])
      expect(reconciled.ppioKlingO1AspectRatio).toBe('16:9')
    })

    it('validateGenerationParams 认为一个不在选项里的画幅比不合法', () => {
      const schema = registry.getSchema(modelId)
      const invalid = { ...extractDefaults(schema), ppioKlingO1AspectRatio: 'not-a-real-ratio' }
      const result = validateGenerationParams(schema, invalid)
      expect(result.valid).toBe(false)
      expect(result.issues.map((issue) => issue.paramId)).toContain('ppioKlingO1AspectRatio')
    })
  })

  describe('ppio-vidu-q3（4 条：2 条 autoSwitch + 2 条 hide）', () => {
    const modelId = 'ppio-vidu-q3'

    it('上传 2 张图后模式自动切到 start-end-frame；只剩 1 张图后切回 text-image-to-video', () => {
      const model = registry.getModel(modelId)
      const schema = registry.getSchema(modelId)
      if (!model?.linkages) throw new Error(`模型 ${modelId} 缺少 linkages`)

      const twoImages = {
        ...extractDefaults(schema),
        ppioViduQ3Mode: 'text-image-to-video',
        uploadedImages: ['a.png', 'b.png'],
      }
      const afterUpload = reconcileGenerationParams(schema, twoImages, model.linkages, ['uploadedImages'])
      expect(afterUpload.ppioViduQ3Mode).toBe('start-end-frame')

      const oneImage = { ...afterUpload, uploadedImages: ['a.png'] }
      const afterRemove = reconcileGenerationParams(schema, oneImage, model.linkages, ['uploadedImages'])
      expect(afterRemove.ppioViduQ3Mode).toBe('text-image-to-video')
    })
  })

  describe('ppio-seedance-v1.5-pro（3 条：2 条 autoSwitch + 1 条 filterOptions）', () => {
    const modelId = 'ppio-seedance-v1.5-pro'

    it('上传图片后画幅比自动切到 adaptive，且 adaptive 选项被提到最前面', () => {
      const model = registry.getModel(modelId)
      const schema = registry.getSchema(modelId)
      if (!model?.linkages) throw new Error(`模型 ${modelId} 缺少 linkages`)

      // adaptive 本来就是基础选项列表里的最后一项（schema 默认值），filterOptions 联动
      // 是"上传图片时把 adaptive 挪到最前面"，不是"从无到有"。
      const noImages = { ...extractDefaults(schema), uploadedImages: [] }
      const optionsBefore = resolveGenerationParamOptions(schema, noImages, model.linkages)
      expect(optionsBefore.ppioSeedance15ProAspectRatio?.[0]).toMatchObject({ value: '16:9' })

      const withImages = { ...extractDefaults(schema), uploadedImages: ['a.png'] }
      const reconciled = reconcileGenerationParams(schema, withImages, model.linkages, ['uploadedImages'])
      expect(reconciled.ppioSeedance15ProAspectRatio).toBe('adaptive')

      const optionsAfter = resolveGenerationParamOptions(schema, withImages, model.linkages)
      expect(optionsAfter.ppioSeedance15ProAspectRatio?.[0]).toMatchObject({ value: 'adaptive' })
    })

    it('删光图片后（画幅比曾是 adaptive）画幅比保持 adaptive——第二条 autoSwitch 的条件本身就是这样写的', () => {
      const model = registry.getModel(modelId)
      const schema = registry.getSchema(modelId)
      if (!model?.linkages) throw new Error(`模型 ${modelId} 缺少 linkages`)

      const base = { ...extractDefaults(schema), ppioSeedance15ProAspectRatio: 'adaptive', uploadedImages: [] }
      const reconciled = reconcileGenerationParams(schema, base, model.linkages, ['uploadedImages'])
      expect(reconciled.ppioSeedance15ProAspectRatio).toBe('adaptive')
    })
  })

  it('reconcileGenerationParams 省略 changedKeys 时对全部已有 key 各跑一遍，效果等价于精确指定', () => {
    const modelId = 'ppio-kling-o1'
    const model = registry.getModel(modelId)
    const schema = registry.getSchema(modelId)
    if (!model?.linkages) throw new Error(`模型 ${modelId} 缺少 linkages`)

    const base = {
      ...extractDefaults(schema),
      ppioKlingO1Mode: 'text-image-to-video',
      uploadedImages: ['a.png', 'b.png'],
    }

    const precise = reconcileGenerationParams(schema, base, model.linkages, ['uploadedImages'])
    const omitted = reconcileGenerationParams(schema, base, model.linkages)
    expect(omitted).toEqual(precise)
  })

  it('没有 linkages 的模型原样返回 params', () => {
    const schema = [{ id: 'x', type: 'text', valueType: 'string', order: 1, name: { zh: 'x', en: 'x' }, default: '' }] as never
    const params = { x: 'hello' }
    expect(reconcileGenerationParams(schema, params, [])).toBe(params)
  })
})
