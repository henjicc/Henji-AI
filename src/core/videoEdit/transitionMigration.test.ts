import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDocumentText } from '../documents/envelope'
import { persistenceFormat } from '../persistence/formats'
import { upgradePersistenceContent } from '../persistence/migrations'
import { VIDEO_EDIT_CONTENT_VERSION, VIDEO_EDIT_DOCUMENT_VERSION } from '../persistence/schemaVersions'
import { videoEditDocumentSchema } from './document'
import { evaluateVideoEditKeyframes } from './keyframes'
import { evaluateVideoEditTransitionParams } from './transitionParams'
import { CURATED_TRANSITIONS, MORE_VIDEO_EDIT_TRANSITIONS, isRemovedVideoEditTransition, resolveVideoEditTransitionSource } from './transitionCatalog'
import { migrateVideoEditLibraryCatalog, migrateVideoEditPresetCatalogPreferences } from './libraryCatalogMigration'
import { migrateVideoEditTransitions, migrateRecordingTransitions } from './transitionMigration'
import { VIDEO_EDIT_SOURCE_TRANSITION_KINDS, VIDEO_EDIT_SOURCE_TRANSITION_PARAMS } from './transitionSources'
import { videoEditTransitionSchema, videoEditTransitionRender, VIDEO_EDIT_TRANSITION_PRESETS } from './transitions'
import { applyVideoEditTransitionPairs, sanitizeVideoEditDefaultTransitions, videoEditDefaultTransitionKind } from './transitions'
import { videoEditShaderGraphWarmSpecs } from './shaderGraph/effects'
import { isShaderGraphTransition, shaderGraphTransitionSpec } from './shaderGraph/transitions'

describe('过渡整理的无损迁移与移除容错', () => {
  it('历史默认选择统一为目录 ID，音频偏好保留，创建与重复应用使用目录条目', () => {
    const preferences = sanitizeVideoEditDefaultTransitions({ video: 'gl.WaterDrop', audio: 'constant_gain' })
    expect(preferences).toEqual({ video: 'ripple', audio: 'constant_gain' })
    expect(sanitizeVideoEditDefaultTransitions({ video: 'radial_wipe', audio: 'constant_gain' })).toEqual({ video: 'radial_wipe', audio: 'constant_gain' })
    const raw = JSON.parse(fs.readFileSync('tests/fixtures/video-edit-transitions/before-u12.json', 'utf8'))
    const document = videoEditDocumentSchema.parse({ format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: raw.id, name: raw.name, revision: 0, ...upgradePersistenceContent(persistenceFormat('document.video_edit'), raw.content, raw.kindVersion) as object })
    const sequence = document.sequences.find(value => value.name === 'gl.WaterDrop')!
    const applied = applyVideoEditTransitionPairs({ ...sequence, transitions: [] }, [{ leftClipId: sequence.clips[0].id, rightClipId: sequence.clips[1].id, medium: 'video' }], { kind: medium => videoEditDefaultTransitionKind(preferences, medium), durationFrames: 11 })
    expect(applied.sequence.transitions?.[0]).toMatchObject({ kind: 'ripple' })
    const repeated = applyVideoEditTransitionPairs(applied.sequence, [{ leftClipId: sequence.clips[0].id, rightClipId: sequence.clips[1].id, medium: 'video' }], { kind: medium => videoEditDefaultTransitionKind(preferences, medium), durationFrames: 9 })
    expect(repeated.sequence.transitions?.[0].parameters).toEqual(applied.sequence.transitions?.[0].parameters)
  })

  it('黄金样本里已存的参数键与曲线与来源迁移一致，调整说明不能改写持久键', () => {
    const raw = JSON.parse(fs.readFileSync('tests/fixtures/video-edit-transitions/before-u12.json', 'utf8'))
    const golden = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/document.video_edit/v${VIDEO_EDIT_CONTENT_VERSION}.json`, 'utf8'))
    const migrated = migrateVideoEditTransitions(raw.content) as typeof raw.content
    for (const sequence of migrated.sequences) {
      if (!sequence.id.startsWith('transition-')) continue
      const stored = golden.content.sequences.find((value: { id: string }) => value.id === sequence.id)
      expect(stored?.transitions, sequence.id).toEqual(sequence.transitions)
    }
  })

  it('收藏和评分合并到条目、合并重复偏好，保留未知与已移除引用，不改输入', () => {
    const favorites = { favorites: ['transition:shaders.IrisWipe', 'transition:iris_round', 'transition:shape_wipe', 'effect:gaussian_blur', 'effect:directional_blur', 'effect:blur', 'transition:gl.Bounce', 'preset:mine', 'effect:constructor'], presets: [] }
    const original = structuredClone(favorites)
    expect(migrateVideoEditLibraryCatalog(favorites)).toEqual({ favorites: ['transition:shape_wipe', 'effect:blur', 'transition:gl.Bounce', 'preset:mine', 'effect:constructor'], presets: [] })
    expect(favorites).toEqual(original)
    const ratings = [{ category: 'transition', id: 'shaders.IrisWipe', rating: 2, isDefault: true }, { category: 'transition', id: 'shape_wipe', rating: 5, isDefault: false }, { category: 'effect', id: 'lens_blur', rating: 3, isDefault: false }, { category: 'text', id: 'lens_blur', rating: 4, isDefault: false }]
    const before = structuredClone(ratings)
    expect(migrateVideoEditPresetCatalogPreferences(ratings)).toEqual([{ category: 'transition', id: 'shape_wipe', rating: 5, isDefault: true }, { category: 'effect', id: 'lens_blur', rating: 3, isDefault: false }, ratings[3]])
    expect(ratings).toEqual(before)
    expect(migrateVideoEditPresetCatalogPreferences([{ category: 'transition', id: 'iris_round' }, { category: 'transition', id: 'shaders.IrisWipe', rating: 5 }])).toEqual([{ category: 'transition', id: 'shape_wipe', rating: 5, isDefault: false }])
    for (const category of ['effect', 'text']) for (const id of ['lens_blur', 'blur', 'effect:shaders.Blur', 'transition:iris_round']) {
      const personal = [{ category, id, rating: 4, isDefault: false }, { category, id, rating: 2, isDefault: false }]
      expect(migrateVideoEditPresetCatalogPreferences(personal)).toEqual(personal)
    }
  })

  it('正式逐版本入口在音频库迁移之后合并收藏，保留音频风格件和个人预设评分', () => {
    const previous = JSON.parse(fs.readFileSync('tests/fixtures/persistence/video-effect-library/v4.json', 'utf8'))
    const library = { ...previous.content, favorites: [...previous.content.favorites, 'transition:iris_round', 'transition:shaders.IrisWipe', 'effect:gaussian_blur', 'effect:directional_blur', 'transition:gl.Bounce', 'preset:gaussian_blur'] }
    const before = structuredClone(library)
    const migrated = upgradePersistenceContent(persistenceFormat('video-effect-library'), library, 4) as typeof library
    expect(migrated.presets).toEqual(previous.content.presets)
    expect(migrated.favorites).toEqual([...previous.content.favorites, 'transition:shape_wipe', 'effect:blur', 'transition:gl.Bounce', 'preset:gaussian_blur'])
    expect(library).toEqual(before)
    const preferences = [{ category: 'transition', id: 'shaders.IrisWipe', rating: 2 }, { category: 'transition', id: 'iris_round', rating: 5, isDefault: true }, { category: 'effect', id: 'gaussian_blur', rating: 4 }]
    expect(upgradePersistenceContent(persistenceFormat('preset-preferences'), preferences, 1)).toEqual([{ category: 'transition', id: 'shape_wipe', rating: 5, isDefault: true }, { category: 'effect', id: 'gaussian_blur', rating: 4, isDefault: false }])
  })

  it('同一目录项的不同着色器方式均预热，相同结构只编译一次', () => {
    const specs = videoEditShaderGraphWarmSpecs([{ clips: [], transitions: ['reveal', 'diamond', 'reveal'].map(mode => ({ kind: 'shape_wipe', parameters: { mode } })) }], (kind, params) => {
      const source = resolveVideoEditTransitionSource(kind, params ?? {})
      return source && isShaderGraphTransition(source.kind) ? shaderGraphTransitionSpec(source.kind) : undefined
    })
    expect(specs.map(spec => spec.layers[1].type).sort()).toEqual(['DiamondWipe', 'IrisWipe'])
  })
  it('每个来源的参数、缺省值与贝塞尔动画换名后仍交给同一个实现，迁移不改输入', () => {
    for (const kind of VIDEO_EDIT_SOURCE_TRANSITION_KINDS) {
      if (isRemovedVideoEditTransition(kind)) continue
      const definitions = VIDEO_EDIT_SOURCE_TRANSITION_PARAMS[kind]
      const parameters = Object.fromEntries(definitions.map(param => [param.key, param.type === 'number' ? param.min + (param.max - param.min) * .37 : param.default]))
      const animated = definitions.find(param => param.type === 'number' && param.animatable !== false)
      const points = animated?.type === 'number' ? [{ time: 0, value: animated.min, interpolation: 'bezier' as const, bezier: [1 / 3, 0, 2 / 3, 0] as [number, number, number, number] }, { time: 10, value: animated.max, interpolation: 'linear' as const }] : undefined
      for (const partial of [true, false]) {
        const old = { id: kind, kind, durationFrames: 11, leftClipId: 'left', alignment: 'custom' as const, framesBeforeCut: 3, ...(partial ? {} : { parameters }), ...(animated && points ? { frameCurves: { [animated.key]: points } } : {}) }
        const input = { sequences: [{ transitions: [old] }], scenes: [{ transitions: [old] }] }
        const before = structuredClone(input)
        const migrated = migrateVideoEditTransitions(input) as typeof input
        expect(input).toEqual(before)
        expect(migrated.scenes).toEqual(before.scenes)
        const transition = videoEditTransitionSchema.parse(migrated.sequences[0].transitions[0])
        const render = videoEditTransitionRender({ transition, start: 0, end: 11 }, 5)
        expect(render.kind, kind).toBe('builtin')
        if (render.kind !== 'builtin') throw new Error(kind)
        expect(render.input.kind, kind).toBe(kind)
        const expected = Object.fromEntries(definitions.map(param => [param.key, animated?.key === param.key && points ? evaluateVideoEditKeyframes(points, 5, param.default) : partial ? param.default : parameters[param.key]]))
        expect(render.input.params, `${kind}, partial=${partial}`).toEqual(expected)
        expect(transition).toMatchObject({ id: kind, durationFrames: 11, leftClipId: 'left', alignment: 'custom', framesBeforeCut: 3 })
      }
    }
  })

  it('历史黄金工程及录制基线能读取，移除项原样保留并在双侧和单侧按同时长交叉溶解', () => {
    const envelope = parseDocumentText(fs.readFileSync('tests/fixtures/video-edit-transitions/before-u12.json', 'utf8'))
    const document = videoEditDocumentSchema.parse({ format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: envelope.id, name: envelope.name, revision: 0, ...upgradePersistenceContent(persistenceFormat('document.video_edit'), envelope.content, envelope.kindVersion) as object })
    const raw = JSON.parse(fs.readFileSync('tests/fixtures/video-edit-transitions/before-u12.json', 'utf8')) as { content: { sequences: unknown[] } }
    const migrated = migrateVideoEditTransitions(raw.content)
    expect(migrateRecordingTransitions({ scriptCapture: { baselines: [{ content: raw.content }] }, data: raw.content })).toEqual({ scriptCapture: { baselines: [{ content: migrated }] }, data: raw.content })
    for (const sequence of document.sequences) for (const transition of sequence.transitions ?? []) {
      if (!isRemovedVideoEditTransition(transition.kind)) continue
      const original = videoEditTransitionSchema.parse((raw.content.sequences as Array<{ transitions: unknown[] }>).find(value => (value.transitions[0] as { id: string }).id === transition.id)!.transitions[0])
      expect(transition).toEqual(original)
      for (const side of [undefined, 'in', 'out'] as const) {
        const window = { transition, start: 0, end: transition.durationFrames, side }
        expect(videoEditTransitionRender(window, 5)).toEqual(videoEditTransitionRender({ ...window, transition: { ...transition, kind: 'cross_dissolve', parameters: undefined, frameCurves: undefined } }, 5))
      }
    }
  })

  it('目录共用登记，来源只以方式出现，更多保留，删除项不可发现，当前方式都有可用实现', () => {
    const entries = new Set(VIDEO_EDIT_TRANSITION_PRESETS.map(value => value.kind))
    for (const kind of MORE_VIDEO_EDIT_TRANSITIONS) expect(entries.has(kind)).toBe(true)
    for (const kind of VIDEO_EDIT_SOURCE_TRANSITION_KINDS) {
      if (isRemovedVideoEditTransition(kind)) expect(entries.has(kind)).toBe(false)
      else expect(entries.has(kind) || CURATED_TRANSITIONS.some(entry => entry.variants.some(variant => variant[2] === kind)), kind).toBe(true)
    }
    for (const entry of CURATED_TRANSITIONS) for (const [mode, , source] of entry.variants) {
      const params = evaluateVideoEditTransitionParams({ kind: entry.kind, parameters: { mode } }, 0)
      expect(resolveVideoEditTransitionSource(entry.kind, params)?.kind).toBe(source)
    }
  })
})
