import { expect, it } from 'vitest'
import { CaptureLogCollector } from '../captureLog/collector'
import type { CaptureEvent } from '../captureLog/events'
import { captureOptionsSchema } from './capture'
import { createRecordingDocument, type RecordingDocument } from './document'
import { recordingDurationUs } from './range'
import { alignRecordingPauses, recordingCombinePlan, recordingCombinedIntervals, PAUSE_ALIGNMENT_TOLERANCE_US } from './combine'

const s = (seconds: number): number => Math.round(seconds * 1e6)
function recording(screens: Array<[number, number]>, pauses: Array<[number, number]>, range: [number, number]): RecordingDocument {
  const value = createRecordingDocument()
  value.status = 'stopped'
  value.source = { name: '屏幕', options: captureOptionsSchema.parse({ sourceId: 'screen:0:0', width: 1920, height: 1080, fps: 60, bitrate: 12000000 }), cursorEmbedded: false }
  value.startUs = s(range[0]); value.endUs = s(range[1])
  value.pauses = pauses.map(([start, end]) => ({ startUs: s(start), endUs: s(end) }))
  value.media = screens.map(([start, end], index) => ({ id: `screen-${index}`, kind: 'screen', path: `/screen-${index}.mp4`, monoUs: s(start), durationUs: s(end - start) }))
  return value
}

it('暂停对齐到恢复后画面第一帧后合成一组：时长等于各段之和，合并文件上的事件与画面处处对齐', async () => {
  // 事件时钟：1.0 秒开始，10.0 秒按暂停，恢复时从画面第一帧 12.0 秒接着走。
  const pages: CaptureEvent[] = []
  const collector = new CaptureLogCollector({ ownerRef: { kind: 'screen_recording.session', id: 's' }, sourceDigest: `sha256:${'a'.repeat(64)}`, originUs: 0, id: () => crypto.randomUUID() }, async page => { pages.push(...page.entries) }, error => { throw error })
  collector.start(s(1)); collector.record(s(5), { kind: 'cursor', point: [0.1, 0.1], shape: 'arrow' })
  collector.pause(s(10)); collector.resume(s(12)); collector.record(s(15), { kind: 'cursor', point: [0.2, 0.2], shape: 'arrow' })
  await collector.stop(s(20))
  const controls = pages.flatMap(event => event.kind === 'control' && (event.action === 'pause' || event.action === 'resume') ? [{ action: event.action, monoUs: event.monoUs }] : [])
  // 文档里记的暂停：按下暂停到恢复命令完成，比画面第一帧晚 0.1 秒。
  const value = recording([[1, 10.4], [12, 21]], [[10, 12.1]], [1.5, 20])
  value.pauses = alignRecordingPauses(value.pauses, controls, value.media)
  expect(value.pauses).toEqual([{ startUs: s(10), endUs: s(12) }])
  const plan = recordingCombinePlan(value)!
  expect(plan).toHaveLength(1)
  const [group] = plan
  expect(group.parts.map(part => part.mediaId)).toEqual(['screen-0', 'screen-1'])
  // 合并文件从第一片的第一帧（含倒计时预热的 0.5 秒）到停止，暂停不在里面。
  expect(group.frames).toBe(Math.round((value.endUs! - s(1) - (value.pauses![0].endUs - value.pauses![0].startUs)) * 60 / 1e6))
  expect(group.parts.reduce((sum, part) => sum + part.frames, 0)).toBe(group.frames)
  const [kept] = recordingCombinedIntervals(group, value.startUs!, value.endUs!)
  expect(Math.abs(kept[1] - kept[0] - recordingDurationUs(value))).toBeLessThan(1e6 / 60)
  // 光标在剪辑里按 recordingUs = recordingStartUs + 文件时间 取；recordingStartUs 是第一帧的事件时间。
  const recordingStartUs = group.parts[0].monoUs - (pages[0].monoUs - pages[0].recordingUs)
  for (const event of pages.filter(event => event.kind === 'cursor')) {
    const [[fileUs]] = recordingCombinedIntervals(group, event.monoUs, event.monoUs + 1)
    expect(Math.abs(recordingStartUs + fileUs - event.recordingUs)).toBeLessThan(1e6 / 120)
  }
})

it('较早版本的会话（事件时钟晚于画面约 1 秒恢复）暂停不改、不合并；编码重启的真实空档分成两组', () => {
  const late = recording([[1, 10.4], [12, 21]], [[10, 13.1]], [1.5, 20])
  expect(alignRecordingPauses(late.pauses, [{ action: 'pause', monoUs: s(10) }, { action: 'resume', monoUs: s(12) + PAUSE_ALIGNMENT_TOLERANCE_US + 1 }], late.media)).toEqual(late.pauses)
  expect(recordingCombinePlan(late)).toBeNull()
  // 第一、二片之间是编码器重启留下的空档（没有暂停），第二、三片之间是暂停。
  const restarted = recording([[1, 10], [11, 15.2], [16, 21]], [[15, 16]], [1.5, 20])
  const groups = recordingCombinePlan(restarted)!
  expect(groups.map(group => group.parts.map(part => part.mediaId))).toEqual([['screen-0'], ['screen-1', 'screen-2']])
  // 编码参数不同（中途改用软件编码）的两片也不接。
  expect(recordingCombinePlan(restarted, new Map([['screen-0', 'a'], ['screen-1', 'a'], ['screen-2', 'b']]))).toBeNull()
  // 两次暂停一次对齐、一次没对齐（文档暂停到 23.1 秒，画面 22 秒就恢复了）：整次录制逐片导入。
  const partly = recording([[1, 10.4], [12, 20.4], [22, 30]], [[10, 12], [20, 23.1]], [1.5, 29])
  expect(recordingCombinePlan(partly)).toBeNull()
  // 暂停着按停止：没有恢复，那次暂停照原样保留。
  expect(alignRecordingPauses([{ startUs: s(10), endUs: s(10) }], [{ action: 'pause', monoUs: s(10) }], [])).toEqual([{ startUs: s(10), endUs: s(10) }])
})

it('跨暂停的一路声音在合并文件里首尾相接，设备空档仍分开', () => {
  const value = recording([[1, 10.4], [12, 21]], [[10, 12]], [1.5, 20])
  const [group] = recordingCombinePlan(value)!
  const pieces = [[s(0.5), s(10)], [s(12), s(14)], [s(15), s(20)]].flatMap(([start, end]) => recordingCombinedIntervals(group, start, end))
  expect(pieces.map(([start, end]) => [Math.round(start / 1000), Math.round(end / 1000)])).toEqual([[0, 9000], [9000, 11000], [12000, 17000]])
})
