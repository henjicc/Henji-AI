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
