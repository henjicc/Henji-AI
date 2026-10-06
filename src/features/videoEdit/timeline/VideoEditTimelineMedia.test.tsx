// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { resetFilmstripFramesForTests } from '@/services/videoFilmstrip/filmstripFrameService'
import type { WaveformSourceRef, WaveformState } from '@/hooks/useWaveformData'
import type { WaveformViewProps } from '@/components/waveform/WaveformView'
import { VideoEditTimeline } from '../VideoEditTimeline'
import { closeVideoEditProject, createVideoEditProject, editVideoProject, setVideoEditTimelineView, subscribeVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
// 固定源峰值；断言宿主传给统一绘制器的源范围与方向，不重复测试波形聚合算法。
vi.mock('@/hooks/useWaveformData', () => ({
  useWaveformDataList: (refs: readonly WaveformSourceRef[]): WaveformState[] => refs.map(ref => ({ status: 'ready', data: {
    key: ref.source, ref, gain: 1,
    pyramid: { version: 'fixture', sampleRate: 48000, frameCount: 90 * 48000, startSeconds: 0, endSeconds: 90, amplitudeScale: 1, peakMax: 1, channelCount: ref.channels, levels: [] },
  } })),
}))
vi.mock('@/components/waveform/WaveformView', () => ({
  WaveformView: ({ startSeconds, endSeconds, className }: WaveformViewProps) => <div className={className} data-wave-start={startSeconds} data-wave-end={endSeconds} />,
}))

let owner: VideoEditInstance
const onError = vi.fn()
function View(): React.ReactElement { useSyncExternalStore(subscribeVideoEdit, videoEditRevision); return <VideoEditTimeline instance={owner} onError={onError} /> }
beforeEach(async () => {
  installHarnessNativeStorage(); onError.mockClear()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/fixture/speed-media.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().video, 'getFilmstripFrame').mockImplementation(async ({ timeUs }) => ({ path: `D:/fixture/frame-${timeUs}.webp` }))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 900, bottom: 300, width: 900, height: 300, x: 0, y: 0, toJSON: () => ({}) })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
  owner = (await createVideoEditProject())!
  editVideoProject(owner.document.id, document => {
    document.media.push({ id: 'media', name: '视频', path: 'D:/fixture/video.mp4', kind: 'video', width: 64, height: 64, durationSeconds: 90, hasAudio: true })
    document.items.push({ id: 'item', name: '视频', kind: 'video', mediaId: 'media' })
    const sequence = document.sequences[0]
    sequence.clips = [{ ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: 30, track: sequence.tracks.find(track => track.kind === 'video')!.index }), duration: 120, sourceInUs: 5_000_000 }]
    return document
  })
  setVideoEditTimelineView(owner.document.id, { snapping: false })
})
afterEach(async () => { cleanup(); await closeVideoEditProject(owner.document.id); resetFilmstripFramesForTests(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it.each([
  { numerator: 1, denominator: 1, reverse: false, from: 5, to: 9 },
  { numerator: 2, denominator: 1, reverse: false, from: 5, to: 13 },
  { numerator: 1, denominator: 2, reverse: false, from: 5, to: 7 },
  { numerator: 2, denominator: 1, reverse: true, from: 5, to: 13 },
  { numerator: 1, denominator: 2, reverse: true, from: 11, to: 13 },
])('缩略帧与视频声音波形按 $numerator/$denominator、倒放 $reverse 映射源范围（4.13）', async ({ numerator, denominator, reverse, from, to }) => {
  editVideoProject(owner.document.id, document => {
    Object.assign(document.sequences[0].clips[0], { speed: { numerator, denominator }, ...(reverse ? { reverse: true } : {}), sourceInUs: reverse ? 13_000_000 : 5_000_000 })
    return document
  })
  const view = render(<View />)
  const strip = view.container.querySelector<HTMLElement>('[data-video-edit-filmstrip]')!
  await waitFor(() => expect(strip.querySelectorAll('img')).toHaveLength(Number(strip.dataset.filmstripTiles)))
  const times = [...strip.querySelectorAll('img')].map(img => Number(img.getAttribute('src')!.match(/frame-(\d+)\.webp/)![1]) / 1e6)
  expect(times.length).toBeGreaterThan(3)
  expect(times[0]).toBeCloseTo(reverse ? 13 - numerator / denominator / 30 : 5, 5)
  for (let index = 1; index < times.length; index++) {
    expect(times[index]).toBeGreaterThanOrEqual(from - 1e-6); expect(times[index]).toBeLessThan(to)
    if (reverse) expect(times[index]).toBeLessThanOrEqual(times[index - 1])
    else expect(times[index]).toBeGreaterThanOrEqual(times[index - 1])
  }
  // 最后一格距尾缘小于一格的源跨度加一格量化误差，足以区分 100% 与 200%。
  expect(Math.abs(times.at(-1)! - (reverse ? from : to))).toBeLessThan(1.1 * numerator / denominator)
  const wave = view.container.querySelector<HTMLElement>('[data-wave-start]')!
  expect(Number(wave.dataset.waveStart)).toBeCloseTo(from); expect(Number(wave.dataset.waveEnd)).toBeCloseTo(to)
  expect(wave.classList.contains('-scale-x-100')).toBe(reverse)
  expect(view.container.querySelector('[data-video-edit-waveform]')?.classList.contains('h-1/2')).toBe(true)
  expect(onError).not.toHaveBeenCalled()
})

it('滚动后的倒放音频片段与映射声道按可见源范围反转；方向切回不沿用倒放显示（4.13）', () => {
  editVideoProject(owner.document.id, document => {
    Object.assign(document.sequences[0].clips[0], { kind: 'audio', sourceComponent: 'audio', track: document.sequences[0].tracks.find(track => track.kind === 'audio')!.index, duration: 900, sourceInUs: 65_000_000, speed: { numerator: 2, denominator: 1 }, reverse: true, audioMapping: { format: 'stereo', sources: [{ stream: 0, channel: 0 }, { stream: 0, channel: 1 }] } })
    return document
  })
  const view = render(<View />); const host = view.getByRole('region', { name: '时间线编辑区域' })
  host.scrollLeft = 600; fireEvent.scroll(host)
  const waves = [...view.container.querySelectorAll<HTMLElement>('[data-wave-start]')]
  expect(waves).toHaveLength(2)
  for (const wave of waves) {
    expect(Number(wave.dataset.waveStart)).toBeCloseTo(24.7333333333)
    expect(Number(wave.dataset.waveEnd)).toBeCloseTo(47)
    expect(wave.classList.contains('-scale-x-100')).toBe(true)
  }
  expect(view.container.querySelector('[data-video-edit-filmstrip]')).toBeNull()
  act(() => editVideoProject(owner.document.id, document => { delete document.sequences[0].clips[0].reverse; document.sequences[0].clips[0].sourceInUs = 5_000_000; return document }))
  const forward = view.container.querySelector<HTMLElement>('[data-wave-start]')!
  expect(Number(forward.dataset.waveStart)).toBeCloseTo(23); expect(Number(forward.dataset.waveEnd)).toBeCloseTo(45.2666666667)
  expect(forward.classList.contains('-scale-x-100')).toBe(false); expect(onError).not.toHaveBeenCalled()
})
