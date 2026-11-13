import { describe, expect, it } from 'vitest'
import { documentKindMinReaderVersion } from './registry'
import { videoEditDocumentKind } from './videoEdit'

describe('按文件取最低可读版本', () => {
  it('没有按内容区分的取登记值；按内容取的值生效但不超过登记的上限', () => {
    expect(documentKindMinReaderVersion(videoEditDocumentKind, {})).toBe(videoEditDocumentKind.minReaderVersion ?? videoEditDocumentKind.version)
    expect(documentKindMinReaderVersion({ version: 5 }, {})).toBe(5)
    expect(documentKindMinReaderVersion({ version: 5, minReaderVersion: 3, minReaderVersionFor: () => 9 }, {})).toBe(3)
    expect(documentKindMinReaderVersion({ version: 5, minReaderVersion: 4, minReaderVersionFor: () => 2 }, {})).toBe(2)
  })
})
