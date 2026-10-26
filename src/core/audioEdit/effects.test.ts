import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { audioEditDocumentKind } from '../documents/kinds/audioEdit'
import { audioEditEffectChainSchema, audioEditRealtimeEffects, migrateAudioEditEffectsToChain, splitAudioEditChain, type AudioEditChainItem } from './effects'
import { audioEditSourceRecipe } from './regions'

/*
 * 效果控件（有顺序的效果链）：v4 → v5 迁移按旧版实际处理顺序排好（声音不变）、整段处理与边播边算的分界、
 * 录音上的配方只含整段处理的那一段。
 */

const declick: AudioEditChainItem = { id: 'd', kind: 'mouth_declick', enabled: true, sensitivity: 50, analyzed: true, clicks: [{ startFrame: 10, endFrame: 20 }] }
const comp: AudioEditChainItem = { id: 'c', kind: 'builtin', name: '压缩器', enabled: true, amount: 1, builtin: { id: 'compressor', params: { amount: 40, speed: 'normal', makeup: true } } }
const eq: AudioEditChainItem = { id: 'e', kind: 'builtin', name: '参数均衡', enabled: true, amount: 1, builtin: { id: 'eq_bands', params: {} } }

describe('音频编辑效果链', () => {
  it('v4 黄金样本迁到效果链：口水音 → 基本声音 → 效果组，音量与响度进输出；迁移后的内容通过当前严格 schema', () => {
    const v4 = JSON.parse(fs.readFileSync('tests/fixtures/persistence/document.audio_edit/v4.json', 'utf8')).content
    const next = audioEditDocumentKind.migrations[4]!(structuredClone(v4)) as Record<string, unknown>
    for (const key of ['effects', 'effectsBypassed', 'essentialSound', 'mouthClicks', 'processorChain', 'vstEnabled']) expect(next).not.toHaveProperty(key)
    const chain = audioEditEffectChainSchema.parse(next.effectChain)
    expect(chain.map(item => item.kind)).toEqual(['mouth_declick', 'essential', 'builtin'])
    expect(chain[0]).toMatchObject({ enabled: true, analyzed: true, clicks: v4.mouthClicks.clicks })
    const essential = chain[1] as Extract<AudioEditChainItem, { kind: 'essential' }>
    expect(essential.settings).not.toHaveProperty('loudness')
    expect(next.output).toEqual({ volumeDb: 0, loudness: v4.essentialSound.loudness })
  })

  it('V2 这样只有口水音修复的作品：迁移后只有一项去除口水音，没有输出（声音与之前一致）', () => {
    const next = migrateAudioEditEffectsToChain({ vstEnabled: false, processorChain: [], mouthClicks: { enabled: true, sensitivity: 50, clicks: [{ startFrame: 100, endFrame: 200 }] } })
    expect(next.effectChain).toEqual([{ id: 'migrated-mouth-declick', kind: 'mouth_declick', enabled: true, sensitivity: 50, analyzed: true, clicks: [{ startFrame: 100, endFrame: 200 }] }])
    expect(next).not.toHaveProperty('output')
    expect(migrateAudioEditEffectsToChain({ vstEnabled: false })).not.toHaveProperty('effectChain')
  })

  it('试听时没打开的 VST3 插件迁过来是关着的；打开的迁成开着', () => {
    const off = migrateAudioEditEffectsToChain({ vstEnabled: false, processorChain: [{ id: 'rx-1', enabled: true, parameters: { a: .5 } }] })
    const on = migrateAudioEditEffectsToChain({ vstEnabled: true, processorChain: [{ id: 'rx-1', enabled: true, parameters: { a: .5 } }] })
    expect(off.effectChain).toMatchObject([{ kind: 'plugin', pluginId: 'rx-1', enabled: false, parameters: { a: .5 } }])
    expect(on.effectChain).toMatchObject([{ kind: 'plugin', enabled: true }])
  })

  it('最后一个整段处理的效果及其之前的效果在录音上先处理，之后的实时效果边播边算；整体关闭时都不处理', () => {
    const project = { effectChain: [comp, declick, eq] }
    expect(splitAudioEditChain(project)).toEqual({ rendered: [comp, declick], live: [eq] })
    expect(audioEditRealtimeEffects(project).map(effect => effect.id)).toEqual(['e'])
    expect(splitAudioEditChain({ effectChain: [comp, eq] })).toEqual({ rendered: [], live: [comp, eq] })
    expect(splitAudioEditChain({ effectChain: [comp, declick, eq], chainBypassed: true })).toEqual({ rendered: [], live: [] })
    // 关着的、还没检测到内容的项不算
    expect(splitAudioEditChain({ effectChain: [{ ...declick, enabled: false }, eq] }).live).toEqual([eq])
    expect(splitAudioEditChain({ effectChain: [{ ...declick, clicks: [] }, eq] }).live).toEqual([eq])
  })

  it('录音上的配方只随整段处理的那一段变：改末尾实时效果的参数、换 id 都不重算', () => {
    const base = audioEditSourceRecipe({ effectChain: [declick, eq] })
    expect(audioEditSourceRecipe({ effectChain: [declick, { ...eq, builtin: { id: 'eq_bands', params: { low: 3 } } }] })).toEqual(base)
    expect(audioEditSourceRecipe({ effectChain: [{ ...declick, id: 'other' }, eq] })).toEqual(base)
    expect(audioEditSourceRecipe({ effectChain: [{ ...declick, clicks: [{ startFrame: 10, endFrame: 30 }] }, eq] })).not.toEqual(base)
  })

  it('输出：音量与响度补偿合成一个增益，开了自动匹配时末尾限幅', () => {
    expect(audioEditRealtimeEffects({ output: { volumeDb: -2, loudness: { enabled: true, targetLufs: -16, gainDb: 3.5 } } }).map(effect => [effect.builtin.id, effect.builtin.params.gain])).toEqual([['gain_balance', 1.5], ['limiter', undefined]])
    expect(audioEditRealtimeEffects({ output: { volumeDb: 0 } })).toEqual([])
  })
})
