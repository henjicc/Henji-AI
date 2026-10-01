import { expect, it, vi } from 'vitest'
import { parseVideoEditPopoutLayout, readVideoEditPopoutLayout, VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY, writeVideoEditPopoutLayout } from './videoEditPopoutLayout'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
const allowed = ['project', 'program', 'effects', 'timeline', 'content']

it('只保留已知、不重复的面板；位置取整，损坏位置丢弃但保留面板', () => {
  const raw = JSON.stringify({ version: 1, panels: [
    { id: 'timeline', bounds: { x: 2760.4, y: -20, width: 480, height: 360.6 } },
    { id: 'timeline' }, { id: 'source' }, { id: 'unknown' }, 'bad',
    { id: 'effects', bounds: { x: 1, y: 2, width: 0, height: 10 } },
  ] })
  expect(parseVideoEditPopoutLayout(raw, allowed)).toEqual([
    { id: 'timeline', bounds: { x: 2760, y: -20, width: 480, height: 361 } },
    { id: 'effects' },
  ])
  expect(parseVideoEditPopoutLayout(null, allowed)).toEqual([])
  expect(() => parseVideoEditPopoutLayout(JSON.stringify({ version: 2, panels: [] }), allowed)).toThrow()
})

it('读写失败不抛出：按无浮窗启动，空记录删除存储键', () => {
  expect(readVideoEditPopoutLayout(allowed, { getItem: () => '{broken' })).toEqual([])
  expect(readVideoEditPopoutLayout(allowed, { getItem: () => { throw new Error('denied') } })).toEqual([])
  expect(() => writeVideoEditPopoutLayout([{ id: 'effects' }], { setItem: () => { throw new Error('quota') }, removeItem: vi.fn() })).not.toThrow()
  const storage = { setItem: vi.fn(), removeItem: vi.fn() }
  writeVideoEditPopoutLayout([], storage)
  expect(storage.removeItem).toHaveBeenCalledWith(VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY)
  writeVideoEditPopoutLayout([{ id: 'effects', bounds: { x: 1, y: 2, width: 3, height: 4 } }], storage)
  expect(JSON.parse(storage.setItem.mock.calls[0][1])).toEqual({ version: 1, panels: [{ id: 'effects', bounds: { x: 1, y: 2, width: 3, height: 4 } }] })
})
