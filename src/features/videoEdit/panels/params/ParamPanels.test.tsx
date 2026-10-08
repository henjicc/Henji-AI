// @vitest-environment jsdom
import { cleanup, fireEvent, render, within, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCodeMaterialTypes, parseCodeMaterialV3Parameters, validateCodeMaterialV3ParameterValue } from '@/core/videoEdit/codeMaterial/parameterTypes'
import type { CodeParameterValue } from '@/core/videoEdit/codeMaterial/contract'
import type { VideoEditBuiltinParam } from '@/core/videoEdit/builtinEffects'
import { BLACK_HEX } from '@/core/theme/colorTokens'
import { LUMETRI_BASIC_PARAMS, LUMETRI_POINT_PARAMS } from '@/core/videoEdit/lumetri'
import { VideoEditBuiltinParamRows } from '../VideoEditBuiltinEffectControls'
import { ParamField, type ParamGesture } from './ParamField'
import { ParamList } from './ParamList'
import { builtinParameterFields, codeParameterFields, readBuiltinField, writeBuiltinField, type ParamFieldSpec } from './fieldSpec'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}) })
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 1 } })
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn(); Element.prototype.hasPointerCapture = vi.fn(() => true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const declarations = parseCodeMaterialV3Parameters({
  angle: { type: 'angle', title: '角度', default: 0, min: -180, max: 180 },
  point: { type: 'point', title: '位置', default: { x: .5, y: .5 } },
  range: { type: 'range', title: '区间', default: [.2, .8], min: 0, max: 1, step: .01 },
  gradient: { type: 'gradient', title: '渐变', default: [{ at: 0, color: [0, 0, 0, 1] }, { at: .5, color: [1, 0, 0, .5] }, { at: 1, color: [1, 1, 1, 1] }] },
  curve: { type: 'curve', title: '曲线', default: [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }] },
  grade: { type: 'grade', title: '色轮', default: { hue: 30, strength: .5, luminance: 0 } },
  easing: { type: 'easing', title: '缓动', default: [.2, .3, .8, .9] },
  seed: { type: 'seed', title: '种子', default: 1 },
  font: { type: 'font', title: '字体', default: 'sans-serif' },
}, {})
const fields = codeParameterFields(declarations)
function mountedField(field: ParamFieldSpec) {
  const writes = vi.fn()
  function Host() { const [value, setValue] = useState(field.default); const gesture: ParamGesture = { begin: vi.fn(), finish: vi.fn(), cancel: vi.fn(), active: () => false, write: next => { writes(next); setValue(next as typeof value) }, atomic: next => { writes(next); setValue(next as typeof value) } }; return <ParamField field={field} value={value} gesture={gesture} /> }
  return { view: render(<Host />), writes }
}
describe.each([
  ['angle', '角度'], ['point', '位置'], ['range', '区间起点'], ['gradient', '渐变色标2'], ['curve', '曲线点2'], ['grade', '色轮'], ['easing', '缓动手柄1'],
])('%s 值形状', (key, label) => {
  it('沿同一个控件写回声明可接受的完整值', () => {
    const field = fields.find(field => field.key === key)!
    const { view, writes } = mountedField(field)
    fireEvent.keyDown(view.getByRole('slider', { name: label }), { key: 'ArrowRight' })
    const next = writes.mock.lastCall![0]
    expect(next).not.toEqual(field.default)
    expect(validateCodeMaterialV3ParameterValue(declarations.find(parameter => parameter.key === key)!, next)).toEqual(next)
  })
})
it('种子按 uint32 写回，字体选择走共享字体原件', async () => {
  const { view, writes } = mountedField(fields.find(field => field.key === 'seed')!)
  fireEvent.click(view.getByRole('button', { name: '种子随机生成' })); expect(Number.isInteger(writes.mock.lastCall![0])).toBe(true); expect(writes.mock.lastCall![0]).toBeLessThanOrEqual(4294967295)
  view.unmount()
  const font = mountedField(fields.find(field => field.key === 'font')!)
  fireEvent.click(font.view.getByRole('button', { name: '字体' }))
  fireEvent.click(await font.view.findByRole('option', { name: /系统衬线/ }))
  await waitFor(() => expect(font.writes).toHaveBeenLastCalledWith('serif'))
})

const builtin: VideoEditBuiltinParam[] = [
  { key: 'position_x', name: '位置（水平）', type: 'number', unit: 'percent', min: -100, max: 200, step: .1, default: 50, tooltip: '移动位置', description: 'AI说明' },
  { key: 'position_y', name: '位置（垂直）', type: 'number', unit: 'percent', min: -100, max: 200, step: .1, default: 50, tooltip: '移动位置', description: 'AI说明' },
  { key: 'angle', name: '方向', type: 'number', unit: 'degrees', min: -180, max: 180, step: 1, default: 0, tooltip: '方向说明', description: 'AI说明' },
  { key: 'color', name: '颜色', type: 'color', default: BLACK_HEX, alpha: true, tooltip: '颜色说明', description: 'AI说明' },
]
it('内置位置合成 point，双分量写入一次；角度与半透明颜色正确往返', () => {
  const adapted = builtinParameterFields(builtin); expect(adapted.map(field => field.type)).toEqual(['point', 'angle', 'color'])
  expect(JSON.stringify(adapted)).not.toContain('AI说明')
  const values = { position_x: 50, position_y: 50, angle: 0, color: BLACK_HEX }
  const changes = vi.fn()
  const view = render(<ParamList fields={adapted} values={Object.fromEntries(adapted.map(field => [field.key, readBuiltinField(field, values)]))} renderControl={(field, value) => <ParamField field={field} value={value} gesture={{ begin() {}, finish() {}, cancel() {}, active: () => false, write: next => changes(writeBuiltinField(field, next)), atomic: next => changes(writeBuiltinField(field, next)) }} />} />)
  fireEvent.keyDown(view.getByRole('slider', { name: '位置' }), { key: 'ArrowRight' })
  expect(changes).toHaveBeenCalledTimes(1); expect(changes).toHaveBeenLastCalledWith({ position_x: 50.1, position_y: 50 })
  expect(writeBuiltinField(adapted[2], [0, 0, 0, .5])).toEqual({ color: `${BLACK_HEX}80` })
  expect(readBuiltinField(adapted[2], { color: `${BLACK_HEX}80` })).toEqual([0, 0, 0, 128 / 255])
  fireEvent.keyDown(view.getByRole('slider', { name: '方向' }), { key: 'ArrowRight' }); expect(changes).toHaveBeenLastCalledWith({ angle: 1 })
  expect(builtinParameterFields([builtin[1], builtin[0]])).toEqual([adapted[0]])
})

it('条件实时显示，更多/分组折叠卸载，拖动仅通知自己的字段', () => {
  const declaration = parseCodeMaterialV3Parameters({ enabled: { type: 'boolean', title: '开关', default: false }, dependent: { type: 'number', title: '依赖', min: 0, max: 10, step: 1, default: 1, visibleWhen: { param: 'enabled', equals: true } }, advanced: { type: 'number', title: '高级', min: 0, max: 10, step: 1, default: 1, advanced: true, group: '分组' }, grouped: { type: 'boolean', title: '组内', default: false, group: '分组' } }, {})
  const specs = codeParameterFields(declaration)
  const calls = new Map<string, number>()
  const renderControl = (field: ParamFieldSpec, value: CodeParameterValue) => { calls.set(field.key, (calls.get(field.key) ?? 0) + 1); return <span>{JSON.stringify(value)}</span> }
  const values = { enabled: false, dependent: 1, advanced: 1, grouped: false }
  const view = render(<ParamList fields={specs} values={values} renderControl={renderControl} />)
  expect(view.queryByText('依赖')).toBeNull(); expect(view.queryByText('高级')).toBeNull()
  const initialGrouped = calls.get('grouped')
  view.rerender(<ParamList fields={codeParameterFields(declaration)} values={{ ...values, enabled: true }} renderControl={renderControl} />)
  expect(view.getByText('依赖')).toBeTruthy(); expect(calls.get('grouped')).toBe(initialGrouped)
  fireEvent.click(view.getByRole('button', { name: '分组更多' })); expect(view.getByText('高级')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '收起分组' })); expect(view.queryByText('高级')).toBeNull(); expect(view.queryByText('组内')).toBeNull()
  view.rerender(<ParamList fields={specs} values={{ ...values, enabled: false }} renderControl={renderControl} />); expect(view.queryByText('依赖')).toBeNull()
})

it.each(['stack', 'row', 'grid', 'wheel'] as const)('自定义 %s 布局按完整对象写入，wheel 将色轮放在上方', layout => {
  const types = parseCodeMaterialTypes({ grading: { title: '组件', layout, fields: { strength: { type: 'number', title: '强度', default: 1, min: 0, max: 10, step: 1 }, wheel: { type: 'grade', title: '调色', default: { hue: 0, strength: 0, luminance: 0 } } } } })
  const declaration = parseCodeMaterialV3Parameters({ grading: { type: 'grading', title: '组合', default: {} } }, types)[0]
  const field = codeParameterFields([declaration], types)[0]
  const { view, writes } = mountedField(field)
  const layoutElement = view.container.querySelector(`[data-param-layout="${layout}"]`)!
  expect(layoutElement).toBeTruthy()
  if (layout === 'wheel') expect(within(layoutElement.firstElementChild as HTMLElement).getByRole('slider', { name: '调色' })).toBeTruthy()
  const input = view.getByRole('spinbutton', { name: '强度' }); fireEvent.focus(input); fireEvent.change(input, { target: { value: '2' } }); fireEvent.blur(input)
  expect(writes).toHaveBeenLastCalledWith({ strength: 2, wheel: { hue: 0, strength: 0, luminance: 0 } })
})

it('上百字段逐键订阅，单字段发布不重渲染其余控件', () => {
  const count = 120
  const specs = Array.from({ length: count }, (_, index): ParamFieldSpec => ({ key: `field${index}`, title: `字段${index}`, type: 'number', source: 'code', bindingKeys: [`field${index}`], default: 0, min: 0, max: 100, step: 1, unit: '', animatable: false }))
  const values = Object.fromEntries(specs.map(field => [field.key, 0])); const calls = vi.fn(() => <span />)
  const view = render(<ParamList fields={specs} values={values} renderControl={calls} />); expect(calls).toHaveBeenCalledTimes(count)
  calls.mockClear(); view.rerender(<ParamList fields={specs} values={{ ...values, field0: 10 }} renderControl={calls} />); expect(calls).toHaveBeenCalledTimes(1)
})

it('相同值的内置目标切换不复用上一目标的手势和写入回调', () => {
  const first = vi.fn(); const second = vi.fn()
  const gesture = (identity: string, commit: typeof first) => ({ identity, commit, begin() {}, finish() {}, cancel() {}, active: () => false })
  const params = [builtin[2]]; const values = { angle: 0 }
  const view = render(<VideoEditBuiltinParamRows params={params} values={values} gesture={gesture('first', first)} />)
  view.rerender(<VideoEditBuiltinParamRows params={params} values={values} gesture={gesture('second', second)} />)
  fireEvent.keyDown(view.getByRole('slider', { name: '方向' }), { key: 'ArrowRight' })
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenLastCalledWith({ params: { angle: 1 } })
})

it('Lumetri 直接调用方保留数值写入和样条曲线控件/百分比编码', () => {
  const params = [...LUMETRI_BASIC_PARAMS.filter(param => param.key === 'exposure'), ...LUMETRI_POINT_PARAMS.filter(param => param.key === 'curve_master_points')]
  const commit = vi.fn(); const values = { exposure: 0, curve_master_points: '' }
  const view = render(<VideoEditBuiltinParamRows params={params} values={values} gesture={{ identity: 'lumetri', commit, begin() {}, finish() {}, cancel() {}, active: () => false }} />)
  const exposure = view.getByRole('spinbutton', { name: params[0].name })
  fireEvent.focus(exposure); fireEvent.change(exposure, { target: { value: '1' } }); fireEvent.blur(exposure)
  expect(commit).toHaveBeenLastCalledWith({ params: { exposure: 1 } })
  const field = builtinParameterFields(params)[1]
  expect(readBuiltinField(field, values)).toEqual([{ x: 0, y: 0 }, { x: .25, y: .25 }, { x: .5, y: .5 }, { x: .75, y: .75 }, { x: 1, y: 1 }])
  expect(writeBuiltinField(field, [{ x: 0, y: 0 }, { x: 1, y: .8 }])).toEqual({ curve_master_points: JSON.stringify([{ x: 0, y: 0 }, { x: 100, y: 80 }]) })
  expect(view.container.querySelector('[data-param-control="curve"]')).toBeTruthy()
})

it('像素点位按每轴界限映射，写入保持像素语义', () => {
  const declaration = parseCodeMaterialV3Parameters({ point: { type: 'point', title: '像素位置', space: 'pixels', min: { x: -100, y: -50 }, max: { x: 100, y: 150 }, default: { x: 0, y: 50 } } }, {})
  const { view, writes } = mountedField(codeParameterFields(declaration)[0])
  fireEvent.keyDown(view.getByRole('slider', { name: '像素位置相对位置' }), { key: 'ArrowRight' }); expect(writes).toHaveBeenLastCalledWith({ x: 2, y: 50 })
})
