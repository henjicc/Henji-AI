import { afterEach, expect, it } from 'vitest'
import { AudioLoudnessSession } from './loudness'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { runAudioEditProcess } from '../audio-edit/process'
import { analyzeSpeechEnergy } from '../audio-edit/speech-energy'

const sessions: AudioLoudnessSession[] = []
afterEach(async () => { await Promise.all(sessions.splice(0).map(session => session.close())) })
it.each([44100, 48000])('%iHz 后台 FFmpeg 返回真实非静音区间、首尾静音与轻声敏感度', async rate => {
  const session = new AudioLoudnessSession(rate, 1); sessions.push(session); await session.initialize()
  for (let second = 0; second < 4; second++) await session.append([Float32Array.from({ length: rate }, (_, index) => second === 1 || second === 2 ? 0.003 * Math.sin(2 * Math.PI * 1000 * index / rate) : 0)])
  expect(await session.detectActivity(0)).toEqual([])
  const ranges = await session.detectActivity(100)
  expect(ranges).toHaveLength(1); expect(ranges[0].startSeconds).toBeCloseTo(1, 3); expect(ranges[0].endSeconds).toBeCloseTo(3, 3)
})
it('全静音、全有声以及关闭后拒绝新分析', async () => {
  const silence = new AudioLoudnessSession(48000, 1); sessions.push(silence); await silence.initialize(); await silence.append([new Float32Array(48000)])
  expect(await silence.detectActivity(50)).toEqual([])
  const sound = new AudioLoudnessSession(48000, 2); sessions.push(sound); await sound.initialize(); await sound.append([new Float32Array(48000).fill(.2), new Float32Array(48000).fill(.1)])
  expect(await sound.detectActivity(50)).toEqual([{ startSeconds: 0, endSeconds: 1 }])
  await sound.close(); await expect(sound.detectActivity(50)).rejects.toThrow('关闭')
})

it.each([1, .03])('真实FFmpeg：增益%s下保护轻声高频尾音，反相立体声不伪造静音', async gain => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-speech-energy-'))
  try {
    const file = path.join(directory, 'voice.wav')
    const speech = `${gain}*if(lt(t,0.4),0.1*sin(2*PI*500*t),if(lt(t,0.7),0.001*sin(2*PI*5000*t),if(lt(t,1),0,0.1*sin(2*PI*500*t))))`
    await runAudioEditProcess(await loadFfmpegPath(), ['-hide_banner', '-f', 'lavfi', '-i', `aevalsrc='${speech}|-(${speech})':s=16000:d=1.4`, '-c:a', 'pcm_f32le', file])
    const source = { sourcePath: file, audioPath: file, sampleRate: 16000, durationFrames: 22400, channels: 2, mediaType: 'audio' as const, ownership: 'external' as const, audioStreamIndex: 0 }
    const verify = async (): Promise<void> => { expect((await fs.stat(file)).size).toBeGreaterThan(1000) }
    const result = await analyzeSpeechEnergy(source, {}, new AbortController().signal, () => undefined, verify)
    expect(result.pauses).toHaveLength(1)
    expect(result.pauses[0].startMs).toBeGreaterThanOrEqual(700)
    expect(result.pauses[0].startMs).toBeLessThanOrEqual(730)
    expect(result.pauses[0].endMs).toBe(1000)
    expect(result.pauses[0].cutMs).toBeGreaterThan(700)
    const selected = await analyzeSpeechEnergy(source, { channels: [{ stream: 0, channel: 1 }] }, new AbortController().signal, () => undefined, verify)
    expect(selected.pauses).toEqual(result.pauses)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

it('60分钟声音分析保持10毫秒精度并复用同内容结果', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-speech-long-'))
  try {
    const file = path.join(directory, 'long.flac')
    await runAudioEditProcess(await loadFfmpegPath(), ['-hide_banner', '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,10),9.7),0.1*sin(2*PI*500*t),0)':s=16000:d=3600", '-c:a', 'flac', file])
    const source = { sourcePath: file, audioPath: file, sampleRate: 16000, durationFrames: 57_600_000, channels: 1, mediaType: 'audio' as const, ownership: 'external' as const, audioStreamIndex: 0, identity: { size: (await fs.stat(file)).size, mtimeMs: 1, digest: crypto.randomUUID() } }
    const began = performance.now()
    const first = await analyzeSpeechEnergy(source, {}, new AbortController().signal, () => undefined, async () => undefined)
    const analysisMs = performance.now() - began
    const cachedAt = performance.now()
    const second = await analyzeSpeechEnergy(source, {}, new AbortController().signal, () => undefined, async () => undefined)
    const cachedMs = performance.now() - cachedAt
    expect(first.resolutionMs).toBe(10)
    expect(first.pauses).toHaveLength(360)
    expect(first.pauses.at(-1)!.endMs).toBe(3_600_000)
    expect(second).toEqual(first)
    process.stdout.write(`speech-energy 60min ${JSON.stringify({ analysisMs: Math.round(analysisMs), cachedMs: Math.round(cachedMs), pauses: first.pauses.length })}\n`)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}, 120_000)

it('指定第二声音流使用其实际采样长度，末尾不足10毫秒不补假静音', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-speech-stream-'))
  try {
    const file = path.join(directory, 'streams.mkv')
    await runAudioEditProcess(await loadFfmpegPath(), ['-hide_banner', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=8000:duration=2', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=1.405', '-map', '0:a:0', '-map', '1:a:0', '-c:a', 'pcm_f32le', file])
    const source = { sourcePath: file, audioPath: file, sampleRate: 8000, durationFrames: 16000, channels: 1, mediaType: 'audio' as const, ownership: 'external' as const, audioStreamIndex: 0 }
    const result = await analyzeSpeechEnergy(source, { channels: [{ stream: 1, channel: 0 }] }, new AbortController().signal, () => undefined, async () => undefined)
    expect(result.pauses).toEqual([{ startMs: 0, endMs: 1405, cutMs: 702.5 }])
    const combined = await analyzeSpeechEnergy(source, { channels: [{ stream: 0, channel: 0 }, { stream: 1, channel: 0 }] }, new AbortController().signal, () => undefined, async () => undefined)
    expect(combined.pauses).toEqual([])
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
