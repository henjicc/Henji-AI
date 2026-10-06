import { describe, expect, it } from 'vitest'

import { readStoredResultUrls } from './storedResultUrls'

describe('生成记录保存的结果地址', () => {
  it('按输出顺序读出字符串数组，去掉空项', () => {
    expect(readStoredResultUrls({ __resultUrl: ['https://a.test/1.png', ' ', 'https://a.test/2.png'] }))
      .toEqual(['https://a.test/1.png', 'https://a.test/2.png'])
  })

  it('旧版拼接串与其他类型一律当没有，不再拆分', () => {
    expect(readStoredResultUrls({ __resultUrl: 'https://a.test/1.png|||https://a.test/2.png' })).toEqual([])
    expect(readStoredResultUrls({})).toEqual([])
    expect(readStoredResultUrls(null)).toEqual([])
  })
})
