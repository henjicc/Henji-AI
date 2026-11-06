import { expect, it } from 'vitest'
import { codeMaterialAuthoringHints } from './authoringHints'
import type { CodeAuthorProgram } from '../codeAuthorProgram'
import { parseCodeMaterialV3Parameters } from './parameterTypes'

function program(parameters: Record<string, unknown>): CodeAuthorProgram {
  return { apiVersion: 4, languageVersion: 4, name: '体检', kind: 'generator', mode: 'dynamic', seed: 0, parameters: parseCodeMaterialV3Parameters(parameters, {}), types: {}, frames: [], hexColors: [], bundle: { code: '', map: '', locations: { layers: {} } } }
}
it('encourages parameters without claiming to discover drawing calls', () => {
  expect(codeMaterialAuthoringHints(program({})).map(hint => hint.code)).toEqual(['NO_PARAMETERS'])
})
it('requires text content and style to share a layer binding', () => {
  const text = { type: 'text', title: '文案', default: '新品发布', maxLength: 200 }
  expect(codeMaterialAuthoringHints(program({ title: text })).map(hint => hint.code)).toEqual(['UNBOUND_TEXT', 'MISSING_TEXT_STYLE'])
  expect(codeMaterialAuthoringHints(program({ title: { ...text, layer: 'title' }, style: { type: 'textStyle', title: '样式', default: {}, layer: 'title' } }))).toEqual([])
})
it('does not claim unused parameters can be detected in arbitrary JS', () => {
  expect(codeMaterialAuthoringHints(program({ size: { type: 'number', title: '大小', default: 40, min: 0, max: 100, step: 1 } }))).toEqual([])
})

it('有 id 的元素除文字外没有绑定参数时提示，调整层不提示', () => {
  const span = { file: 'main.js', start: 0, end: 1, startLine: 3, startColumn: 1, endLine: 3, endColumn: 2 }
  const base = program({ title: { type: 'text', title: '文案', default: '标题', maxLength: 200, layer: 'card' }, style: { type: 'textStyle', title: '样式', default: {}, layer: 'card' } })
  const withLayers = (parameters: CodeAuthorProgram['parameters'], adjustLayerIds?: string[]) => ({ ...base, parameters, bundle: { ...base.bundle, locations: { layers: { card: span, grade: span }, ...(adjustLayerIds ? { adjustLayerIds } : {}) } } })
  const textOnly = base.parameters.filter(parameter => parameter.type === 'text')
  expect(codeMaterialAuthoringHints(withLayers(textOnly, ['grade'])).filter(hint => hint.code === 'UNBOUND_VISUAL')).toEqual([expect.objectContaining({ line: 3, message: expect.stringContaining('元素 card') })])
  expect(codeMaterialAuthoringHints(withLayers(base.parameters, ['grade'])).some(hint => hint.code === 'UNBOUND_VISUAL')).toBe(false)
})

it('图层 id 全是字面量时，layer 指向不存在的图层要提示；动态 id 不下结论', () => {
  const span = { file: 'main.js', start: 0, end: 1, startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }
  const base = program({ word: { type: 'text', title: '那行字', default: '字', maxLength: 40, layer: '那行字' }, style: { type: 'textStyle', title: '样式', default: {}, layer: '那行字' } })
  const at = (staticLayerIds?: true) => ({ ...base, bundle: { ...base.bundle, locations: { layers: { 盒子: span }, ...(staticLayerIds ? { staticLayerIds } : {}) } } })
  expect(codeMaterialAuthoringHints(at(true)).filter(hint => hint.code === 'MISSING_LAYER').map(hint => hint.message)).toEqual([expect.stringContaining('word'), expect.stringContaining('style')])
  expect(codeMaterialAuthoringHints(at()).some(hint => hint.code === 'MISSING_LAYER')).toBe(false)
})
