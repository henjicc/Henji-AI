import { describe, expect, it } from 'vitest'
import { createRecordingDocument } from './document'
import { recordingMediaSpans, recordingRange } from './range'

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
