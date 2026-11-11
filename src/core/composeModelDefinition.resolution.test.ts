import { describe, expect, it } from 'vitest'
import { displayResolutionText } from './composeModelDefinition'

describe('分辨率显示统一大写', () => {
  it('只改分辨率写法，其他文字与文案键不动', () => {
    expect(displayResolutionText('480p')).toBe('480P')
    expect(displayResolutionText('1080p 高清 · 4k')).toBe('1080P 高清 · 4K')
    expect(displayResolutionText({ zh: '720p', en: '720p HD' })).toEqual({ zh: '720P', en: '720P HD' })
    expect(displayResolutionText({ key: 'params.res', fallback: '480p' })).toEqual({ key: 'params.res', fallback: '480P' })
    expect(displayResolutionText('24fps · 16:9 · top')).toBe('24fps · 16:9 · top')
  })
})
