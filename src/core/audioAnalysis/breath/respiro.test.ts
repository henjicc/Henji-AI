import { describe, expect, it } from 'vitest'
import { RESPIRO_CHUNK_FRAMES, RESPIRO_CHUNK_SAMPLES, RESPIRO_HOP, aggregateRespiro, respiroChunkStarts, respiroSegments, respiroWindow } from './respiro'

describe('呼吸声检测的切窗与区间', () => {
  it('不足 30 秒只有一窗；长录音 25 秒步长、最后一窗对齐结尾而不是补零', () => {
    expect(respiroChunkStarts(RESPIRO_CHUNK_SAMPLES - 1)).toEqual([0])
    expect(respiroChunkStarts(RESPIRO_CHUNK_SAMPLES)).toEqual([0])
    const total = 70 * 16000
    const starts = respiroChunkStarts(total)
    expect(starts).toEqual([0, 25 * 16000, total - RESPIRO_CHUNK_SAMPLES])
    expect(starts.at(-1)! + RESPIRO_CHUNK_SAMPLES).toBe(total)
  })

  it('短录音补零并给出有效帧数', () => {
    const { wave, frames } = respiroWindow(new Float32Array(16000).fill(0.5), 0)
    expect(wave).toHaveLength(RESPIRO_CHUNK_SAMPLES)
    expect(frames).toBe(1 + 16000 / RESPIRO_HOP)
    expect(wave[15999]).toBe(0.5)
    expect(wave[16000]).toBe(0)
    expect(respiroWindow(new Float32Array(RESPIRO_CHUNK_SAMPLES * 2), 0).frames).toBe(RESPIRO_CHUNK_FRAMES)
  })

  it('重叠处每帧取离窗口边缘最远的那一窗', () => {
    const total = 40 * 16000
    const starts = respiroChunkStarts(total)
    const probabilities = starts.map((_, index) => new Float32Array(RESPIRO_CHUNK_FRAMES).fill(index + 1))
    const merged = aggregateRespiro(total, starts, probabilities)
    expect(merged).toHaveLength(1 + total / RESPIRO_HOP)
    expect(merged[100]).toBe(1)
    expect(merged[merged.length - 100]).toBe(2)
    // 重叠段（10 s–30 s）中点以前离第一窗边缘更远，之后离第二窗更远
    expect(merged[1900]).toBe(1)
    expect(merged[2100]).toBe(2)
  })

  it('超过阈值且长于 200 ms 才算一口气，记下区间与峰值', () => {
    const probs = new Float32Array(200)
    probs.fill(0.9, 10, 40)
    probs.fill(0.5, 60, 75)
    probs[100] = 1
    expect(respiroSegments(probs)).toEqual([{ startMs: 100, endMs: 400, peak: expect.closeTo(0.9, 5) }])
    expect(respiroSegments(probs, 0.064, 10)).toHaveLength(2)
  })
})
