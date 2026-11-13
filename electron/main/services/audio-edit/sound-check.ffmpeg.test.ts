import { expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { summarizeAudioEditSound, type AudioEditSoundStats } from '../../../../src/core/audioEdit/soundCheck'
import { measureAudioFileLoudness, measureAudioFileLoudnessTimeline } from '../audio/loudness'
import { createF32WavWriter } from './pcm-wav'
import { runAudioEditPcmJob } from './pcm-jobs'

// 真实 FFmpeg 子进程：冷启动可能超过默认 5 秒
vi.setConfig({ testTimeout: 30_000 })

it('成品读回：分段响度与 FFmpeg 对同一段的积分一致，位置换算到剪后作品时间', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-sound-check-'))
  try {
    const rate = 48000, file = path.join(directory, 'finished.wav'), signal = new AbortController().signal
    // 0–6 秒 -6 dB 正弦（3 秒处有 5 毫秒满刻度），6–7.5 秒静音，7.5–12 秒 -26 dB 正弦；双声道
    const frames = rate * 12
    const data = new Float32Array(frames * 2)
    for (let frame = 0; frame < frames; frame++) {
      const seconds = frame / rate
      const level = seconds < 6 ? -6 : seconds < 7.5 ? -Infinity : -26
      let value = Number.isFinite(level) ? 10 ** (level / 20) * Math.sin(2 * Math.PI * 1000 * frame / rate) : 0
      if (seconds >= 3 && seconds < 3.005) value = 1
      data[frame * 2] = value; data[frame * 2 + 1] = value
    }
    const writer = await createF32WavWriter(file, rate, 2, frames)
    await writer.write(data); await writer.close()

    // 只测作品的 1–12 秒
    const timeline = await measureAudioFileLoudnessTimeline(file, rate, rate * 11, rate, signal)
    expect(timeline.momentaryLufs.length).toBeGreaterThanOrEqual(109)
    expect(timeline.loudnessRangeLu).not.toBeNull()
    const stats = await runAudioEditPcmJob({ kind: 'sound-stats', input: file, startFrame: rate, endFrame: rate * 12 }) as AudioEditSoundStats
    const result = summarizeAudioEditSound(stats, { integratedLufs: timeline.measurement.integratedLufs, loudnessRangeLu: timeline.loudnessRangeLu, truePeakDbtp: timeline.measurement.truePeakDbtp, momentaryLufs: timeline.momentaryLufs },
      { offsetSeconds: 1, windowSeconds: 5, silenceDb: -40, longPauseSeconds: 0.8, includeWindows: true })

    expect(result.startSeconds).toBe(1)
    expect(result.endSeconds).toBe(12)
    expect(result.clipping.count).toBe(1)
    expect(result.clipping.ranges[0].startSeconds).toBeCloseTo(3, 2)
    expect(result.silence.longPauses).toHaveLength(1)
    expect(result.silence.longPauses[0].startSeconds).toBeCloseTo(6, 1)
    expect(result.silence.longPauses[0].seconds).toBeCloseTo(1.5, 1)
    // 分段 [6, 11) 秒：与 FFmpeg 只测这一段的积分响度同一口径
    const direct = await measureAudioFileLoudness(file, rate * 6, rate * 5, rate, signal)
    const window = result.windows!.find(item => item.startSeconds === 6)!
    expect(Math.abs(window.lufs! - direct.integratedLufs!)).toBeLessThanOrEqual(0.2)
    expect(result.keyWindows.map(item => item.note)).toContain('clipping')
    expect(result.loudness.truePeakDbtp).toBeGreaterThan(-0.5)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
