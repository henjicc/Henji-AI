import { expect, it, vi } from 'vitest'
import { DEFAULT_AUDIO_EDIT_SETTINGS } from '../../../../src/core/audioEdit/edits'
import { detectAudioEditSilence } from './silence'
import { requireAudioEditProject } from './project-store'
import { runAudioEditTask } from './task-store'
import { runAudioEditProcess } from './process'
import { analyzeSpeechEnergy } from './speech-energy'

vi.mock('./speech-energy', () => ({ analyzeSpeechEnergy: vi.fn() }))

vi.mock('./project-store', () => ({ requireAudioEditProject: vi.fn() }))
vi.mock('./media', () => ({
  probeAudioEditImport: vi.fn(async () => ({ sourcePath: 'voice.wav', audioPath: 'voice.wav', sampleRate: 24000, durationFrames: 72000, ownership: 'external', audioStreamIndex: 1, identity: 'fixture' })),
  verifyAudioEditSource: vi.fn(async () => undefined),
}))
vi.mock('../video/ffmpeg-loader', () => ({ loadFfmpegPath: vi.fn(async () => 'ffmpeg') }))
vi.mock('./process', () => ({ runAudioEditProcess: vi.fn(async (_binary: string, _args: string[], _signal: AbortSignal, onLine: (line: string) => void) => {
  onLine('silence_start: 1.2'); onLine('silence_end: 1.6'); return ''
}) }))
vi.mock('./task-store', () => ({ registerAudioEditTaskController: () => () => {}, runAudioEditTask: vi.fn(async (_id: string, _kind: string, operation: (signal: AbortSignal, progress: (value: number) => void) => Promise<unknown>) => operation(new AbortController().signal, () => undefined)) }))

it('无口播文档的源声音复用静音检测，不创建或读取文档，沿只读任务执行', async () => {
  const result = await detectAudioEditSilence({ sourcePath: 'voice.wav', requestId: 'pause-map', settings: { ...DEFAULT_AUDIO_EDIT_SETTINGS, silenceThresholdMs: 100, retainedSilenceMs: 0, trimEdges: true } })
  expect(result.suggestions).toMatchObject([{ startFrame: 28800, endFrame: 38400, evidence: 'audio' }])
  expect(requireAudioEditProject).not.toHaveBeenCalled()
  expect(vi.mocked(runAudioEditTask).mock.calls[0][5]).toBe(true)
  expect(vi.mocked(runAudioEditProcess).mock.calls[0][1]).toContain('0:1')
})

it('自适应分析经现有静音任务返回毫秒证据，建议仍遵守源采样帧范围', async () => {
  const energy = { resolutionMs: 10, thresholdDb: -48, highThresholdDb: -72, pauses: [{ startMs: 1200, endMs: 1600, cutMs: 1400 }] }
  vi.mocked(analyzeSpeechEnergy).mockResolvedValueOnce(energy)
  const result = await detectAudioEditSilence({ sourcePath: 'voice.wav', energy: { channels: [{ stream: 0, channel: 1 }] }, range: { startFrame: 24000, endFrame: 48000 }, settings: { ...DEFAULT_AUDIO_EDIT_SETTINGS, silenceThresholdMs: 100, retainedSilenceMs: 0, trimEdges: true } })
  expect(result.energy).toEqual(energy)
  expect(result.suggestions).toMatchObject([{ startFrame: 28800, endFrame: 38400, evidence: 'audio' }])
  expect(vi.mocked(analyzeSpeechEnergy).mock.calls.at(-1)![1]).toEqual({ channels: [{ stream: 0, channel: 1 }] })
})
