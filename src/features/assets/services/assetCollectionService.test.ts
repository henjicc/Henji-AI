import { describe, expect, it } from 'vitest'
import { resolveLocalAssetPath } from './assetCollectionService'

describe('resolveLocalAssetPath', () => {
  it('解析 Electron 媒体协议中的 Windows 路径', () => {
    expect(resolveLocalAssetPath('henji-media://local/C%3A%5CMedia%5Cdemo.png'))
      .toBe('C:\\Media\\demo.png')
  })

  it('保留原始本地路径并拒绝远程或内存 URL', () => {
    expect(resolveLocalAssetPath('D:\\Videos\\demo.mp4')).toBe('D:\\Videos\\demo.mp4')
    expect(resolveLocalAssetPath('https://example.com/demo.png')).toBeNull()
    expect(resolveLocalAssetPath('blob:demo')).toBeNull()
  })
})
