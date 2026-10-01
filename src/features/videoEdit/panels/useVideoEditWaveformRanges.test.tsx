// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import type { AudioWaveformRangeResult } from '@/platform/contracts/audioWaveform'
import { useVideoEditWaveformRanges, type VideoEditWaveformRequest } from './useVideoEditWaveformRanges'
beforeEach(() => installHarnessNativeStorage())
afterEach(() => { cleanup(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
function Panel({ requests, visible = true }: { requests: VideoEditWaveformRequest[]; visible?: boolean }) {
  const results = useVideoEditWaveformRanges(requests, visible)
  return <div>{[...results].map(([key, state]) => <span key={key}>{key}:{state.result?.startUs ?? state.error}</span>)}</div>
}
const request = (key: string, startUs = 0): VideoEditWaveformRequest => ({ key, request: { source: 'D:/original.wav', startUs, endUs: startUs + 1000000, channels: 2, bucketCount: 16 } })
const result = (startUs: number): AudioWaveformRangeResult => ({ startUs, endUs: startUs + 1000000, durationSeconds: 10, sampleRate: 44100, channelCount: 1, channels: [{ peak: [1], rms: [.25], sampleCounts: [44100] }], fileIdentity: 'original' })
it('大量可见片段最多两项在途，隐藏取消未结束请求且不发剩余任务', async () => {
  const pending: Array<{ signal: AbortSignal; finish: (result: AudioWaveformRangeResult) => void }> = []
  const extract = vi.spyOn(getPlatform().audioEdit, 'extractWaveformRange').mockImplementation((_request, signal) => new Promise(resolve => { pending.push({ signal: signal!, finish: resolve }) }))
  const requests = Array.from({ length: 50 }, (_, index) => request(String(index)))
  const view = render(<Panel requests={requests} />)
  expect(extract).toHaveBeenCalledTimes(2)
  await act(async () => pending[0].finish(result(0))); expect(extract).toHaveBeenCalledTimes(3)
  act(() => view.rerender(<Panel requests={requests} visible={false} />)); expect(pending[1].signal.aborted).toBe(true); expect(view.container.textContent).toBe('')
  await act(async () => { pending[1].finish(result(0)); pending[2].finish(result(0)) }); expect(extract).toHaveBeenCalledTimes(3); expect(view.container.textContent).toBe('')
})
it('范围变化立即隐藏旧波形，晚到旧结果不能替换新范围', async () => {
  const pending: Array<(value: AudioWaveformRangeResult) => void> = []
  vi.spyOn(getPlatform().audioEdit, 'extractWaveformRange').mockImplementation(() => new Promise(resolve => pending.push(resolve)))
  const view = render(<Panel requests={[request('clip')]} />)
  act(() => view.rerender(<Panel requests={[request('clip', 1000000)]} />))
  await act(async () => pending[1](result(1000000))); expect(view.container.textContent).toBe('clip:1000000')
  await act(async () => pending[0](result(0))); expect(view.container.textContent).toBe('clip:1000000')
})
