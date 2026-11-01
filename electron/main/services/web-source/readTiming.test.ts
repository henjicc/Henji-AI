import { expect, it } from 'vitest'
import { WebCacheReadTiming } from './readTiming'

it('按页面实测择优，负载变化后重新采样，内容与尺寸不串用旧结论', () => {
  const timing = new WebCacheReadTiming(), request = { streamId: 'page', time: 0, ticket: 'frame', scale: 1, latest: true }
  const run = (live: number, cache: number) => {
    const selected = timing.select('content', request)
    timing.record(selected.key, selected.cache, selected.warmup ? 500 : selected.cache ? cache : live, selected.warmup)
    return selected
  }
  for (let index = 0; index < 12; index++) run(12, 20)
  expect(run(12, 20)).toMatchObject({ cache: false, reason: 'live-fast-enough' })
  for (let index = 0; index < 1200; index++) run(60, 8)
  expect(run(60, 8)).toMatchObject({ cache: true, reason: 'cache-faster' })
  expect(timing.select('changed', request)).toMatchObject({ reason: 'sampling-live' })
  expect(timing.select('content', { ...request, scale: 0.5 })).toMatchObject({ reason: 'sampling-live' })
  timing.close(request.streamId)
  expect(timing.select('content', request)).toMatchObject({ reason: 'sampling-live' })
})
