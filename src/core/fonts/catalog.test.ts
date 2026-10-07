import { expect, it } from 'vitest'
import { cssFontFamily, filterFonts, GENERIC_FONT_FACES, type FontFaceInfo } from './catalog'
const face: FontFaceInfo = { ...GENERIC_FONT_FACES[0], id: 'test', family: 'Source Han Sans', localizedFamily: '思源黑体', fullName: 'Source Han Sans Regular', aliases: ['思源黑体 CN'], imported: true }
it('中英文搜索、导入、收藏、最近、本工程和中文分类共用同一匹配契约', () => {
  const preferences = { favorites: ['思源黑体'], recent: ['Source Han Sans'] }
  for (const filter of ['all', 'cjk', 'sans-serif', 'imported', 'favorites', 'recent', 'project'] as const) expect(filterFonts([face], '思源', filter, preferences, ['Source Han Sans Regular'])).toEqual([face])
  expect(filterFonts([face], 'source', 'all', preferences)).toEqual([face]); expect(filterFonts([face], '', 'latin', preferences)).toEqual([])
})
it('字体名总是单个转义 CSS token，通用字体族可直接使用', () => {
  expect(cssFontFamily('serif')).toBe('serif')
  expect(cssFontFamily('A"; serif, "B\\C\n')).toBe('"A\\"; serif, \\"B\\\\C\\a ", sans-serif')
})
