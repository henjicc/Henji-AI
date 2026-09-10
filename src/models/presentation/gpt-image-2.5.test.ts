import { describe, expect, it } from 'vitest'
import { catalog } from '@henjicc/ai-sdk'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { reconcileGenerationParams } from '@/features/generation/domain/generationParams'
import { gptImage25Presentation } from './gpt-image-2.5'

describe('GPT Image 2.5 宿主参数联动', () => {
  it.each([
    ['kie-gpt-image-2.5', 'gpt25Resolution', { gpt25Resolution: '4K', gpt25AspectRatio: '27:16' }, 'gpt25AspectRatio', '27:16'],
    ['apimart-gpt-image-2.5', 'gpt25Channel', { gpt25Channel: 'ext', gpt25AspectRatio: '3:1' }, 'gpt25AspectRatio', '3:1'],
    ['grsai-gpt-image-2.5', 'gpt25Variant', { gpt25Variant: 'flare', gpt25Quality: 'max' }, 'gpt25Quality', 'max'],
    ['grsai-gpt-image-2.5', 'gpt25Resolution', { gpt25Variant: 'sunburst', gpt25Resolution: '2K', gpt25AspectRatio: '1:3' }, 'gpt25AspectRatio', '1:3'],
  ] as const)('%s 切换后清理不支持的选择', async (id, trigger, changed, target, invalid) => {
    const runtime = catalog.find(m => m.meta.id === id)!
    const model = composeModelDefinition(runtime, gptImage25Presentation[id])
    const defaults = Object.fromEntries(model.params.map(p => [p.id, p.default]))
    const params = reconcileGenerationParams(model.params, { ...defaults, ...changed }, model.linkages ?? [], [trigger])
    expect(params[target]).not.toBe(invalid)
    await expect(Promise.resolve().then(() => runtime.request!.builder!({ ...params, prompt: 'A landscape' }))).resolves.toBeTruthy()
  })

  it('Fal 新模型通过正式组合入口复用遮罩编辑器', () => {
    const id = 'fal-ai-gpt-image-2.5'
    const model = composeModelDefinition(catalog.find(m => m.meta.id === id)!, gptImage25Presentation[id])
    expect(model.params.find(p => p.id === 'gpt25Mask')).toMatchObject({
      type: 'image-upload', derivedMediaAuthoring: { kind: 'mask', source: { kind: 'first-image' }, editor: { kind: 'mask' } },
    })
    for (const provider of ['kie', 'apimart', 'grsai', 'fal-ai']) {
      expect(catalog.find(m => m.meta.id === `${provider}-gpt-image-2`)).toBeDefined()
    }
  })
})
