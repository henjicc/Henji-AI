import { describe, expect, it } from 'vitest'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import { falPresentation } from '@/models/presentation/fal'
import { falGptImage2Model } from '../../../../packages/ai-sdk/src/catalog/fal/gpt-image-2.model'
import { falIcLightV2Model } from '../../../../packages/ai-sdk/src/catalog/fal/ic-light-v2.model'
import {
  DEFAULT_RELIGHT_SETTINGS,
  RELIGHT_MANUAL_TEMPLATE_VERSION,
  RELIGHT_SMART_TEMPLATE_VERSION,
  compileSmartRelightPrompt,
  normalizeRelightSettings,
  prepareRelightGenerationInput,
  prepareRelightRoute,
} from './relightPolicy'

const models = [falIcLightV2Model, falGptImage2Model].map((runtime) => (
  composeModelDefinition(runtime, falPresentation[runtime.meta.id])
))

describe('打光设置与路由契约', () => {
  it('迁移缺失字段、回退未知枚举并拒绝未知版本', () => {
    expect(normalizeRelightSettings({ manual: { brightness: 2, keyDirection: '45deg' } }))
      .toMatchObject({
        relightContractVersion: 1,
        lightingMode: 'manual',
        manual: { brightness: 2, keyDirection: 'none' },
      })
    expect(() => normalizeRelightSettings({ relightContractVersion: 2 }))
      .toThrow(/不支持的打光契约版本/)
  })

  it('保留两模式草稿，生成只读取激活模式', () => {
    const settings = normalizeRelightSettings({
      ...DEFAULT_RELIGHT_SETTINGS,
      lightingMode: 'smart',
      manual: { ...DEFAULT_RELIGHT_SETTINGS.manual, extraPrompt: 'manual only' },
      smart: { ...DEFAULT_RELIGHT_SETTINGS.smart, prompt: 'smart only' },
    })
    expect(compileSmartRelightPrompt(settings)).toContain('smart only')
    expect(compileSmartRelightPrompt(settings)).not.toContain('manual only')
    expect(settings.manual.extraPrompt).toBe('manual only')
  })

  it('手动模式用离散方向字段，亮度色调轮廓光只编译为提示词', () => {
    const settings = normalizeRelightSettings({
      ...DEFAULT_RELIGHT_SETTINGS,
      manual: {
        ...DEFAULT_RELIGHT_SETTINGS.manual,
        keyDirection: 'left',
        brightness: 2,
        colorPreset: 'amber',
        rimDirection: 'top-right',
      },
    })
    const route = prepareRelightRoute(settings, models)
    expect(route).toMatchObject({
      compatible: true,
      mode: 'manual',
      templateVersion: RELIGHT_MANUAL_TEMPLATE_VERSION,
      params: { falIcLightV2InitialLatent: 'Left' },
    })
    expect(route.model?.meta.id).toBe('fal-ai-ic-light-v2')
    expect(route.prompt).toContain('high-key bright illumination')
    expect(route.prompt).toContain('amber key-light tint')
    expect(route.prompt).toContain('top-right image-relative direction')
  })

  it('智能模式固定 GPT Image 2，保留一张参考光照图并使用版本化提示词', () => {
    const settings = normalizeRelightSettings({
      ...DEFAULT_RELIGHT_SETTINGS,
      lightingMode: 'smart',
      smart: {
        preset: 'golden-hour',
        prompt: 'keep the label readable',
        lightingReferenceImages: ['light.png'],
      },
    })
    const route = prepareRelightRoute(settings, models)
    expect(route.model?.meta.id).toBe('fal-ai-gpt-image-2')
    expect(route.templateVersion).toBe(RELIGHT_SMART_TEMPLATE_VERSION)
    expect(route.prompt).toContain('图像 2')
    expect(route.prompt).toContain('golden-hour')
    expect(route.params.falGptImage2Resolution).toBe('medium')
    expect(route.params.falGptImage2NumImages).toBe(1)
  })

  it('显式拒绝多张光照参考图和不可用路由', () => {
    expect(() => normalizeRelightSettings({
      ...DEFAULT_RELIGHT_SETTINGS,
      lightingMode: 'smart',
      smart: {
        ...DEFAULT_RELIGHT_SETTINGS.smart,
        lightingReferenceImages: ['a.png', 'b.png'],
      },
    })).toThrow(/最多支持 1 张/)
    expect(prepareRelightRoute(DEFAULT_RELIGHT_SETTINGS, [])).toMatchObject({
      compatible: false,
      model: null,
    })
  })

  it('无付费地锁定源图、光照参考与最终请求映射', () => {
    const manual = prepareRelightGenerationInput(
      DEFAULT_RELIGHT_SETTINGS,
      models,
      ['source.png'],
    )
    expect(manual.upstream.images).toEqual(['source.png'])
    expect(manual.params.images).toEqual(['source.png'])
    expect(manual.route.model.meta.id).toBe('fal-ai-ic-light-v2')

    const smart = prepareRelightGenerationInput({
      ...DEFAULT_RELIGHT_SETTINGS,
      lightingMode: 'smart',
      smart: {
        ...DEFAULT_RELIGHT_SETTINGS.smart,
        lightingReferenceImages: ['lighting.png'],
      },
    }, models, ['source.png'])
    expect(smart.upstream.images).toEqual(['source.png', 'lighting.png'])
    expect(smart.params.uploadedFilePaths).toEqual(['source.png', 'lighting.png'])
    expect(smart.route.model.meta.id).toBe('fal-ai-gpt-image-2')
    expect(() => prepareRelightGenerationInput(DEFAULT_RELIGHT_SETTINGS, models, []))
      .toThrow(/必须且只能/)
  })
})
