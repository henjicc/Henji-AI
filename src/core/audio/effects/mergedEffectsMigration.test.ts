import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import baseline from './__fixtures__/merge-baseline.json'
import { AudioEffectChain } from './audioEffectChain'
import { migrateAudioEffectInstance, migrateAudioMergedEffects, migrateAudioEffectLibraryV3, migrateAudioEqualizerModes } from './mergedEffectsMigration'
import { normalizeVideoEditBuiltinParams, requireVideoEditBuiltinEffect } from '../../videoEdit/builtinEffects'
import { PERSISTENCE_FORMATS } from '../../persistence/formats'
import { upgradePersistenceContent } from '../../persistence/migrations'
import { audioEditProjectFromDocument } from '../../audioEdit/documentContent'
import { parseDocumentEnvelope } from '../../documents/envelope'
import { assertVideoEditBuiltinCurves } from '../../videoEdit/keyframes'
import { audioBuiltinIdentity } from './audioIdentity'
import type { RecordingDocument } from '../../screenRecording/document'
import type { VideoEditEffectPreset } from '../../videoEdit/effectPresets'

describe('音频效果合并迁移', () => {
  it('三个正式容器的历史黄金样本逐版本升级，覆盖每个来源 ID 与全部持久位置，原件不变', () => {
    for (const kind of ['video_edit', 'screen_recording', 'audio_edit']) {
      const source = JSON.parse(fs.readFileSync(`tests/fixtures/audio-effect-merge/${kind}.json`, 'utf8'))
      parseDocumentEnvelope(source)
      const before = structuredClone(source)
      const format = PERSISTENCE_FORMATS.find(value => value.id === `document.${kind}`)!
      const migrated = upgradePersistenceContent(format, source.content, source.kindVersion)
      const expected = migrateAudioEqualizerModes(migrateAudioMergedEffects(source.content))
      expect(migrated).toEqual(expected)
      expect(format.schema.safeParse(migrated).success).toBe(true)
      expect(source).toEqual(before)
      if (kind === 'audio_edit') expect(audioEditProjectFromDocument({ id: source.id, name: source.name, createdAt: 0, updatedAt: 0, revision: 0 }, migrated).project.effectChain).toHaveLength(baseline.length / 2)
      const current = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/document.${kind}/v${format.version}.json`, 'utf8'))
      parseDocumentEnvelope(current)
      const assertVideoSample = (actual: Record<string, unknown>, expected: Record<string, unknown>): void => {
        const { sequences: expectedSequences, ...expectedRest } = expected
        const { sequences: actualSequences, ...actualRest } = actual
        // 最新黄金样本的作者接口和源码独立演进；音频所在的其他字段与风格件必须逐项保持。
        const withoutAuthorSources = (value: Record<string, unknown>): Record<string, unknown> => ({ ...value, codeMaterials: undefined, styles: (value.styles as Array<{ sample: Record<string, unknown> }> | undefined)?.map(style => ({ ...style, sample: { ...style.sample, code: undefined } })) })
        expect(withoutAuthorSources(actualRest)).toEqual(withoutAuthorSources(expectedRest))
        expect(actualSequences).toEqual(expect.arrayContaining(expectedSequences as unknown[]))
      }
      // 当前黄金样本还携带其他领域的案例；音频来源里的每条序列必须完整保留。
      if (kind === 'video_edit') assertVideoSample(current.content, migrated as Record<string, unknown>)
      else if (kind === 'screen_recording') {
        const recording = migrated as RecordingDocument
        expect({ ...current.content, scriptCapture: undefined }).toEqual({ ...recording, scriptCapture: undefined })
        expect({ ...current.content.scriptCapture, baselines: undefined }).toEqual({ ...recording.scriptCapture, baselines: undefined })
        expect(current.content.scriptCapture.baselines).toHaveLength(recording.scriptCapture.baselines.length)
        current.content.scriptCapture.baselines.forEach((baseline: { content: Record<string, unknown> }, index: number) => {
          const expected = recording.scriptCapture.baselines[index]
          expect({ ...baseline, content: undefined }).toEqual({ ...expected, content: undefined })
          assertVideoSample(baseline.content, expected.content)
        })
      } else expect(current.content).toEqual(migrated)
    }
  })

  it('旧剪辑预设包升级后仍是音频预设，保留全部参数曲线；方式不接受关键帧', () => {
    const source = JSON.parse(fs.readFileSync('tests/fixtures/audio-effect-merge/preset_package.json', 'utf8'))
    const format = PERSISTENCE_FORMATS.find(value => value.id === 'video-preset-package')!
    const migrated = upgradePersistenceContent(format, source, source.version)
    expect(migrated).toEqual({ ...migrateAudioEqualizerModes(migrateAudioMergedEffects(source)), version: format.version })
    const current = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/video-preset-package/v${format.version}.json`, 'utf8'))
    expect(current).toEqual(migrated)
    expect(() => assertVideoEditBuiltinCurves({ id: 'modulation', curves: { mode: [{ time: 0, value: 'phaser', interpolation: 'hold' }] } })).toThrow('不支持关键帧')
  })

  it('全局库、风格库与风格包中的音频风格件同步迁移旋钮目标，控制点不变', () => {
    for (const [id, file] of [['video-effect-library', 'effect_library'], ['video-style-library', 'style_library'], ['video-style-package', 'style_package']]) {
      const source = JSON.parse(fs.readFileSync(`tests/fixtures/audio-effect-merge/${file}.json`, 'utf8'))
      const before = structuredClone(source)
      const format = PERSISTENCE_FORMATS.find(value => value.id === id)!
      const migrated = upgradePersistenceContent(format, source.content, source.version)
      expect(migrated).toEqual(migrateAudioEqualizerModes(id === 'video-effect-library' ? migrateAudioEffectLibraryV3(source.content) : migrateAudioMergedEffects(source.content)))
      const current = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/${id}/v${format.version}.json`, 'utf8'))
      if (id === 'video-effect-library') {
        const library = migrated as { favorites: string[]; presets: VideoEditEffectPreset[] }
        expect({ ...current.content, favorites: undefined }).toEqual({ ...library, favorites: undefined })
        expect(current.content.favorites).toEqual(expect.arrayContaining(library.favorites))
      } else expect(current.content).toEqual(migrated)
      const piece = id === 'video-effect-library' ? current.content.presets[0] : id === 'video-style-library' ? current.content.effectPresets[0] : current.content.style.effectPresets[0]
      expect(piece.knobs[0].mappings.map((mapping: { parameter: string }) => mapping.parameter)).toEqual(['chorus_depth', 'multi_low_amount'])
      expect(source).toEqual(before)
    }
  })

  it('每个来源的默认与非默认参数迁移后，真实 DSP 输出逐位相同，延迟不变', async () => {
    for (const sample of baseline) {
      const { builtin } = migrateAudioEqualizerModes({ builtin: migrateAudioEffectInstance({ id: sample.id, params: sample.params }) })
      normalizeVideoEditBuiltinParams(builtin.id, builtin.params)
      const chain = new AudioEffectChain(48000, 2)
      await chain.sync([{ id: 'test', builtin, amount: .73 }])
      chain.locate(12345)
      const pcm = [0, 1].map(channel => Float32Array.from({ length: 96000 }, (_, i) => .28 * Math.sin((i + channel * 7) * .071) + .11 * Math.cos(i * .013) + (i % 4801 === 0 ? .5 : 0)))
      chain.process(pcm, pcm[0].length)
      const hash = createHash('sha256'); pcm.forEach(lane => hash.update(new Uint8Array(lane.buffer)))
      expect(hash.digest('hex'), `${sample.id}/${sample.variant}`).toBe(sample.hash)
      expect(chain.latency).toBe(sample.latency)
      expect(chain.preroll).toBeGreaterThanOrEqual(sample.preroll)
      chain.dispose()
    }
  })

  it('嵌套链、曲线及贝塞尔锚点只改键；保留顺序、开关、强度、自定义名字和未知字段，不修改输入且可重复读取', () => {
    const curve = [{ time: 17, value: 41, interpolation: 'bezier', bezier: [.2, .3, .7, .8], easeValues: [2, 90], source: 'user' }]
    const effect = { id: 'user-slot', name: '我的和声', enabled: false, amount: .37, extra: { keep: true }, builtin: { id: 'chorus', params: { rate: .45, extra: 'keep' }, curves: { depth: curve } } }
    const input = { effectChain: [effect], sequences: [{ clips: [{ effects: [effect] }], tracks: [{ effects: [effect] }], master: { effects: [effect] } }], scriptCapture: { baselines: [{ snapshot: { effects: [effect] } }] } }
    const before = structuredClone(input)
    const migrated = migrateAudioMergedEffects(input)
    const expected = { ...effect, builtin: { id: 'modulation', params: { mode: 'chorus', chorus_rate: .45, chorus_depth: 40, chorus_voices: 2, chorus_mix: 40, chorus_extra: 'keep' }, curves: { chorus_depth: curve } } }
    for (const effect of [migrated.effectChain[0], migrated.sequences[0].clips[0].effects[0], migrated.sequences[0].tracks[0].effects[0], migrated.sequences[0].master.effects[0], migrated.scriptCapture.baselines[0].snapshot.effects[0]]) {
      expect({ ...effect, builtin: audioBuiltinIdentity(effect.builtin) }).toEqual(expected)
      expect(audioBuiltinIdentity(effect.builtin, 'audio-merge')).toEqual(input.effectChain[0].builtin)
    }
    expect(input).toEqual(before)
    expect(migrateAudioMergedEffects(migrated)).toEqual(migrated)
  })


  it('简易方式迁移保留曲线与混合强度，已混用两组均衡的工程保持原处理顺序', async () => {
    const curve = [{ time: 0, value: 2, interpolation: 'linear' }, { time: 10, value: 5, interpolation: 'linear' }]
    const input = { effects: [{ id: 'eq', amount: .37, builtin: { id: 'equalizer', params: { mode: 'parametric', simple_low: 3 }, curves: { simple_low: curve } } }] }
    const migrated = migrateAudioEqualizerModes(input)
    expect(migrated.effects[0].builtin).toMatchObject({ params: { mode: 'simple', simple_low: 3 }, curves: { simple_low: curve } })
    expect(migrated.effects[0].amount).toBe(.37)
    expect(input.effects[0].builtin.params.mode).toBe('parametric')
    expect(migrateAudioEqualizerModes(migrated)).toEqual(migrated)
    const mixed = structuredClone(input)
    Object.assign(mixed.effects[0].builtin.params, { low_gain: 4 })
    expect(migrateAudioEqualizerModes(mixed).effects[0].builtin.params.mode).toBe('combined')
    const sparse = { builtin: { id: 'equalizer', params: { low_gain: 6 } } }
    expect(migrateAudioEqualizerModes(sparse).builtin.params).toEqual({ mode: 'parametric', low_gain: 6 })
    const sparseCurve = { builtin: { id: 'equalizer', params: {}, curves: { low_gain: curve } } }
    expect(migrateAudioEqualizerModes(sparseCurve).builtin.params).toEqual({ mode: 'parametric' })
    for (const source of baseline.filter(sample => ['parametric_eq', 'eq_bands', 'graphic_eq'].includes(sample.id))) {
      const effect = migrateAudioEqualizerModes({ id: 'eq', amount: .73, builtin: migrateAudioEffectInstance({ id: source.id, params: source.params }) })
      const chain = new AudioEffectChain(48000, 2)
      await chain.sync([effect]); chain.locate(12345)
      const pcm = [0, 1].map(channel => Float32Array.from({ length: 96000 }, (_, i) => .28 * Math.sin((i + channel * 7) * .071) + .11 * Math.cos(i * .013) + (i % 4801 === 0 ? .5 : 0)))
      chain.process(pcm, pcm[0].length)
      const hash = createHash('sha256'); pcm.forEach(lane => hash.update(new Uint8Array(lane.buffer)))
      expect(hash.digest('hex'), source.id).toBe(source.hash)
      chain.dispose()
    }
  })

  it('简易切到参数方式后隐藏的简易增益不发声，参数方式只展示参数方式的控件', async () => {
    const definition = requireVideoEditBuiltinEffect('equalizer')
    const simple = definition.params.find(param => param.key === 'simple_low')!
    const parametric = definition.params.find(param => param.key === 'low_gain')!
    expect(simple.visibleWhen).toEqual({ param: 'mode', in: ['simple', 'combined'] })
    expect(parametric.visibleWhen).toEqual({ param: 'mode', in: ['parametric', 'combined'] })
    const chain = new AudioEffectChain(48000, 2)
    await chain.sync([{ id: 'eq', amount: 1, builtin: { id: 'equalizer', params: { mode: 'simple', simple_low: 6 } } }])
    const input = Float32Array.from({ length: 4800 }, (_, i) => .3 * Math.sin(i * .005))
    const boosted = [input.slice(), input.slice()]; chain.process(boosted, input.length)
    expect(boosted[0]).not.toEqual(input)
    expect(await chain.sync([{ id: 'eq', amount: 1, builtin: { id: 'equalizer', params: { mode: 'parametric', simple_low: 6 } } }])).toBe(true)
    const neutral = [input.slice(), input.slice()]; chain.process(neutral, input.length)
    expect(neutral[0]).toEqual(input)
    chain.dispose()
  })

  it('播放时切换方式会重建并重新预读；同一方式调参数保留处理状态', async () => {
    const chain = new AudioEffectChain(48000, 2)
    const effect = (mode: string, rate = .8) => [{ id: 'mod', amount: 1, builtin: { id: 'modulation', params: { mode, chorus_rate: rate } } }]
    expect(await chain.sync(effect('chorus'))).toBe(true)
    chain.nextSample = 100
    expect(await chain.sync(effect('chorus', 1))).toBe(false)
    expect(chain.nextSample).toBe(100)
    expect(await chain.sync(effect('phaser'))).toBe(true)
    expect(chain.nextSample).toBeUndefined()
    chain.dispose()
  })
})
