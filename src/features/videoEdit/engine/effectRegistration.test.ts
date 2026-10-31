import { afterEach, expect, expectTypeOf, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { definePlanner } from './effectPlanner'
import { registerEffects } from '@/core/videoEdit/effectRegistration'
import { assembleEffectShader, COLOR_MATH_BLOCK, EFFECT_SHADER_PRELUDE } from './effectShaderPrelude'
import type { VideoEditBuiltinEffectDefinition } from '@/core/videoEdit/builtinEffects'
import type { EffectPlanner } from './effectPlanner'

afterEach(() => { vi.doUnmock('@/core/videoEdit/effectIndex'); vi.doUnmock('@/core/videoEdit/effectCatalog'); vi.doUnmock('./effectPlannerIndex'); vi.resetModules() })

it('登记索引与有序目录接通规划、入口、精度、预览与三个参数空间', async () => {
  const definition: VideoEditBuiltinEffectDefinition = {
    id: 'registration_fixture', name: '登记夹具', group: 'texture', space: 'layer', stage: 'generator', author: { factory: 'fixture' }, description: '',
    precision: (_params, plan) => plan.passes.some(pass => pass.entry !== 'copy'),
    params: [{ key: 'contour', name: '轮廓来源', type: 'boolean', default: false, description: '', spaces: ['clip'] }, { key: 'enabled', name: '启用', type: 'boolean', default: true, description: '' }, { key: 'local', name: '图层', type: 'boolean', default: false, description: '', spaces: ['layer'] }, { key: 'global', name: '整帧', type: 'boolean', default: false, description: '', spaces: ['frame'] }],
  }
  const registration = {
    id: definition.id, entries: ['registration_fixture'] as const, wgsl: '// registration fixture',
    plan: (params, frame) => ({ ...frame, scratch: [], passes: [{ entry: params.enabled ? 'invert' : 'copy', source: 'input', target: 'output', uniforms: new Float32Array(16) }] }),
  } satisfies EffectPlanner
  vi.doMock('@/core/videoEdit/effectIndex', async importOriginal => ({ ...await importOriginal<object>(), fixture: definition }))
  vi.doMock('@/core/videoEdit/effectCatalog', async importOriginal => {
    const actual = await importOriginal<typeof import('@/core/videoEdit/effectCatalog')>()
    const catalog = [...actual.VIDEO_EDIT_EFFECT_CATALOG, { group: 'texture' as const, ids: [definition.id] }]
    return { ...actual, VIDEO_EDIT_EFFECT_CATALOG: catalog, orderVideoEditEffects: (values: ReadonlyMap<string, VideoEditBuiltinEffectDefinition>) => [...actual.orderVideoEditEffects(new Map([...values].filter(([id]) => id !== definition.id))), definition] }
  })
  vi.doMock('./effectPlannerIndex', async importOriginal => ({ ...await importOriginal<object>(), fixture: registration }))
  const [{ planVideoEditBuiltinEffect }, shaders, { videoEditEffectNeedsFloat }, planners, registry, { resolveAuthorEffects }, { builtinParameterFields }] = await Promise.all([
    import('./videoEditBuiltinEffectPasses'), import('./videoEditBuiltinEffectShaders'), import('./videoEditRenderPrecision'), import('./effectPlanners'), import('@/core/videoEdit/effectsRegistry'), import('@/core/videoEdit/authorEffects'), import('@/components/ui/params/fieldSpec'),
  ])
  const frame = { width: 1920, height: 1080, frame: 0, referenceSize: { width: 1920, height: 1080 }, renderScale: 1 }
  expect(planVideoEditBuiltinEffect({ id: definition.id, params: {} }, frame).passes[0].entry).toBe('invert')
  expect(shaders.VIDEO_EDIT_BUILTIN_EFFECT_ENTRIES).toContain('registration_fixture')
  expect(shaders.VIDEO_EDIT_BUILTIN_EFFECT_SHADER).toContain(registration.wgsl)
  expect(videoEditEffectNeedsFloat({ id: definition.id, params: {} }, frame)).toBe(true)
  expect(videoEditEffectNeedsFloat({ id: definition.id, params: { enabled: false } }, frame)).toBe(false)
  expect(planners.VIDEO_EDIT_EFFECT_PREVIEW_DEFINITIONS.some(value => value.id === definition.id)).toBe(true)
  expect(registry.videoEditEffectsRegistry().find(value => value.builtinId === definition.id)?.category).toBe('generator')
  expect(builtinParameterFields(definition.params, 'layer').map(value => value.key)).toEqual(['enabled', 'local'])
  expect(builtinParameterFields(definition.params).map(value => value.key)).toEqual(['contour', 'enabled'])
  expect(() => resolveAuthorEffects([{ id: definition.id, params: { contour: true } }])).toThrow('只能用于片段')
  expect(resolveAuthorEffects([{ id: definition.id }])[0].params.enabled).toBe(true)
  const frameEffects = resolveAuthorEffects([{ id: definition.id }], {}, 0, 'grade', 'frame')
  expect(frameEffects[0].params).toEqual({ enabled: true, global: false })
  expect(() => resolveAuthorEffects([{ id: definition.id, params: { local: true } }], {}, 0, 'grade', 'frame')).toThrow('只能用于图层')
  const { normalizeVideoEditBuiltinParams } = await import('@/core/videoEdit/builtinEffects')
  for (const key of ['local', 'global']) expect(() => normalizeVideoEditBuiltinParams(definition.id, { [key]: true })).toThrow('只能用于')
  expect(() => normalizeVideoEditBuiltinParams(definition.id, {}, { local: true })).toThrow('只能用于')
  expect(normalizeVideoEditBuiltinParams(definition.id)).not.toHaveProperty('local')
  const { authorEffectDiagnostics } = await import('./videoEditAuthorEffectDiagnostics')
  const source = ts.createSourceFile('spaces.ts', 'import { fixture } from "henji-effects"; const changing = Math.random(); fixture({ contour: changing }); const layer = { effects: () => [{ id: "registration_fixture", params: { contour: false } }] };', ts.ScriptTarget.Latest, true)
  const host = ts.createCompilerHost({ noLib: true }); host.getSourceFile = name => name === source.fileName ? source : undefined
  const program = ts.createProgram([source.fileName], { noLib: true }, host)
  expect(authorEffectDiagnostics(source, program.getTypeChecker()).filter(value => value.message.includes('只能用于片段'))).toHaveLength(2)
  const { validateVideoEditLook, resolveVideoEditLookByName } = await import('@/core/videoEdit/authorEffects')
  const preset = { id: 'piece', name: '空间夹具', media: 'video' as const, effects: [{ id: 'member', name: '', enabled: false, amount: 0, builtin: { id: definition.id, params: {}, curves: { contour: [{ time: 0, value: false, interpolation: 'hold' as const }] } } }] }
  expect(() => validateVideoEditLook(preset)).toThrow('只能用于片段')
  expect(() => validateVideoEditLook(preset, 'frame')).toThrow('只能用于片段')
  expect(() => resolveVideoEditLookByName(preset.name, { presets: [preset] })).toThrow('只能用于片段')
  const explicit = { ...preset, effects: [{ ...preset.effects[0], builtin: { id: definition.id, params: { contour: true } } }] }
  expect(() => resolveVideoEditLookByName(explicit.name, { presets: [explicit] })).toThrow('只能用于片段')
  expect(() => resolveAuthorEffects([{ id: 'look', params: { name: explicit.name } }], { presets: [explicit] }, 0, 'grade', 'frame')).toThrow('只能用于片段')
})

it('定义与规划索引拒绝重复 id，错误指出两处导出来源', async () => {
  for (const module of ['@/core/videoEdit/effectIndex', './effectPlannerIndex']) {
    vi.doMock(module, async importOriginal => { const actual = await importOriginal<Record<string, { id: string } | readonly { id: string }[]>>(); return { ...actual, duplicate: Object.values(actual).flat()[0] } })
    await expect(module.includes('effectIndex') ? import('@/core/videoEdit/builtinEffects') : import('./effectPlanners')).rejects.toThrow(/重复登记：.+\[0\].+duplicate\[0\]/)
    vi.doUnmock(module); vi.resetModules()
  }
  expect(() => registerEffects({ first: [{ id: 'same' }], second: { id: 'same' } })).toThrow('first[0] 与 second[0]')
})

it('定义、助手与面板组内顺序来自目录且每个登记 id 恰好覆盖一次', async () => {
  const { VIDEO_EDIT_EFFECT_CATALOG, orderVideoEditEffects } = await import('@/core/videoEdit/effectCatalog')
  const { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, requireVideoEditBuiltinEffect } = await import('@/core/videoEdit/builtinEffects')
  const { VIDEO_EDIT_BUILTIN_EFFECTS } = await import('@/core/videoEdit/effectsRegistry')
  const ids = VIDEO_EDIT_EFFECT_CATALOG.flatMap(group => group.ids)
  expect(VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.map(value => value.id)).toEqual(ids)
  expect(VIDEO_EDIT_BUILTIN_EFFECTS.map(value => value.builtinId)).toEqual(ids)
  expect(new Set(ids).size).toBe(ids.length)
  const reversed = new Map([...VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS].reverse().map(value => [value.id, value]))
  expect(orderVideoEditEffects(reversed).map(value => value.id)).toEqual(ids)
  expect(() => orderVideoEditEffects(new Map([...reversed, ['unlisted', { ...VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS[0], id: 'unlisted' }]]))).toThrow('缺少：unlisted')
  expect(() => requireVideoEditBuiltinEffect('missing')).toThrow(`可用：${ids.join('、')}`)
})

it('共享块按名字只拼一次，冲突立即报出块名；入口不写 as const 仍保留字面量', () => {
  const shader = assembleEffectShader([...EFFECT_SHADER_PRELUDE, { ...COLOR_MATH_BLOCK }])
  expect(shader.split(COLOR_MATH_BLOCK.wgsl)).toHaveLength(2)
  expect(() => assembleEffectShader([COLOR_MATH_BLOCK, { ...COLOR_MATH_BLOCK, wgsl: 'different' }])).toThrow('color-math')
  const planner = definePlanner({ id: 'typed', entries: ['typed_entry'], plan: () => ({ width: 1, height: 1, scratch: [], passes: [] }) })
  expectTypeOf<typeof planner.entries[number]>().toEqualTypeOf<'typed_entry'>()
  // @ts-expect-error 未登记入口不能混入规划的入口集合。
  const invalid: typeof planner.entries[number] = 'unregistered'
  expect(invalid).toBe('unregistered')
})

it('逐个独立导入索引中的定义模块，不依赖 builtinEffects 先初始化', async () => {
  const modules = import.meta.glob<Record<string, unknown>>(['/src/core/videoEdit/*.ts', '/src/core/videoEdit/shaderGraph/effects.ts', '/src/core/audio/effects/audioEffectDefinitions.ts'])
  const index = readFileSync(new URL('../../../core/videoEdit/effectIndex.ts', import.meta.url), 'utf8')
  for (const [, relative] of index.matchAll(/from '([^']+)'/g)) {
    vi.resetModules()
    const module = path.posix.normalize(`/src/core/videoEdit/${relative}.ts`)
    expect(modules[module], module).toBeTypeOf('function')
    expect(Object.keys(await modules[module]()).length, module).toBeGreaterThan(0)
  }
})

it('规划随帧号变化的效果必须声明 frameSeed，种子相同的帧规划相同', async () => {
  const [{ planVideoEditBuiltinEffect }, { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, videoEditBuiltinDefaults }, { VIDEO_EDIT_EFFECT_PLANNER_BY_ID }] = await Promise.all([
    import('./videoEditBuiltinEffectPasses'), import('@/core/videoEdit/builtinEffects'), import('./effectPlanners'),
  ])
  const layer = { referenceSize: { width: 64, height: 36 }, contentBounds: { x: 0, y: 0, width: 48, height: 24 }, rasterScale: 1, rasterOrigin: [8, 6] as const, quality: 'final' as const }
  const frames = [0, 1, 2, 5, 6, 7, 30, 31, 997]
  for (const definition of VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.filter(value => VIDEO_EDIT_EFFECT_PLANNER_BY_ID.has(value.id))) {
    const params = videoEditBuiltinDefaults(definition)
    for (const context of definition.space === 'layer' ? [undefined, layer] : [undefined]) {
      const plans = frames.map(frame => planVideoEditBuiltinEffect({ id: definition.id, params }, { width: 64, height: 36, frame, ...(context ? { layer: context } : {}) }))
      const seeds = frames.map(frame => definition.frameSeed?.(params, frame) ?? 0)
      // 没有声明的效果所有帧同种子；声明了的，同种子的帧必须得到同一份规划，否则复用键会拿到别的帧的画面。
      frames.forEach((_frame, index) => expect(plans[index], `${definition.id} 第 ${frames[index]} 帧`).toEqual(plans[seeds.indexOf(seeds[index])]))
    }
  }
})
