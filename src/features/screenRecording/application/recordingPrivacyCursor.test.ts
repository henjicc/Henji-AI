import { expect, it } from 'vitest'
import { recordingPrivacyCursor } from './recordingPrivacyCursor'
it('按原片时间对齐光标，跨页保留最新位置，不使用未来位置，暂停段不膨胀', () => {
  const sampler = recordingPrivacyCursor([{ monoUs: 55000, durationUs: 210000 }, { monoUs: 1000000, durationUs: 100000 }])
  const base = { eventId: 'cursor', seq: 0, timeline: null, recordingUs: 0, clockSegmentRef: 'clock' }
  sampler.append({ ...base, kind: 'cursor', monoUs: 50000, point: [1, 2], shape: 'arrow' })
  sampler.append({ ...base, kind: 'cursor', monoUs: 60000, point: [3, 4], shape: 'arrow' })
  sampler.append({ ...base, kind: 'cursor', monoUs: 150000, point: [5, 6], shape: 'arrow' })
  sampler.append({ ...base, kind: 'cursor', monoUs: 155000, point: [7, 8], shape: 'arrow' })
  sampler.append({ ...base, kind: 'cursor', monoUs: 900000, point: [9, 10], shape: 'hidden' })
  expect(sampler.finish()).toEqual([{ monoUs: 55000, point: [1, 2] }, { monoUs: 155000, point: [7, 8] }, { monoUs: 255000, point: [7, 8] }, { monoUs: 1000000, point: null }])
})
