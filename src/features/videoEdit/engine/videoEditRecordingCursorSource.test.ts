import { expect, it, vi } from 'vitest'
import { recordingCursorFixture } from '@/tests/recordingCursorFixture'
import { VideoEditRecordingCursorSource, fetchRecordingCursorPage } from './videoEditRecordingCursorSource'

it('窗口按需读取并缓存；切换归属不能借用已缓存页；取消与损坏不落入缓存', async () => {
  const fixture = await recordingCursorFixture(20)
  const read = vi.fn(async (ref: { path: string }) => fixture.bytes.get(ref.path)!)
  const source = new VideoEditRecordingCursorSource(read); const signal = new AbortController().signal
  const events = await source.window(fixture.source, 10_000_000, 0, signal)
  expect(read.mock.calls.length).toBeLessThan(fixture.pages.length)
  expect(events.every(e => e.recordingUs >= 9_400_000 && e.recordingUs <= 10_100_000)).toBe(true)
  const calls = read.mock.calls.length
  expect(await source.window(fixture.source, 10_000_000, 0, signal)).toEqual(events); expect(read).toHaveBeenCalledTimes(calls)
  await expect(source.window({ ...fixture.source, ownerRef: { kind: 'recording_session', id: 'wrong' } }, 10_000_000, 0, signal)).rejects.toThrow('归属')
  const cancelled = new AbortController(); cancelled.abort()
  await expect(source.window(fixture.source, 10_000_000, 0, cancelled.signal)).rejects.toThrow()
  const bad = new VideoEditRecordingCursorSource(async () => new TextEncoder().encode('{}'))
  await expect(bad.window(fixture.source, 0, 0, signal)).rejects.toThrow('校验')
  await expect(fetchRecordingCursorPage({ ...fixture.source.pages[0], path: '/raw/log.json' }, signal)).rejects.toThrow('边界转换')
  source.clear(); await source.window(fixture.source, 10_000_000, 0, signal); expect(read.mock.calls.length).toBeGreaterThan(calls)
})
