import { expect, it } from 'vitest'
import type { ClockAnchor } from '../captureLog/clock'
import { RecordingTrackState } from './trackJournal'

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const anchor = (monoUs: number, segment: string): ClockAnchor => ({ monoUs, audioSample: 0, audioSegmentRef: segment, audioRate: 48000, presentedFrame: null, requestedFrame: null, sequenceRef: null, visitRef: null, playbackDirection: 0, playbackRate: 1, playing: false, epoch: 0, uncertaintyUs: 0 })
const sealed = (n: number, start: number, end: number) => ({ id: id(n), file: `${id(n)}.wav`, monoSpanUs: [start, end] as [number, number], sampleRate: 48000, channels: 1, units: Math.round((end - start) * 0.048), latencyCompensationUs: 0, anchors: [anchor(start, id(n))] })

it('界面重新接上前后的分段之间记为缺数据空档；断开前开头的分段归旧界面，晚到的封口不算新界面', () => {
  const state = new RecordingTrackState(['microphone'])
  state.apply({ type: 'seal', kind: 'microphone', segment: sealed(1, 0, 5_000_000) })
  state.apply({ type: 'open', kind: 'microphone', segment: { id: id(2), file: `${id(2)}.wav`, monoStartUs: 5_000_000, sampleRate: 48000, channels: 1, latencyCompensationUs: 0, anchor: anchor(5_000_000, id(2)) } })
  state.apply({ type: 'detach', atUs: 6_000_000 })
  // 旧页面卸载前送达的封口仍属于旧界面。
  state.apply({ type: 'seal', kind: 'microphone', segment: sealed(2, 5_000_000, 5_800_000) })
  state.apply({ type: 'seal', kind: 'microphone', segment: sealed(3, 8_000_000, 13_000_000) })
  expect(state.unsealed()).toEqual([])
  expect(state.tracks(id(9), 0).tracks[0].gaps).toEqual([{ monoSpanUs: [5_800_000, 8_000_000], reason: 'missing-data' }])
})

it('主进程录的系统声跨界面断开照样首尾相接：只差设备时钟漂移的零点几毫秒，不记缺数据空档', () => {
  const state = new RecordingTrackState(['systemAudio'])
  state.apply({ type: 'open', kind: 'systemAudio', segment: { id: id(1), file: `${id(1)}.wav`, monoStartUs: 0, sampleRate: 48000, channels: 2, latencyCompensationUs: 0, anchor: anchor(0, id(1)) } })
  state.apply({ type: 'detach', atUs: 2_000_000 })
  state.apply({ type: 'seal', kind: 'systemAudio', segment: sealed(1, 0, 5_000_000) })
  state.apply({ type: 'seal', kind: 'systemAudio', segment: sealed(2, 5_000_500, 10_000_500) })
  expect(state.tracks(id(9), 0).tracks[0].gaps).toEqual([])
})

it('分段按真实时钟整理：漂移造成的一个量子重叠以下一段起点为界', () => {
  const state = new RecordingTrackState(['systemAudio'])
  state.apply({ type: 'seal', kind: 'systemAudio', segment: sealed(1, 0, 5_000_200) })
  state.apply({ type: 'seal', kind: 'systemAudio', segment: sealed(2, 5_000_000, 10_000_000) })
  expect(state.tracks(id(9), 0).tracks[0].segments.map(segment => segment.monoSpanUs)).toEqual([[0, 5_000_000], [5_000_000, 10_000_000]])
})
