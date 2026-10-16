import { afterEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { VideoEditContentWarmup, videoEditContentWarmFrames } from './videoEditContentWarmup'

afterEach(() => { vi.useRealTimers() })
function fixture() {
  const doc = createVideoEditTestDocument('warm')
  const composition = videoEditComposition(doc, doc.sequences[0].id)
  composition.clips = [{ id: 'code', kind: 'code', start: 7, duration: 180 } as typeof composition.clips[number]]
  return composition
}
it('bounded samples include clip endpoints and do not change the document', () => {
  const doc = fixture(); const before = JSON.stringify(doc)
  const samples = videoEditContentWarmFrames(doc)
  expect(samples).toHaveLength(32); expect(samples[0]).toBe(7); expect(samples.at(-1)).toBe(186)
  expect(JSON.stringify(doc)).toBe(before)
})
it('superseded work cannot complete or schedule the old version; real requests defer preparation', async () => {
  vi.useFakeTimers()
  const queue: Array<() => Promise<void>> = []
  const prepare = vi.fn(async (_frame: number, current: () => boolean) => { expect(current()).toBe(true) })
  const completed = vi.fn()
  const warm = new VideoEditContentWarmup(work => queue.push(work), prepare, completed)
  const doc = fixture(); warm.replace(doc)
  await vi.advanceTimersByTimeAsync(30); warm.defer()
  await vi.advanceTimersByTimeAsync(30); expect(queue).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(10); expect(queue).toHaveLength(1)
  warm.replace({ ...doc, revision: 99 })
  await queue.shift()!(); expect(prepare).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(40); await queue.shift()!()
  expect(prepare).toHaveBeenCalledOnce(); expect(completed).not.toHaveBeenCalled()
  warm.cancel(); await vi.advanceTimersByTimeAsync(1000)
  expect(queue).toHaveLength(0); expect(vi.getTimerCount()).toBe(0)
})
it('in-flight preparation sees cancellation and failure does not poison subsequent work', async () => {
  vi.useFakeTimers()
  let current!: () => boolean
  let finish!: () => void
  const prepare = vi.fn((_frame: number, check: () => boolean) => { current = check; return new Promise<void>(resolve => { finish = resolve }) })
  let job!: () => Promise<void>
  const done = vi.fn(); const warm = new VideoEditContentWarmup(work => { job = work }, prepare, done)
  warm.replace(fixture()); await vi.advanceTimersByTimeAsync(40)
  const pending = job(); warm.cancel(); expect(current()).toBe(false); finish(); await pending
  expect(done).not.toHaveBeenCalled()
  prepare.mockRejectedValue(new Error('budget'))
  warm.replace(fixture()); await vi.advanceTimersByTimeAsync(40); await job()
  expect(done).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ message: 'budget' }))
  warm.cancel()
})
