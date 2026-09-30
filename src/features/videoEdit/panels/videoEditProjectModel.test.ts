import { expect, it } from 'vitest'
import { createVideoEditDocument } from '@/core/videoEdit/document'
import { selectVideoEditProjectItems, videoEditBinRows, videoEditProjectEntries } from './videoEditProjectModel'
it('素材箱层级折叠保持同级名称排序，搜索跨箱匹配标签且不修改工程', () => {
  const document = createVideoEditDocument('项目')
  document.bins = [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }, { id: 'nested', name: '子箱', parentId: 'a' }]
  document.items = [{ id: 'second', name: 'B素材', kind: 'text', binId: 'nested', tags: ['片头'] }, { id: 'first', name: 'A素材', kind: 'text' }]
  const snapshot = JSON.stringify(document)
  expect(videoEditBinRows(document.bins, new Set()).map(row => [row.bin.id, row.depth])).toEqual([['a', 0], ['nested', 1], ['b', 0]])
  expect(videoEditBinRows(document.bins, new Set(['a'])).map(row => row.bin.id)).toEqual(['a', 'b'])
  expect(videoEditProjectEntries(document, '', '片头', 'name').map(entry => entry.value.id)).toEqual(['second'])
  expect(videoEditProjectEntries(document, 'nested', '', 'name').map(entry => entry.value.id)).toEqual(['second'])
  expect(JSON.stringify(document)).toBe(snapshot)
})
it('Ctrl 切换与 Shift 范围依据当前过滤排序，不混入隐藏项目项', () => {
  const ids = ['c', 'a', 'b']
  expect(selectVideoEditProjectItems(ids, ['hidden'], 'b', 'c', { toggle: false, range: true })).toEqual(['c', 'a', 'b'])
  expect(selectVideoEditProjectItems(ids, ['hidden'], 'b', 'a', { toggle: true, range: true })).toEqual(['hidden', 'a', 'b'])
  expect(selectVideoEditProjectItems(ids, ['a', 'b'], 'a', null, { toggle: true, range: false })).toEqual(['b'])
})
