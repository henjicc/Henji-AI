// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { registry } from '@/core/ModelRegistry'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import { getAspectChoiceParams, getSupportedAspectRatios } from '@/core/params/ratioResolution'
import { getCanvasImageCapability, resolveCanvasCapabilityModelCandidates } from '../capabilities'
import { OUTPAINT_WORKSPACE_MAXIMUM, readOutpaintComposition, resolveOutpaintModelParams } from './outpaintModelParams'

beforeAll(async () => { await loadRealModelsIntoRegistry() })
describe('扩图模型范围与构图参数', () => {
  it('包含全部现有图像编辑模型和专用扩图，不开放纯文生图或其他工具', () => {
    const policy = getCanvasImageCapability('image.outpaint')!.modelPolicy
    const all = registry.getModelsByType('image')
    const selected = resolveCanvasCapabilityModelCandidates(all, policy).candidates.map(item => item.model.meta.id)
    const editors = all.filter(model => model.meta.tags?.includes('image-to-image')).map(model => model.meta.id)
    expect(editors.length).toBeGreaterThan(20)
    expect(new Set(selected)).toEqual(new Set([...editors, 'fal-image-apps-v2-outpaint']))
  })
  it('各模型按最终框匹配合法比例，保留其他设置，不发送扩边字段', () => {
    for (const model of registry.getModelsByType('image').filter(model => model.meta.tags?.includes('image-to-image'))) {
      const result = resolveOutpaintModelParams(model, { quality: 'custom', expandLeft: 23 }, { width: 800, height: 1200 },
        { expandLeft: 600, expandRight: 600, expandTop: 0, expandBottom: 0 })
      expect(result.size).toEqual({ width: 2000, height: 1200 })
      expect(result.params.quality).toBe('custom')
      expect(result.params).not.toHaveProperty('expandLeft')
      for (const param of getAspectChoiceParams(model.params)) {
        const ratios = getSupportedAspectRatios(model.params)
        if (ratios.length) expect(param.options.some(option => option.value === result.params[param.id])).toBe(true)
      }
    }
  })
  it('构图优先于模型参数，原生模型继续发送单边限制内的扩图值', () => {
    const margins = { expandLeft: 50, expandRight: 100, expandTop: 0, expandBottom: 200 }
    const composition = readOutpaintComposition({ outpaintMargins: margins, params: { expandLeft: 0 } })
    const model = registry.getModel('fal-image-apps-v2-outpaint')!
    const result = resolveOutpaintModelParams(model, { zoomOutPercentage: 20 }, { width: 800, height: 1200 }, composition)
    expect(result.params).toMatchObject({ ...margins, zoomOutPercentage: 0 })
    expect(OUTPAINT_WORKSPACE_MAXIMUM).toBe(700)
  })
})
