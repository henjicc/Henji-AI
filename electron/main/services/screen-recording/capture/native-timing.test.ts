import { describe, expect, it } from 'vitest'
import { recordingCombinedIntervals } from '../../../../../src/core/screenRecording/combine'
import fs from 'node:fs'
import { captureTimingGaps, captureTimingGroup, captureTimingLeadUs, captureTimingPauses, captureTimingRuns, parseCaptureTiming, TIMING_AFTER_SOURCE_LOST } from './native-timing'
import { CELL, pausedRecording, timingBytes } from './native-timing.test-support'


describe('原生画面采集的逐帧时刻表', () => {
  it('真实采集进程写的版本 1 样本读得出：约 40 秒 60 帧、中间暂停约 5 秒', () => {
    const timing = parseCaptureTiming(fs.readFileSync('tests/fixtures/persistence/capture-timing/v1.frames'))
    expect([timing.fpsNum, timing.fpsDen]).toEqual([60, 1])
    const runs = captureTimingRuns(timing)
    expect(runs).toHaveLength(2)
    expect(runs[0].frames + runs[1].frames).toBe(timing.cell.length)
    const [pause] = captureTimingPauses(timing, 1_000_000)
    expect(pause.startUs).toBe(1_000_000 + Math.round(runs[0].frames * 1e6 / 60))
    expect(Math.abs(pause.endUs - pause.startUs - 5_000_000)).toBeLessThan(100_000)
  })

  it('来源丢失的空档（标志 16）是文件里的空档，但不算暂停', () => {
    const timing = parseCaptureTiming(fs.readFileSync('tests/fixtures/persistence/capture-timing/v1.frames'))
    timing.flags[captureTimingRuns(timing)[1].frame] |= TIMING_AFTER_SOURCE_LOST
    expect(captureTimingPauses(timing, 0)).toEqual([])
    expect(captureTimingGaps(timing, 0).map(gap => gap.sourceLost)).toEqual([true])
  })

  it('读出完整的记录，进程被杀时写了一半的尾巴舍去', () => {
    const timing = parseCaptureTiming(Buffer.concat([pausedRecording(), Buffer.alloc(7)]))
    expect(timing.cell.length).toBe(180)
    expect(() => parseCaptureTiming(Buffer.from('nope'))).toThrow('格式无效')
  })
  it('格号不连续处分段；被丢弃的格子仍占帧序号，不把一段切开；只看文件里真有的帧', () => {
    const timing = parseCaptureTiming(pausedRecording())
    expect(captureTimingRuns(timing)).toMatchObject([{ frame: 0, cell: 0, frames: 90 }, { frame: 90, cell: 150, frames: 90 }])
    // 被杀后文件只读回 100 帧。
    expect(captureTimingRuns(timing, 100)).toMatchObject([{ frame: 0, cell: 0, frames: 90 }, { frame: 90, cell: 150, frames: 10 }])
  })
  it('上屏偏移取新画面相对格时刻的中位数（被丢弃的不算），与时钟校准无关', () => {
    expect(captureTimingLeadUs(parseCaptureTiming(pausedRecording()))).toBe(5000)
    expect(captureTimingLeadUs(parseCaptureTiming(timingBytes(0, [[0, 0, 0]])))).toBe(0)
  })
  it('暂停、合并各段与事件时钟扣掉的长度是同一组数：会话时刻处处落在正确的文件位置', () => {
    const timing = parseCaptureTiming(pausedRecording())
    const first = 2_000_000
    const pauses = captureTimingPauses(timing, first)
    expect(pauses).toEqual([{ startUs: first + 3_000_000, endUs: first + 5_000_000 }])
    const group = captureTimingGroup('screen-0', timing, first)!
    expect(group.frames).toBe(180)
    expect(group.parts.map(part => [part.mediaId, part.monoUs, part.frames, part.fileUs])).toEqual([['screen-0', first, 90, 0], ['screen-0', first + 5_000_000, 90, 3_000_000]])
    // 暂停后 1 秒的会话时刻：文件里是第 3 秒（暂停前录了 3 秒）再加 1 秒。
    expect(recordingCombinedIntervals(group, first + 6_000_000, first + 6_000_001)[0][0]).toBe(4_000_000)
    // 事件时钟：恢复时按“按下暂停 + 跳过的格时长”接着走，扣掉的正好是这段暂停。
    const pressedUs = first + 3_000_000, skippedUs = 60 * CELL
    expect(pressedUs + skippedUs).toBeCloseTo(pauses[0].endUs, 0)
    expect(captureTimingGroup('screen-0', parseCaptureTiming(timingBytes(0, [[0, 0, 1], [0, 1, 0]])), 0)).toBeNull()
  })
})
