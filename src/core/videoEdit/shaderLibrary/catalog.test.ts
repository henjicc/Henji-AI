import { describe, expect, it } from 'vitest'
import { SHADER_BACKGROUND_NAMES, SHADER_EFFECT_DEFINITIONS, SHADER_TRANSITION_DEFINITIONS, SHADER_TRANSITION_PARAM_DEFINITIONS } from './catalog'
import { describeVideoEditBuiltinEffect, normalizeVideoEditBuiltinParams } from '../builtinEffects'
import { videoEditEffectsRegistry } from '../effectsRegistry'
import { describeVideoEditTransitionKind, videoEditTransitionSchema } from '../transitions'
import { videoEditEffectSchema } from '../compositing'
import { evaluateVideoEditBuiltinParameters } from '../keyframes'
import { createVideoEditDocument, createVideoEditSequence, videoEditDocumentSchema } from '../document'

describe('可信着色器目录与现有文档契约', () => {
  it('40项由同一登记向面板/助手投影，参数封闭、有中文语义、单位与动画声明', () => {
    const registry = videoEditEffectsRegistry()
    expect(SHADER_EFFECT_DEFINITIONS.length + SHADER_TRANSITION_DEFINITIONS.length).toBe(40)
    for (const definition of SHADER_EFFECT_DEFINITIONS) {
      const entry = registry.find(entry => entry.builtinId === definition.id)!
      expect(entry.name).toBe(definition.name)
      expect(entry.group).toBe(describeVideoEditBuiltinEffect(definition).group)
      expect(entry.params).toBe(definition.params)
      expect(definition.params.every(param => param.description && param.animatable)).toBe(true)
      expect(() => normalizeVideoEditBuiltinParams(definition.id, { wgsl: 'arbitrary' })).toThrow('没有参数')
      expect(() => normalizeVideoEditBuiltinParams(definition.id, { strength: NaN })).toThrow('需要数字')
      expect(() => normalizeVideoEditBuiltinParams(definition.id, { strength: 101 })).toThrow('超出范围')
    }
    for (const definition of SHADER_TRANSITION_DEFINITIONS) {
      expect(registry.find(entry => entry.transitionKind === definition.kind)?.params).toBe(SHADER_TRANSITION_PARAM_DEFINITIONS[definition.kind])
      expect(describeVideoEditTransitionKind(definition.kind).params).toHaveLength(SHADER_TRANSITION_PARAM_DEFINITIONS[definition.kind].length)
      expect(videoEditTransitionSchema.safeParse({ id: 'tr', kind: definition.kind, leftClipId: 'clip', durationFrames: 20, parameters: { strength: 60 } }).success).toBe(true)
    }
  })
  it('背景放在既有图形片段，效果和数值/颜色关键帧按现有模型保存与求值', () => {
    const id = SHADER_BACKGROUND_NAMES[0]
    const builtin = { id, params: normalizeVideoEditBuiltinParams(id), curves: { strength: [{ time: 0, value: 0, interpolation: 'linear' as const }, { time: 30, value: 100, interpolation: 'linear' as const }] } }
    const effect = videoEditEffectSchema.parse({ id: 'background', name: '着色器背景', amount: 1, enabled: true, builtin })
    expect(evaluateVideoEditBuiltinParameters(builtin, 15).strength).toBe(50)
    const sequence = createVideoEditSequence()
    const document = createVideoEditDocument('着色器测试')
    const graphic = { width: sequence.width, height: sequence.height, objects: [] }
    document.items.push({ id: 'background-item', name: '着色器背景', kind: 'graphic', graphic })
    sequence.clips.push({ id: 'clip', itemId: 'background-item', name: '着色器背景', kind: 'graphic', graphic, effects: [effect], track: sequence.tracks.find(track => track.kind === 'video')!.index, start: 0, duration: 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' })
    document.sequences.push(sequence)
    const restored = JSON.parse(JSON.stringify(document)) as typeof document
    expect(() => videoEditDocumentSchema.parse(restored)).not.toThrow()
    expect(restored.sequences[0].clips[0].effects![0].builtin).toEqual(builtin)
  })
})
