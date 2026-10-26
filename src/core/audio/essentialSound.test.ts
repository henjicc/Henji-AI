import { describe, expect, it } from 'vitest'
import { validateVideoEditBuiltinParams } from '../videoEdit/builtinEffects'
import { defaultEssentialSound, essentialSoundEffects, essentialSoundOfflineStages, ESSENTIAL_SOUND_EQ_PRESETS, ESSENTIAL_SOUND_REVERB_PRESETS, type EssentialSoundSettings } from './essentialSound'

/** 每一项都开到最大，换算出的效果链必须全部是登记过的效果、参数都在范围内。 */
function everything(eq: typeof ESSENTIAL_SOUND_EQ_PRESETS[number], reverb: typeof ESSENTIAL_SOUND_REVERB_PRESETS[number], amount: number): EssentialSoundSettings {
  const on = { enabled: true, amount }
  return {
    type: 'dialogue',
    repair: { noise: on, rumble: on, hum: { ...on, mains: 60 }, deEss: on, reverb: on, isolate: on },
    clarity: { dynamics: on, eq: { ...on, preset: eq }, enhance: { enabled: true, voice: 'high' } },
    creative: { reverb: { ...on, preset: reverb } },
    loudness: { enabled: true, targetLufs: -16, gainDb: 30 },
    volume: { gainDb: 24 },
  }
}

describe('基本声音换算成效果链', () => {
  it('任何预设与量下生成的效果都是登记过的音频效果、参数合法', () => {
    for (const eq of ESSENTIAL_SOUND_EQ_PRESETS) for (const reverb of ESSENTIAL_SOUND_REVERB_PRESETS) for (const amount of [1, 50, 100]) {
      for (const effect of essentialSoundEffects(everything(eq, reverb, amount))) expect(() => validateVideoEditBuiltinParams(effect.builtin.id, effect.builtin.params)).not.toThrow()
    }
  })
  it('按修复 → 透明度 → 创意 → 响度与音量的顺序；响度开着时末尾限幅', () => {
    const ids = essentialSoundEffects(everything('podcast', 'room', 60)).map(effect => effect.builtin.id)
    expect(ids).toEqual(['high_pass', 'dehum', 'noise_reduction', 'de_esser', 'compressor', 'eq_bands', 'vocal_enhancer', 'reverb', 'gain_balance', 'limiter'])
  })
  it('关着或量为 0 的项不进链；只选了类型时声音不变', () => {
    expect(essentialSoundEffects({ type: 'dialogue' })).toEqual([])
    expect(essentialSoundEffects({ type: 'dialogue', repair: { noise: { enabled: true, amount: 0 }, rumble: { enabled: false, amount: 80 } } })).toEqual([])
    expect(essentialSoundEffects(undefined)).toEqual([])
  })
  it('减少混响与人声分离走离线预处理（先分离再去混响），不进实时链', () => {
    const settings = everything('podcast', 'room', 40)
    expect(essentialSoundOfflineStages(settings)).toEqual([{ kind: 'isolate', amount: 0.4 }, { kind: 'dereverb', amount: 0.4 }])
    expect(essentialSoundEffects(settings).some(effect => effect.builtin.id === 'reverb' && effect.id === 'essential:reverb')).toBe(true)
    expect(essentialSoundOfflineStages(defaultEssentialSound('dialogue'))).toEqual([])
  })
})
