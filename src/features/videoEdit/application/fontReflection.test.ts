// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { ApplicationReflectionRegistry } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { createFontRegistration } from './fontReflection'
import { loadFontLibrary, validateFontName } from '@/platform/fonts'
import { GENERIC_FONT_FACES } from '@/core/fonts/catalog'
import { changedVideoEditFonts, validateVideoEditFontChanges } from './videoEditFonts'
import { createVideoEditDocument, createVideoEditSequence, type VideoEditClip } from '@/core/videoEdit/document'
import { defaultVideoEditTextStyle } from '@/core/videoEdit/text'

vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => false, getPlatform: () => ({ fonts: { list: async () => ({ revision: 1, faces: [{ ...GENERIC_FONT_FACES[0], id: 'cjk', family: 'MyFont', localizedFamily: '我的字体', fullName: 'MyFont Regular', imported: true }] }), onChanged: () => () => undefined }, settings: { get: async () => null } }) }))
it('只读 font 实体支持分页和名称/分类/中文字形筛选，不暴露文件路径', async () => {
  const registry = new ApplicationReflectionRegistry(APPLICATION_CAPABILITY_CATALOG_VERSION); registry.register(createFontRegistration())
  const access = { exposure: 'assistant' as const, permissions: new Set(['video_edit:read']), acceptedDataClasses: new Set(['C0', 'C1'] as const) }
  const first = await registry.listEntities('font', { limit: 3 }, access)
  expect(first.refs).toHaveLength(3); expect(first.nextCursor).toBe('3')
  const found = await registry.listEntities('font', { limit: 3, cursor: first.nextCursor! }, access, { where: { localized_name: '我的字体', category: 'sans-serif', supports_cjk: true }, propertyIds: ['name', 'imported'] })
  expect(found.refs).toHaveLength(1); expect(found.items?.[0].properties).toEqual({ 'font.name': 'MyFont Regular', 'font.imported': true })
  const snapshot = await registry.readEntity(found.refs[0], undefined, access); expect(JSON.stringify(snapshot)).not.toContain('path')
  const availability = await registry.getPropertyAvailability(found.refs[0], ['font.name'], access); expect(availability[0].writable).toBe(false)
})
it('字体字段校验已安装别名；缺失提供候选，未修改的缺失字体不会阻止其它编辑', async () => {
  await loadFontLibrary(); expect(() => validateFontName('我的字体')).not.toThrow(); expect(() => validateFontName('Missing Font')).toThrow(/可用候选/)
  const before = createVideoEditDocument('校验'); const sequence = createVideoEditSequence()
  sequence.clips = [{ id: 'text', kind: 'text', name: '正文', text: 'x', textStyle: { ...defaultVideoEditTextStyle(1080), fontFamily: 'Missing Font' } } as VideoEditClip]; before.sequences = [sequence]
  const same = structuredClone(before); same.sequences[0].clips[0].text = 'new'
  const read = vi.fn(() => { throw new Error('没有代码素材') })
  expect(() => validateVideoEditFontChanges(before, same, read)).not.toThrow()
  const next = structuredClone(before); next.sequences[0].clips[0].textStyle!.fontFamily = 'Also Missing'
  expect(changedVideoEditFonts(before, next, read)).toHaveLength(1); expect(() => validateVideoEditFontChanges(before, next, read)).toThrow(/Also Missing/)
})
