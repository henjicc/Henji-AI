import { expect, it } from 'vitest'
import { createVideoEditDocument } from '@/core/videoEdit/document'
import { selectVideoEditProjectItems, videoEditBinPath, videoEditProjectColumns, videoEditProjectRows } from './videoEditProjectModel'

const byName = { key: 'name', direction: 'asc' } as const
function project() {
  const document = createVideoEditDocument('项目')
  document.bins = [{ id: 'b', name: 'B' }, { id: 'a', name: 'A', label: 'rose' }, { id: 'nested', name: '子箱', parentId: 'a' }]
  document.media = [
    { id: 'clip', name: '镜头', path: 'D:/clip.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 2, frameRate: { numerator: 25, denominator: 1 } },
    { id: 'voice', name: '旁白', path: 'D:/voice.wav', kind: 'audio', width: 0, height: 0, durationSeconds: 1, audioStreams: [{ channels: 2, sampleRate: 48000 }] },
  ]
  document.items = [
    { id: 'second', name: 'B素材', kind: 'text', binId: 'nested', tags: ['片头'] },
    { id: 'first', name: 'A素材', kind: 'video', mediaId: 'clip' },
    { id: 'sound', name: 'C声音', kind: 'audio', mediaId: 'voice', label: 'yellow' },
  ]
  return document
}

it('列表是可展开的树：当前素材箱里素材箱与素材项同列排序，展开的素材箱缩进列出内容；搜索跨箱平铺且不修改剪辑', () => {
  const document = project(); const snapshot = JSON.stringify(document)
  const rows = (expanded: string[], binId = '') => videoEditProjectRows(document, binId, '', byName, new Set(expanded)).map(row => [row.entry.value.id, row.depth, row.expandable, row.expanded])
  // zh-CN 排序：中文名“序列 1”排在拉丁字母名之前
  expect(rows([])).toEqual([[document.sequences[0].id, 0, false, false], ['a', 0, true, false], ['first', 0, false, false], ['b', 0, true, false], ['sound', 0, false, false]])
  expect(rows(['a', 'nested']).slice(1, 5)).toEqual([['a', 0, true, true], ['nested', 1, true, true], ['second', 2, false, false], ['first', 0, false, false]])
  expect(rows([], 'a')).toEqual([['nested', 0, true, false]])
  expect(videoEditProjectRows(document, '', '片头', byName, new Set()).map(row => row.entry.value.id)).toEqual(['second'])
  expect(videoEditBinPath(document.bins, 'nested').map(bin => bin.id)).toEqual(['a', 'nested'])
  expect(JSON.stringify(document)).toBe(snapshot)
})

it('列内容按素材帧率给出时间码，音频显示采样率；颜色标签自己设的优先，否则按类型默认；点列排序且空值排最后', () => {
  const document = project()
  const entry = (id: string) => videoEditProjectRows(document, '', '', byName, new Set()).find(row => row.entry.value.id === id)!.entry
  expect(videoEditProjectColumns(document, entry('first'), 30)).toMatchObject({ label: 'iris', frameRateText: '25 fps', mediaStart: '00:00:00:00', mediaEnd: '00:00:01:24', durationText: '00:00:02:00' })
  expect(videoEditProjectColumns(document, entry('sound'), 30)).toMatchObject({ label: 'yellow', frameRateText: '48000 Hz', durationText: '00:00:01:00' })
  expect(videoEditProjectColumns(document, entry('a'), 30)).toMatchObject({ label: 'rose', durationText: '' })
  expect(videoEditProjectColumns(document, entry('b'), 30).label).toBe('mango')
  expect(videoEditProjectRows(document, '', '', { key: 'duration', direction: 'desc' }, new Set()).map(row => row.entry.value.id).slice(0, 2)).toEqual(['first', 'sound'])
  expect(videoEditProjectRows(document, '', '', { key: 'duration', direction: 'asc' }, new Set()).map(row => row.entry.value.id).slice(0, 3)).toEqual([document.sequences[0].id, 'sound', 'first'])
  expect(videoEditProjectRows(document, '', '', { key: 'name', direction: 'desc' }, new Set()).map(row => row.entry.value.id)[0]).toBe('sound')
})

it('Ctrl 切换与 Shift 范围依据当前过滤排序，不混入隐藏素材项', () => {
  const ids = ['c', 'a', 'b']
  expect(selectVideoEditProjectItems(ids, ['hidden'], 'b', 'c', { toggle: false, range: true })).toEqual(['c', 'a', 'b'])
  expect(selectVideoEditProjectItems(ids, ['hidden'], 'b', 'a', { toggle: true, range: true })).toEqual(['hidden', 'a', 'b'])
  expect(selectVideoEditProjectItems(ids, ['a', 'b'], 'a', null, { toggle: true, range: false })).toEqual(['b'])
})

it('子剪辑展示并排序源范围，持续时间不沿用整段素材', () => {
  const document = project()
  document.items.push({ id: 'shot', name: '镜头子剪辑', kind: 'video', mediaId: 'clip', sourceRange: { inUs: 1000000, outUs: 1600000 } })
  expect(videoEditProjectColumns(document, { kind: 'item', value: document.items.at(-1)! }, 30)).toMatchObject({ mediaStart: '00:00:01:00', mediaEnd: '00:00:01:14', durationText: '00:00:00:15', duration: .6 })
  const ids = (key: 'mediaStart' | 'mediaEnd') => videoEditProjectRows(document, '', '', { key, direction: 'desc' }, new Set()).map(row => row.entry.value.id)
  expect(ids('mediaStart')[0]).toBe('shot')
  expect(ids('mediaEnd').slice(0, 2)).toEqual(['first', 'shot'])
})
