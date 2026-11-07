import { describe, expect, it } from 'vitest'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import { LinkageEngine } from '@/core/linkage/LinkageEngine'
import { registry } from '@/core/ModelRegistry'
import { modelPresentations } from '@/models/presentation'
import { catalogIndex } from '@henjicc/ai-sdk'

const IDS = ['apimart-wan-2.7-image', 'apimart-flux-3-video', 'fal-flux-3-video', 'groq-orpheus-v1-english', 'groq-orpheus-arabic-saudi']

function compose(id: string) {
  const runtime = catalogIndex.get(id)
  if (!runtime) throw new Error(`SDK catalog 缺少模型: ${id}`)
  return composeModelDefinition(runtime, modelPresentations[id])
}

const values = (options: unknown[]) => options.map(option => (option as { value: unknown }).value)

describe('2026-11-07 新模型展示定义', () => {
  it('展示补丁与运行时定义合成后通过注册约定校验', () => {
    for (const id of IDS) expect(() => registry.register(compose(id))).not.toThrow()
  })

  it('万相 2.7 Image：4K 只在 Pro 非组图文生图可选，组图放宽数量上限', () => {
    const model = compose('apimart-wan-2.7-image')
    const engine = new LinkageEngine(model.linkages ?? [])
    expect(values(engine.getFilteredOptions('apimartWan27ImageResolution', { apimartWan27ImageVariant: 'pro' }, model.params))).toContain('4K')
    expect(values(engine.getFilteredOptions('apimartWan27ImageResolution', { apimartWan27ImageVariant: 'standard' }, model.params))).not.toContain('4K')
    expect(values(engine.getFilteredOptions('apimartWan27ImageResolution', { apimartWan27ImageVariant: 'pro', images: ['a.png'] }, model.params))).not.toContain('4K')
    const reset = engine.execute('apimartWan27ImageVariant', { apimartWan27ImageVariant: 'standard', apimartWan27ImageResolution: '4K' }, model.params)
    expect(reset.apimartWan27ImageResolution).toBe('2K')
    const unset = engine.execute('apimartWan27ImageSequential', { apimartWan27ImageSequential: false, apimartWan27ImageCount: 10 }, model.params)
    expect(unset.apimartWan27ImageCount).toBe(4)
  })

  it('Fal FLUX 3 Video：续写与 Max 只留 720p/1080p', () => {
    const model = compose('fal-flux-3-video')
    const engine = new LinkageEngine(model.linkages ?? [])
    expect(values(engine.getFilteredOptions('falFlux3VideoResolution', {}, model.params))).toEqual(['720p', '1080p', '1440p', '2160p'])
    expect(values(engine.getFilteredOptions('falFlux3VideoResolution', { falFlux3VideoMode: 'extend' }, model.params))).toEqual(['720p', '1080p'])
    const reset = engine.execute('falFlux3VideoVersion', { falFlux3VideoVersion: 'max', falFlux3VideoResolution: '2160p' }, model.params)
    expect(reset.falFlux3VideoResolution).toBe('720p')
  })

  it('Orpheus 音色走音色选择器，只列官方音色', () => {
    const english = compose('groq-orpheus-v1-english').params.find(param => param.id === 'groqOrpheusEnglishVoice') as { panel?: string; config?: { voices: Array<{ id: string }>; allowCustomId?: boolean } }
    expect(english.panel).toBe('voice-selector')
    expect(english.config?.voices.map(voice => voice.id)).toEqual(['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy'])
    expect(english.config?.allowCustomId).toBeUndefined()
  })
})
