// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('./videoEditService', () => ({ publishVideoEdit: vi.fn(), requireVideoEditInstance: vi.fn() }))
const { effectiveVideoEditSpaceDisplay, noteVideoEditSpacePlayback, resetVideoEditSpaceDisplayCache, setVideoEditSpaceDisplay, videoEditSpaceDisplaySimplified } = await import('./videoEditSpaceDisplay')

beforeEach(() => { localStorage.clear(); resetVideoEditSpaceDisplayCache() })

it('自动：跟不上时逐级简化，暂停回到实时，稳定播放一段时间后才升回一档', () => {
  const id = 'project'
  expect(effectiveVideoEditSpaceDisplay(id, true)).toBe('realtime')
  // 一个窗口里掉帧超过一成：降到实体，再一个窗口还掉帧：降到线框，到底后不再降。
  expect(noteVideoEditSpacePlayback(id, 30, 6, 0)).toBe(true)
  expect(effectiveVideoEditSpaceDisplay(id, true)).toBe('solid')
  expect(videoEditSpaceDisplaySimplified(id, true)).toBe(true)
  noteVideoEditSpacePlayback(id, 30, 6, 100)
  expect(effectiveVideoEditSpaceDisplay(id, true)).toBe('wireframe')
  expect(noteVideoEditSpacePlayback(id, 30, 6, 200)).toBe(false)
  // 不掉帧（零星掉一帧也算）但刚换过档：先不升；满 4 秒后才升一档，不在两档之间来回跳。
  expect(noteVideoEditSpacePlayback(id, 30, 0, 1000)).toBe(false)
  expect(noteVideoEditSpacePlayback(id, 60, 1, 4300)).toBe(true)
  expect(effectiveVideoEditSpaceDisplay(id, true)).toBe('solid')
  // 暂停回到实时并清零：下次起播从实时重新判断。
  expect(effectiveVideoEditSpaceDisplay(id, false)).toBe('realtime')
  expect(videoEditSpaceDisplaySimplified(id, false)).toBe(false)
  expect(effectiveVideoEditSpaceDisplay(id, true)).toBe('realtime')
  // 窗口不满不判断。
  expect(noteVideoEditSpacePlayback(id, 10, 10, 9000)).toBe(false)
})

it('选了固定方式就始终用它，不自动换档；换方式时自动状态从头算', () => {
  const id = 'fixed'
  setVideoEditSpaceDisplay(id, { mode: 'solid' })
  expect(noteVideoEditSpacePlayback(id, 30, 30, 0)).toBe(false)
  expect(effectiveVideoEditSpaceDisplay(id, true)).toBe('solid')
  expect(effectiveVideoEditSpaceDisplay(id, false)).toBe('solid')
  setVideoEditSpaceDisplay(id, { mode: 'auto' })
  expect(effectiveVideoEditSpaceDisplay(id, true)).toBe('realtime')
  expect(() => setVideoEditSpaceDisplay(id, { mode: 'raytrace' as never })).toThrow()
})
