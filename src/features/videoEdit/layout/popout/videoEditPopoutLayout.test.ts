import { expect, it, vi } from 'vitest'
import { parseVideoEditPopoutLayout, readVideoEditPopoutLayout, VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY, writeVideoEditPopoutLayout } from './videoEditPopoutLayout'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
const allowed = ['project', 'program', 'effects', 'timeline', 'content']

it('一个浮窗可装多个面板：只保留已知面板，一个面板只在一个窗口；当前标签无效时取第一个；位置取整，损坏位置丢弃', () => {
  const raw = JSON.stringify({ version: 2, windows: [
    { panels: ['timeline', 'program', 'source'], active: 'program', bounds: { x: 2760.4, y: -20, width: 480, height: 360.6 } },
    { panels: ['timeline'] }, { panels: ['unknown'] }, 'bad',
    { panels: ['effects', 'content'], active: 'source', bounds: { x: 1, y: 2, width: 0, height: 10 } },
  ] })
  expect(parseVideoEditPopoutLayout(raw, allowed)).toEqual([
    { panels: ['timeline', 'program'], active: 'program', bounds: { x: 2760, y: -20, width: 480, height: 361 } },
    { panels: ['effects', 'content'], active: 'effects' },
  ])
  expect(parseVideoEditPopoutLayout(null, allowed)).toEqual([])
  expect(() => parseVideoEditPopoutLayout(JSON.stringify({ version: 3, windows: [] }), allowed)).toThrow()
})

it('版本 1 的旧记录（一个窗口一个面板）按每个面板一个窗口读入', () => {
  const raw = JSON.stringify({ version: 1, panels: [{ id: 'timeline', bounds: { x: 1, y: 2, width: 3, height: 4 } }, { id: 'timeline' }, { id: 'effects' }] })
  expect(parseVideoEditPopoutLayout(raw, allowed)).toEqual([{ panels: ['timeline'], active: 'timeline', bounds: { x: 1, y: 2, width: 3, height: 4 } }, { panels: ['effects'], active: 'effects' }])
})

it('读写失败不抛出：按无浮窗启动，空记录删除存储键', () => {
  expect(readVideoEditPopoutLayout(allowed, { getItem: () => '{broken' })).toEqual([])
  expect(readVideoEditPopoutLayout(allowed, { getItem: () => { throw new Error('denied') } })).toEqual([])
  expect(() => writeVideoEditPopoutLayout([{ panels: ['effects'], active: 'effects' }], { setItem: () => { throw new Error('quota') }, removeItem: vi.fn() })).not.toThrow()
  const storage = { setItem: vi.fn(), removeItem: vi.fn() }
  writeVideoEditPopoutLayout([], storage)
  expect(storage.removeItem).toHaveBeenCalledWith(VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY)
  writeVideoEditPopoutLayout([{ panels: ['effects'], active: 'effects', bounds: { x: 1, y: 2, width: 3, height: 4 } }], storage)
  expect(JSON.parse(storage.setItem.mock.calls[0][1])).toEqual({ version: 2, windows: [{ panels: ['effects'], active: 'effects', bounds: { x: 1, y: 2, width: 3, height: 4 } }] })
})
