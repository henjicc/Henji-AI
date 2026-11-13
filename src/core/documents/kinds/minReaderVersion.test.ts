import { describe, expect, it } from 'vitest'
import { createRecordingDocument } from '../../screenRecording/document'
import { documentKindMinReaderVersion } from './registry'
import { screenRecordingDocumentKind } from './screenRecording'
import { videoEditDocumentKind } from './videoEdit'

describe('按文件取最低可读版本', () => {
  const recording = (gaps?: Array<{ startUs: number; endUs: number }>) => ({
    ...createRecordingDocument(),
    media: [{ id: 'screen-0', kind: 'screen' as const, path: '/screen.mp4', monoUs: 0, durationUs: 1_000_000, ...(gaps ? { gaps } : {}) }],
  })

  it('录制会话：没有连续文件的写 77（旧程序照常打开），有连续文件的写 82（旧程序报“请升级”）', () => {
    expect(documentKindMinReaderVersion(screenRecordingDocumentKind, recording())).toBe(77)
    expect(documentKindMinReaderVersion(screenRecordingDocumentKind, recording([]))).toBe(82)
    expect(documentKindMinReaderVersion(screenRecordingDocumentKind, recording([{ startUs: 10, endUs: 20 }]))).toBe(82)
    // 按文件取的值不会高过登记的上限。
    expect(screenRecordingDocumentKind.minReaderVersion).toBe(82)
  })

  it('没有按内容区分的文档类型仍是登记的固定值', () => {
    expect(documentKindMinReaderVersion(videoEditDocumentKind, {})).toBe(videoEditDocumentKind.minReaderVersion ?? videoEditDocumentKind.version)
    expect(documentKindMinReaderVersion({ version: 5 }, {})).toBe(5)
    expect(documentKindMinReaderVersion({ version: 5, minReaderVersion: 3, minReaderVersionFor: () => 9 }, {})).toBe(3)
  })
})
