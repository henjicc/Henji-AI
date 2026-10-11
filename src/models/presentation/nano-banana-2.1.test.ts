import { afterEach, describe, expect, it } from 'vitest'
import { catalog } from '@henjicc/ai-sdk'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { registry } from '@/core/ModelRegistry'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { reconcileGenerationParams, resolveGenerationParamOptions } from '@/features/generation/domain/generationParams'
import { nanoBanana21Presentation } from './nano-banana-2.1'

afterEach(() => registry.clear())

describe('Nano Banana 2.1 宿主渠道和输入契约', () => {
  it('APIMart切换Ext时回收输出数量和极端比例，官方数量不受影响', () => {
    const id = 'apimart-nano-banana-2.1'
    const model = composeModelDefinition(catalog.find(m => m.meta.id === id)!, nanoBanana21Presentation[id])
    const params = { apimartNanoBanana21Channel: 'ext', apimartNanoBanana21Resolution: '4K', apimartNanoBanana21AspectRatio: '8:1', apimartNanoBanana21NumImages: 4 }
    const actual = reconcileGenerationParams(model.params, params, model.linkages ?? [], ['apimartNanoBanana21Channel', 'apimartNanoBanana21Resolution'])
    expect(actual).toMatchObject({ apimartNanoBanana21AspectRatio: 'smart', apimartNanoBanana21NumImages: 1 })
    const options = resolveGenerationParamOptions(model.params, actual, model.linkages ?? [])
    expect(options.apimartNanoBanana21AspectRatio.map(o => o.value)).not.toContain('8:1')
    expect(reconcileGenerationParams(model.params, { ...params, apimartNanoBanana21Channel: 'official' }, model.linkages ?? [], ['apimartNanoBanana21Channel'])).toMatchObject({ apimartNanoBanana21NumImages: 4 })
  })

  it('宿主不把未知参考图数量上限收窄到旧默认6张；KIE保留官方10张', () => {
    for (const [id, presentation] of Object.entries(nanoBanana21Presentation)) {
      const model = composeModelDefinition(catalog.find(m => m.meta.id === id)!, presentation)
      registry.register(model)
      expect(resolveInputLimits(id, {}).images.max).toBe(id.startsWith('kie-') ? 10 : Number.POSITIVE_INFINITY)
      if (id.startsWith('fal-')) expect(model.params.find(p => p.id === 'falNanoBanana21Pdf')?.type).toBe('file-upload')
      expect(model.params.some(p => p.type === 'text' && /url/i.test(p.id))).toBe(false)
    }
  })
})
