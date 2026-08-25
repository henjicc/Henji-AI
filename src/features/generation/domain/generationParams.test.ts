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
 * grep 每个 *.model.ts 里 linkages 数组的 trigger 条目数）选出前列，覆盖三种不同的
 * 联动效果组合：
 * - kie-seedance-v1：2 条，全是 autoSwitch（版本/上传图片数量都会把快速模式收回）
 * - ppio-minimax-hailuo-2.3：hide + filterOptions + autoSwitch（10 秒档不支持 1080P，
 *   filterOptions 收窄选项，autoSwitch 把已选的 1080P 收回 768P）
 * - ppio-kling-3.0：filterOptions + autoSwitch（动作控制模式不支持 4K，选项被收窄，
 *   已选的 4K 自动切回 1080P）
 *
 * 之前这里用的 ppio-kling-o1 / ppio-vidu-q3 / ppio-seedance-v1.5-pro 三个模型已经
 * 被 PPIO 官方下线（2026-07-15~2026-08-19，见供应商适配巡检），随之从代码里移除，
 * 这里按同样的方法重新在存活模型里选出当前最复杂的几个。
 *
 * 用的是 loadRealModelsIntoRegistry() 装进注册表的真实生产模型定义，不是手写 fixture——
 * 这样测试跟着模型 schema 一起演进，模型文件改了联动规则这里就会跟着变红，不会变成
 * 一份很快过期的快照。
 */
describe('generationParams：联动纯函数（对照真实模型 schema）', () => {
  beforeAll(async () => {
    await loadRealModelsIntoRegistry()
  })

  describe('kie-seedance-v1（2 条 autoSwitch，版本 × 上传图片数量收回快速模式）', () => {
    const modelId = 'kie-seedance-v1'

    it('Pro 版本快速模式开启时，上传图片数量变成 2 张（不等于1）会自动关闭快速模式', () => {
      const model = registry.getModel(modelId)
      const schema = registry.getSchema(modelId)
      if (!model?.linkages) throw new Error(`模型 ${modelId} 缺少 linkages，检查测试环境`)

      const base = {
        ...extractDefaults(schema),
        kieSeedanceV1Version: 'pro',
        kieSeedanceV1FastMode: true,
        uploadedImages: ['a.png', 'b.png'],
      }

      const reconciled = reconcileGenerationParams(schema, base, model.linkages, ['uploadedImages'])
      expect(reconciled.kieSeedanceV1FastMode).toBe(false)
    })

    it('快速模式开启时，把版本从 Pro 切回 Lite 会自动关闭快速模式', () => {
      const model = registry.getModel(modelId)
      const schema = registry.getSchema(modelId)
      if (!model?.linkages) throw new Error(`模型 ${modelId} 缺少 linkages`)

      const base = {
        ...extractDefaults(schema),
        kieSeedanceV1Version: 'lite',
        kieSeedanceV1FastMode: true,
      }

      const reconciled = reconcileGenerationParams(schema, base, model.linkages, ['kieSeedanceV1Version'])
      expect(reconciled.kieSeedanceV1FastMode).toBe(false)
    })

    it('validateGenerationParams 认为一个不在选项里的版本不合法', () => {
      const schema = registry.getSchema(modelId)
      const invalid = { ...extractDefaults(schema), kieSeedanceV1Version: 'ultra' }
      const result = validateGenerationParams(schema, invalid)
      expect(result.valid).toBe(false)
      expect(result.issues.map((issue) => issue.paramId)).toContain('kieSeedanceV1Version')
    })
  })

  describe('ppio-minimax-hailuo-2.3（hide + filterOptions + autoSwitch，时长 × 分辨率）', () => {
    const modelId = 'ppio-minimax-hailuo-2.3'

    it('10 秒档不提供 1080P 选项', () => {
      const model = registry.getModel(modelId)
      const schema = registry.getSchema(modelId)
      if (!model?.linkages) throw new Error(`模型 ${modelId} 缺少 linkages`)

      const params = { ...extractDefaults(schema), ppioHailuo23VideoDuration: 10 }
      const options = resolveGenerationParamOptions(schema, params, model.linkages)
      const values = options.ppioHailuo23VideoResolution?.map((option) => option.value)
      expect(values).not.toContain('1080P')
    })

    it('已选 1080P 时把时长切到 10 秒，分辨率自动收回 768P', () => {
      const model = registry.getModel(modelId)
      const schema = registry.getSchema(modelId)
      if (!model?.linkages) throw new Error(`模型 ${modelId} 缺少 linkages`)

      const base = {
        ...extractDefaults(schema),
        ppioHailuo23VideoResolution: '1080P',
        ppioHailuo23VideoDuration: 10,
      }

      const reconciled = reconcileGenerationParams(schema, base, model.linkages, ['ppioHailuo23VideoDuration'])
      expect(reconciled.ppioHailuo23VideoResolution).toBe('768P')
    })
  })

  describe('ppio-kling-3.0（filterOptions + autoSwitch，动作控制模式收窄分辨率）', () => {
    const modelId = 'ppio-kling-3.0'

    it('动作控制模式下分辨率选项不包含 4K', () => {
      const model = registry.getModel(modelId)
      const schema = registry.getSchema(modelId)
      if (!model?.linkages) throw new Error(`模型 ${modelId} 缺少 linkages`)

      const params = { ...extractDefaults(schema), ppioKling30Mode: 'motion-control' }
      const options = resolveGenerationParamOptions(schema, params, model.linkages)
      const values = options.ppioKling30Resolution?.map((option) => option.value)
      expect(values).not.toContain('4K')
    })

    it('已选 4K 时把模式切到动作控制，分辨率自动收回 1080P', () => {
      const model = registry.getModel(modelId)
      const schema = registry.getSchema(modelId)
      if (!model?.linkages) throw new Error(`模型 ${modelId} 缺少 linkages`)

      const base = {
        ...extractDefaults(schema),
        ppioKling30Resolution: '4K',
        ppioKling30Mode: 'motion-control',
      }

      const reconciled = reconcileGenerationParams(schema, base, model.linkages, ['ppioKling30Mode'])
      expect(reconciled.ppioKling30Resolution).toBe('1080P')
    })
  })

  it('reconcileGenerationParams 省略 changedKeys 时对全部已有 key 各跑一遍，效果等价于精确指定', () => {
    const modelId = 'ppio-minimax-hailuo-2.3'
    const model = registry.getModel(modelId)
    const schema = registry.getSchema(modelId)
    if (!model?.linkages) throw new Error(`模型 ${modelId} 缺少 linkages`)

    const base = {
      ...extractDefaults(schema),
      ppioHailuo23VideoResolution: '1080P',
      ppioHailuo23VideoDuration: 10,
    }

    const precise = reconcileGenerationParams(schema, base, model.linkages, ['ppioHailuo23VideoDuration'])
    const omitted = reconcileGenerationParams(schema, base, model.linkages)
    expect(omitted).toEqual(precise)
  })

  it('没有 linkages 的模型原样返回 params', () => {
    const schema = [{ id: 'x', type: 'text', valueType: 'string', order: 1, name: { zh: 'x', en: 'x' }, default: '' }] as never
    const params = { x: 'hello' }
    expect(reconcileGenerationParams(schema, params, [])).toBe(params)
  })
})
