import { describe, expect, it } from 'vitest'
import { documentKindMinReaderVersion } from './registry'
import { videoEditDocumentKind } from './videoEdit'
import { audioEditDocumentKind } from './audioEdit'

describe('按文件取最低可读版本', () => {
  it('没有按内容区分的取登记值；按内容取的值生效但不超过登记的上限', () => {
    expect(documentKindMinReaderVersion(videoEditDocumentKind, {})).toBe(videoEditDocumentKind.minReaderVersion ?? videoEditDocumentKind.version)
    expect(documentKindMinReaderVersion({ version: 5 }, {})).toBe(5)
    expect(documentKindMinReaderVersion({ version: 5, minReaderVersion: 3, minReaderVersionFor: () => 9 }, {})).toBe(3)
    expect(documentKindMinReaderVersion({ version: 5, minReaderVersion: 4, minReaderVersionFor: () => 2 }, {})).toBe(2)
  })

  it('口播只有参考稿超过旧版 20 万字上限时才要求新版程序', () => {
    const content = (length: number) => ({ ...audioEditDocumentKind.createEmptyContent(), referenceScript: '稿'.repeat(length) })
    expect(documentKindMinReaderVersion(audioEditDocumentKind, content(200000))).toBe(8)
    expect(documentKindMinReaderVersion(audioEditDocumentKind, content(200001))).toBe(10)
  })
})
