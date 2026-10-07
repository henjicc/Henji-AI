import { afterEach, expect, it, vi } from 'vitest'
import { LoadedFontFaces } from './fontFaces'
import { GENERIC_FONT_FACES } from '../core/fonts/catalog'
afterEach(() => { vi.unstubAllGlobals() })
it('页面和 Worker 使用同一加载器，真实家族字重与精确样式别名均注册，重复加载合并', async () => {
  const created: Array<{ family: string; descriptors: FontFaceDescriptors }> = []
  vi.stubGlobal('FontFace', class { constructor(family: string, _bytes: ArrayBuffer, descriptors: FontFaceDescriptors) { created.push({ family, descriptors }) } async load() { return this } })
  const fonts = { add: vi.fn(), delete: vi.fn() } as unknown as FontFaceSet
  const loader = new LoadedFontFaces(fonts)
  const payload = { face: { ...GENERIC_FONT_FACES[0], id: 'bold', family: 'My Font', fullName: 'My Font Bold', localizedFamily: '中文名', postscriptName: 'MyFont-Bold', weight: 700, imported: true, variation: { wght: 700 }, aliases: [] }, bytes: new Uint8Array([1, 2]) }
  await Promise.all([loader.load(payload), loader.load(payload)])
  expect(created).toHaveLength(3)
  expect(created.find(value => value.family === '"My Font"')?.descriptors).toMatchObject({ weight: '700', variationSettings: '"wght" 700' })
  expect(created.find(value => value.family === '"My Font Bold"')?.descriptors.weight).toBe('400')
  loader.retainIds([]); expect(fonts.delete).toHaveBeenCalledTimes(3)
})
it('关闭或删除期间的异步加载不能把字体重新放入字体集合', async () => {
  let finish: () => void = () => undefined
  vi.stubGlobal('FontFace', class { load() { return new Promise(resolve => { finish = () => resolve(this) }) } })
  const fonts = { add: vi.fn(), delete: vi.fn() } as unknown as FontFaceSet
  const loader = new LoadedFontFaces(fonts)
  const loading = loader.load({ face: { ...GENERIC_FONT_FACES[0], id: 'one', postscriptName: '', localizedFamily: 'sans-serif' }, bytes: new Uint8Array() })
  loader.dispose(); finish(); await loading; expect(fonts.add).not.toHaveBeenCalled()
})
it('按字节淘汰非活动字体，正在使用的字体可超过缓存预算且不受数量截断', async () => {
  vi.stubGlobal('FontFace', class { constructor(readonly family: string) {} async load() { return this } })
  const fonts = { add: vi.fn(), delete: vi.fn() } as unknown as FontFaceSet
  const loader = new LoadedFontFaces(fonts, 2); loader.setPinnedIds(['a', 'b'])
  for (const id of ['a', 'b']) await loader.load({ face: { ...GENERIC_FONT_FACES[0], id, family: id, fullName: id, localizedFamily: id, aliases: [] }, bytes: new Uint8Array([1, 2]) })
  expect(fonts.add).toHaveBeenCalledTimes(2); expect(fonts.delete).not.toHaveBeenCalled()
  loader.setPinnedIds(['b']); expect(fonts.delete).toHaveBeenCalledWith(expect.objectContaining({ family: '"a"' }))
})
