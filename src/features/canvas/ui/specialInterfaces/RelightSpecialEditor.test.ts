import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RELIGHT_SETTINGS,
  normalizeRelightSettings,
} from '@/features/canvas/capabilities/relightPolicy'
import { buildRelightEditorDraft } from './relightEditorDraft'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { falPresentation } from '@/models/presentation/fal'
import { falGptImage2Model } from '../../../../../packages/ai-sdk/src/catalog/fal/gpt-image-2.model'
import { falIcLightV2Model } from '../../../../../packages/ai-sdk/src/catalog/fal/ic-light-v2.model'

const models = [falIcLightV2Model, falGptImage2Model].map((runtime) => (
  composeModelDefinition(runtime, falPresentation[runtime.meta.id])
))

describe('图片打光编辑器草稿', () => {
  it('轮廓光只改变提示词意图，不改变主光的官方方向字段，关闭后撤回请求', () => {
    const settings = normalizeRelightSettings({
      ...DEFAULT_RELIGHT_SETTINGS,
      manual: { ...DEFAULT_RELIGHT_SETTINGS.manual, keyDirection: 'right', rimDirection: 'top-left' },
    })
    const enabled = buildRelightEditorDraft({}, settings, models)
    expect(enabled.params).toMatchObject({ falIcLightV2InitialLatent: 'Right' })
    expect(enabled.prompt).toContain('rim light from the top-left')
    expect(enabled.prompt).toContain('keep it secondary to the key light')
    const disabled = buildRelightEditorDraft({}, {
      ...settings, manual: { ...settings.manual, rimDirection: 'off' },
    }, models)
    expect(disabled.params).toEqual(enabled.params)
    expect(disabled.prompt).toContain('no additional rim light request')
    expect(disabled.prompt).not.toContain('rim light from the top-left')
  })

  it('确认前把设置、路由、提示词和模型参数写入同一草稿', () => {
    const settings = normalizeRelightSettings({
      ...DEFAULT_RELIGHT_SETTINGS,
      manual: {
        ...DEFAULT_RELIGHT_SETTINGS.manual,
        keyDirection: 'right',
        brightness: 1,
      },
    })
    const draft = buildRelightEditorDraft({ mediaInputs: { image: ['source.png'] } }, settings, models)
    expect(draft).toMatchObject({
      modelId: 'fal-ai-ic-light-v2',
      promptTemplateVersion: 'relight-manual-iclight-v1',
      params: { falIcLightV2InitialLatent: 'Right' },
      lightingReferenceImages: [],
      relightSettings: settings,
    })
    expect(String(draft.prompt)).toContain('brighter illumination')
  })

  it('切换模式保留非激活设置并只把一张光照参考图交给智能路由', () => {
    const settings = normalizeRelightSettings({
      ...DEFAULT_RELIGHT_SETTINGS,
      lightingMode: 'smart',
      manual: { ...DEFAULT_RELIGHT_SETTINGS.manual, extraPrompt: 'manual draft' },
      smart: {
        ...DEFAULT_RELIGHT_SETTINGS.smart,
        preset: 'neon',
        lightingReferenceImages: ['light.png'],
      },
    })
    const draft = buildRelightEditorDraft({}, settings, models)
    expect(draft.modelId).toBe('fal-ai-gpt-image-2')
    expect(draft.promptTemplateVersion).toBe('relight-smart-gpt-image-2-v1')
    expect(draft.lightingReferenceImages).toEqual(['light.png'])
    expect(draft.relightSettings).toMatchObject({
      manual: { extraPrompt: 'manual draft' },
      smart: { preset: 'neon' },
    })
  })
})
