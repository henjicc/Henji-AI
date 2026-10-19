import { expect, it } from 'vitest'
import { authorLayerSamples } from './videoEditAuthorLayers'
import { authorLayerData, authorOverrideMatrix, observeAuthorElement } from './videoEditAuthorElements'
import type { AuthorLayer, AuthorModule } from './videoEditAuthorModule'

it('keeps author animation and overlays local scale/rotation with composition-space translation', () => {
  const author = [0, 2, -3, 0, 100, 200] as [number, number, number, number, number, number]
  const result = authorOverrideMatrix(author, [-10, -5, 10, 5], { dx: 7, dy: -9, scaleX: 2, rotation: 90 })
  expect(result[0]).toBeCloseTo(-6); expect(result[1]).toBeCloseTo(0)
  expect(result[2]).toBeCloseTo(0); expect(result[3]).toBeCloseTo(-2)
  expect(result.slice(4)).toEqual([107, 191])
  expect(author).toEqual([0, 2, -3, 0, 100, 200])
})

it('samples the overridden motion path and preserves author-hidden states', () => {
  const layer: AuthorLayer = { id: 'title', draw() {}, pose: t => t < 0 ? null : { x: t * 600, opacity: .5 } }
  const effect: AuthorModule = { name: '标题', layers: () => [layer] }
  const info = { time: 1, frameDuration: 1 / 60, clip: { time: 1, duration: 5 } }
  const samples = authorLayerSamples(layer, effect, info, { x: 0, y: 0, width: 100, height: 20 }, { dx: 30, opacity: .5 })
  expect(samples.length).toBeGreaterThan(1)
  for (const sample of samples) {
    expect(sample.pose?.matrix[4]).toBeCloseTo((1 + sample.offset.numerator / 60) * 600 + 30)
    expect(sample.pose?.opacity).toBe(.25)
  }
  expect(authorLayerSamples(layer, effect, { ...info, time: -1 }, { x: 0, y: 0, width: 100, height: 20 }, { dx: 30 }).every(sample => !sample.pose)).toBe(true)
})

it('returns only layer-bound parameters and a source span without inspecting draw commands', () => {
  const span = { file: 'title.js', start: 10, end: 90, startLine: 2, startColumn: 1, endLine: 6, endColumn: 2 }
  const layer: AuthorLayer = { id: 'title', name: '标题', sourceSpan: span, draw() { throw new Error('must not draw during observation') } }
  const effect: AuthorModule = { name: '片头', params: [{ key: 'text', type: 'text', layer: 'title' }, { key: 'size', type: 'number', layer: 'title' }, { key: 'background', type: 'color', layer: 'backdrop' }] }
  const result = observeAuthorElement(effect, layer, 0, [0, 0, 100, 20], [1, 0, 0, 1, 30, 50])
  expect(result).toMatchObject({ id: 'title', name: '标题', sourceSpan: span, parameterKeys: ['text', 'size'], textParameterKeys: ['text'], corners: [[30, 50], [130, 50], [130, 70], [30, 70]] })
  expect(observeAuthorElement(effect, { ...layer, id: 'effect' }, 0, [0, 0, 100, 20], [1, 0, 0, 1, 0, 0]).parameterKeys).toEqual(['text', 'size', 'background'])
})

it('resolves a dynamic layer to its current data row by stable key, without calling draw', () => {
  const layer: AuthorLayer = { id: 'node-b', data: { parameter: 'nodes', key: 'b', keyField: 'id' }, draw() { throw new Error('must not draw') } }
  const effect: AuthorModule = { name: '节点', params: [{ key: 'nodes', type: 'table' }, { key: 'other', type: 'text' }] }
  const values = { nodes: [{ id: 'b', title: '乙' }, { id: 'a', title: '甲' }] }
  const observed = observeAuthorElement(effect, layer, 0, [0, 0, 20, 20], [1, 0, 0, 1, 0, 0], values)
  expect(observed).toMatchObject({ parameterKeys: ['nodes'], data: { parameter: 'nodes', index: 0, key: 'b', keyField: 'id', value: { id: 'b', title: '乙' } } })
  values.nodes[0].title = '修改'
  expect(observed.data?.value).toEqual({ id: 'b', title: '乙' })
  expect(authorLayerData({ ...layer, data: { parameter: 'nodes', index: 1 } }, values)?.value).toEqual({ id: 'a', title: '甲' })
  expect(() => authorLayerData(layer, { nodes: [{ id: 'b' }, { id: 'b' }] })).toThrow('不唯一')
  expect(() => authorLayerData(layer, { nodes: [] })).toThrow('不存在')
  expect(() => authorLayerData(layer, { nodes: 'wrong' })).toThrow('不是数据表')
})
