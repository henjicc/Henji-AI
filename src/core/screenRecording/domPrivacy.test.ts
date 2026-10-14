import { expect, it } from 'vitest'
import type { CapturePayload, CaptureEvent } from '../captureLog/events'
import { recordingDomPrivacyCandidates } from './domPrivacy'
const event = (monoUs: number, payload: CapturePayload): CaptureEvent => ({ ...payload, monoUs, recordingUs: monoUs, seq: monoUs, eventId: `${monoUs}`, clockSegmentRef: 'clock', timeline: null, unavailableReason: 'static' })
it('密码框DOM快照合并移动轨迹，清空、暂停和原片空档切断覆盖', () => {
  const events = [event(100, { kind: 'sensitive', regions: [{ id: 'dom', box: [.1, .1, .2, .1] }] }), event(200, { kind: 'sensitive', regions: [{ id: 'dom', box: [.1, .2, .2, .1] }] }),
    event(300, { kind: 'control', action: 'pause' }), event(500, { kind: 'control', action: 'resume' }), event(600, { kind: 'sensitive', regions: [{ id: 'dom', box: [.2, .2, .2, .1] }] }), event(700, { kind: 'sensitive', regions: [] })]
  let count = 0
  const candidates = recordingDomPrivacyCandidates(events, [{ id: 'a', kind: 'screen', monoUs: 0, durationUs: 300 }, { id: 'b', kind: 'screen', monoUs: 500, durationUs: 300 }], () => `candidate${++count}`)
  expect(candidates).toHaveLength(2); expect(candidates[0]).toMatchObject({ startUs: 100, endUs: 300, kind: 'password', status: 'pending' }); expect(candidates[0].samples).toHaveLength(2)
  expect(candidates[1]).toMatchObject({ startUs: 600, endUs: 700, mediaId: 'b' })
})
it('长静止区间末尾再移动只为采样间隙保留覆盖，不给整个静止期扩大打码', () => {
  const events = [event(0, { kind: 'sensitive', regions: [{ id: 'dom', box: [.1, .1, .2, .1] }] }), event(3000000, { kind: 'sensitive', regions: [{ id: 'dom', box: [.1, .4, .2, .1] }] }), event(3100000, { kind: 'sensitive', regions: [] })]
  const [candidate] = recordingDomPrivacyCandidates(events, [{ id: 'a', kind: 'screen', monoUs: 0, durationUs: 4000000 }], () => 'candidate')
  expect(candidate.samples.map(s => s.monoUs)).toEqual([0, 2900000, 3000000])
})
