import { afterEach, expect, it, vi } from 'vitest'
import { audibleVideoEditClips, videoEditClipMedia, type VideoEditComposition, type VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditSourceSeconds } from '@/core/videoEdit/time'
import { VideoEditSourceSoundPlayer, videoEditSourceSoundComposition } from './videoEditSourceSound'
import type { VideoEditRenderSession } from './videoEditRenderSession'

vi.mock('./videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}} }))

const video: VideoEditMedia = { id: 'm', name: 'ProRes', path: 'D:/a.mov', kind: 'video', width: 3840, height: 2160, durationSeconds: 7.25, frameRate: { numerator: 30000, denominator: 1001 } }

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('源声音序列只有一个可闻片段：从素材开头、满音量、覆盖整段，时间轴秒数即源秒数', () => {
  for (const media of [video, { ...video, kind: 'audio' as const, width: 0, height: 0, frameRate: undefined }]) {
    const document = videoEditSourceSoundComposition(media)
    const [clip] = audibleVideoEditClips(document)
    expect(audibleVideoEditClips(document)).toHaveLength(1)
    expect(videoEditClipMedia(document, clip)?.path).toBe(media.path)
    expect(clip.start).toBe(0); expect(videoEditSourceSeconds(clip)).toBe(0); expect(clip.volume).toBe(1)
    expect(clip.duration / document.fps).toBeGreaterThanOrEqual(media.durationSeconds)
    expect(document.sampleRate).toBe(48000); expect(document.channels).toBe(2)
  }
  expect(() => videoEditSourceSoundComposition({ ...video, kind: 'image' })).toThrow('源声音')
})

it('声音按画面时钟对齐：源秒数在 performance 时刻 at 发声，经音量与电平；关闭时释放音频设备与混音会话', async () => {
  const created: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn> }> = []
  const sources: Array<{ start: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }> = []
  // The audio clock reads 5s once, then runs at 5.01s (prepare waits until it moves).
  let reads = 0
  const context = {
    get currentTime() { return reads++ < 1 ? 5 : 5.01 }, sampleRate: 48000, destination: {},
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    createGain: () => { const node = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn(), channelCount: 2, channelCountMode: 'max' }; created.push(node); return node },
    createChannelSplitter: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
    createAnalyser: () => ({ fftSize: 0, smoothingTimeConstant: 0, connect: vi.fn(), disconnect: vi.fn(), getFloatTimeDomainData: vi.fn() }),
    createBufferSource: () => { const source = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), buffer: null, onended: null }; sources.push(source); return source },
  }
  vi.stubGlobal('AudioContext', vi.fn(() => context))
  vi.spyOn(performance, 'now').mockReturnValue(1000)
  const mixes: Array<[number, number]> = []
  const session = { mixAudio: vi.fn(async (from: number, duration: number) => { mixes.push([from, duration]); return { duration } }), dispose: vi.fn(async () => undefined) }
  const documents: VideoEditComposition[] = []
  const player = new VideoEditSourceSoundPlayer(video, document => { documents.push(document); return session as unknown as VideoEditRenderSession })
  await player.prepare(1.4)
  expect(created.at(-1)!.gain.value).toBe(1)
  // Source 2.0s is due 16.7ms after now: it sounds 16.7ms after the current audio time.
  player.start(2, 1016.7)
  player.pump(2, () => true, () => {})
  expect(mixes).toEqual([[2, .5]])
  await vi.waitFor(() => expect(sources).toHaveLength(1))
  expect(sources[0].start.mock.calls[0][0]).toBeCloseTo(5.01 + .0167, 9); expect(sources[0].start.mock.calls[0][1]).toBe(0)
  // Through the monitor volume (clamped to 1), then the level meter.
  expect(sources[0].connect).toHaveBeenCalledWith(created.at(-1))
  expect(documents).toHaveLength(1)
  await player.dispose()
  expect(context.close).toHaveBeenCalledOnce(); expect(session.dispose).toHaveBeenCalledOnce()
  await expect(player.prepare(1)).rejects.toThrow('源声音已关闭。')
})
