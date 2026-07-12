import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeAssetPath } from '../../electron/main/services/asset-library/mediaInspection'

describe('normalizeAssetPath', () => {
  it('normalizes an absolute local path', () => {
    const input = path.resolve('fixtures', '..', 'fixtures', 'asset.png')
    const expected = process.platform === 'win32' ? path.normalize(input).toLowerCase() : path.normalize(input)
    expect(normalizeAssetPath(input)).toBe(expected)
  })

  it.each(['blob:temporary', 'data:image/png;base64,AA==', 'https://example.com/a.png'])(
    'rejects unstable source %s',
    (source) => expect(() => normalizeAssetPath(source)).toThrow('已落盘')
  )

  it('rejects relative paths', () => {
    expect(() => normalizeAssetPath('asset.png')).toThrow('绝对路径')
  })
})
