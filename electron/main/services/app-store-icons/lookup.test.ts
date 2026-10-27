import { describe, expect, it } from 'vitest'
import { filterAppStoreResults, iconArtworkUrl, parseAppStoreInput } from './lookup'

describe('App Store 输入和图标契约', () => {
  it.each(['腾讯元宝', '元宝', '12345', 'http://apps.apple.com/cn/app/a/id6480446430', 'https://example.com/cn/app/id6480446430'])('名称和非苹果链接不解析为编号：%s', input => {
    expect(parseAppStoreInput(input)).toBeNull()
  })
  it.each(['6480446430', ' id6480446430 ', 'ID6480446430'])('解析编号 %s', input => {
    expect(parseAppStoreInput(input)).toEqual({ id: '6480446430', country: null })
  })
  it('链接地区优先；保留上游允许的无地区链接和短链接编号', () => {
    expect(parseAppStoreInput('https://apps.apple.com/US/app/元宝/id6480446430?l=zh')).toEqual({ id: '6480446430', country: 'us' })
    expect(parseAppStoreInput('https://apps.apple.com/app/id123/')).toEqual({ id: '123', country: null })
  })
  it.each([256, 512, 1024] as const)('改写 %i 分辨率的两种形状和源后缀', resolution => {
    for (const extension of ['jpg', 'png']) for (const shape of ['official', 'square'] as const) {
      expect(iconArtworkUrl(`https://is1-ssl.mzstatic.com/image/thumb/a/512x512bb.${extension}`, resolution, shape))
        .toBe(`https://is1-ssl.mzstatic.com/image/thumb/a/${resolution}x${resolution}${shape === 'official' ? 'ia' : 'bb'}-100.png`)
    }
    expect(() => iconArtworkUrl('https://example.com/512x512bb.jpg', resolution, 'official')).toThrow('域名')
  })
  it('只返回带图标的软件，核对 lookup 的实际平台，拒绝损坏响应', () => {
    const app = { trackId: 6480446430, trackName: '元宝', kind: 'software', artworkUrl512: 'url' }
    const results = [app, { ...app, kind: 'song' }, { ...app, artworkUrl512: '' }, { ...app, kind: 'mac-software' }, null]
    expect(filterAppStoreResults({ results }, 'iphone')).toHaveLength(1)
    expect(filterAppStoreResults({ results }, 'mac')).toHaveLength(1)
    expect(filterAppStoreResults({ results: [{ ...app, features: [], supportedDevices: ['iPhone'] }] }, 'ipad')).toEqual([])
    expect(() => filterAppStoreResults({}, 'iphone')).toThrow('results')
  })
})
