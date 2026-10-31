import { expect, it } from 'vitest'
import { parameterVisible } from './parameterVisibility'
import { parseCodeMaterialV3Parameters } from '../videoEdit/codeMaterial/parameterTypes'
import { includedEffectParams } from '../videoEdit/effectIncludes'
import type { VideoEditBuiltinEffectDefinition } from '../videoEdit/builtinEffects'

it('作者与内置参数共用全部满足，包含参数逐项加前缀且保留空间', () => {
  const all = { all: [{ param: 'mode', in: ['lens', 'uniform'] }, { param: 'range', notEquals: 'full' }] }
  const raw = {
    mode: { type: 'choice', title: '方式', default: 'lens', options: ['lens', 'uniform', 'spin'] },
    range: { type: 'choice', title: '范围', default: 'full', options: ['full', 'tilt'] },
    width: { type: 'number', title: '宽度', min: 0, max: 100, step: 1, default: 30, visibleWhen: all },
  }
  const parsed = parseCodeMaterialV3Parameters(raw, {}, 8)
  const condition = parsed.at(-1)!.visibleWhen
  expect(parameterVisible(condition, { mode: 'lens', range: 'tilt' })).toBe(true)
  expect(parameterVisible(condition, { mode: 'spin', range: 'tilt' })).toBe(false)
  expect(parameterVisible(condition, { mode: 'lens', range: 'full' })).toBe(false)
  const effect: VideoEditBuiltinEffectDefinition = { id: 'fixture', name: '夹具', group: 'blur', description: '', params: [{ key: 'width', name: '宽度', description: '', type: 'number', unit: 'percent', min: 0, max: 100, step: 1, default: 30, spaces: ['clip'], visibleWhen: all }] }
  const [included] = includedEffectParams(effect, 'blur', '模糊')
  expect(included.spaces).toEqual(['clip'])
  expect(parameterVisible(included.visibleWhen, { blur_mode: 'lens', blur_range: 'tilt' })).toBe(true)
  expect(parameterVisible(included.visibleWhen, { blur_mode: 'spin', blur_range: 'tilt' })).toBe(false)
  expect(() => parseCodeMaterialV3Parameters(raw, {}, 7)).toThrow('v8')
  for (const visibleWhen of [{ all: [] }, { all: [{ param: 'missing', equals: true }] }, { all: [{ param: 'mode', equals: false }] }, { ...all, param: 'mode' }, { all: [all] }]) {
    expect(() => parseCodeMaterialV3Parameters({ ...raw, width: { ...raw.width, visibleWhen } }, {}, 8)).toThrow()
  }
})
