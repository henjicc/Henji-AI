import { describe, expect, it } from 'vitest'
import { createRecordingDocument } from './document'
import { recordingFileUs, recordingMediaEndUs, recordingMediaSpans, recordingRange, recordingSessionUs } from './range'

const recording = () => {
  const document = createRecordingDocument()
  document.media = [
    { id: 'mic', kind: 'microphone', path: '/mic.wav', monoUs: 500_000, durationUs: 9_000_000 },
    { id: 'screen-0', kind: 'screen', path: '/screen.mp4', monoUs: 1_300_000, durationUs: 9_400_000 },
  ]
  return document
}

describe('录制共享区间', () => {
  it('倒计时内预热的声音和画面、停止后编码器多出的尾巴都被裁掉，各轨从同一起点开始、在同一终点结束', () => {
    const document = { ...recording(), startUs: 3_000_000, endUs: 9_000_000 }
    expect(recordingRange(document)).toEqual({ startUs: 3_000_000, endUs: 9_000_000 })
    expect(document.media.map(media => recordingMediaSpans(document, media).map(span => [span.startUs, span.endUs]))).toEqual([[[3_000_000, 9_000_000]], [[3_000_000, 9_000_000]]])
  })
  it('没有记录开始结束的旧会话：以画面为准，开头不出现无画面的声音', () => {
    const document = recording()
    expect(recordingRange(document)).toEqual({ startUs: 1_300_000, endUs: 10_700_000 })
    expect(recordingMediaSpans(document, document.media[0]).map(span => span.startUs)).toEqual([1_300_000])
  })
  it('倒计时内就停止：区间为空，没有任何片段', () => {
    const document = { ...recording(), startUs: 2_000_000, endUs: 2_000_000 }
    expect(document.media.flatMap(media => recordingMediaSpans(document, media))).toEqual([])
  })
})

it('暂停区间对所有轨道一起生效：继续时声音比画面早开、暂停时画面比声音晚停的部分都不保留', () => {
  const document = { ...recording(), startUs: 1_300_000, endUs: 9_000_000, pauses: [{ startUs: 4_000_000, endUs: 5_200_000 }] }
  expect(document.media.map(media => recordingMediaSpans(document, media).map(span => [span.startUs, span.endUs]))).toEqual([
    [[1_300_000, 4_000_000], [5_200_000, 9_000_000]],
    [[1_300_000, 4_000_000], [5_200_000, 9_000_000]],
  ])
})

describe('会话时刻与文件内位置', () => {
  // 连续文件：录 2 秒、暂停 3 秒、再录 4 秒，文件里只有 6 秒画面。
  const continuous = { id: 'screen-0', kind: 'screen' as const, path: '/screen.mp4', monoUs: 1_000_000, durationUs: 6_000_000, gaps: [{ startUs: 3_000_000, endUs: 6_000_000 }] }
  const plain = { id: 'screen-0', kind: 'screen' as const, path: '/screen.mp4', monoUs: 1_000_000, durationUs: 6_000_000 }

  it('普通文件按“会话时刻减起点”，连续文件扣掉之前跳过的时间段，两个方向互为反函数', () => {
    expect(recordingFileUs(plain, 7_500_000)).toBe(6_500_000)
    expect(recordingFileUs(continuous, 2_500_000)).toBe(1_500_000)
    expect(recordingFileUs(continuous, 7_500_000)).toBe(3_500_000)
    // 落在暂停里的时刻对到继续后的第一帧。
    expect(recordingFileUs(continuous, 4_000_000)).toBe(2_000_000)
    expect(recordingSessionUs(continuous, 3_500_000)).toBe(7_500_000)
    expect(recordingSessionUs(plain, 3_500_000)).toBe(4_500_000)
    expect(recordingMediaEndUs(continuous)).toBe(10_000_000)
    expect(recordingMediaEndUs(plain)).toBe(7_000_000)
  })

  it('连续文件按暂停切成几段，每段带着它在文件里的位置；后一段紧接前一段', () => {
    const document = createRecordingDocument()
    document.media = [continuous]
    document.pauses = [{ startUs: 3_000_000, endUs: 6_000_000 }]
    expect(recordingMediaSpans(document, continuous).map(({ startUs, endUs, fileUs }) => ({ startUs, endUs, fileUs }))).toEqual([
      { startUs: 1_000_000, endUs: 3_000_000, fileUs: 0 },
      { startUs: 6_000_000, endUs: 10_000_000, fileUs: 2_000_000 },
    ])
    document.media = [plain]
    document.pauses = []
    expect(recordingMediaSpans(document, plain).map(({ startUs, endUs, fileUs }) => ({ startUs, endUs, fileUs }))).toEqual([{ startUs: 1_000_000, endUs: 7_000_000, fileUs: 0 }])
  })
})
