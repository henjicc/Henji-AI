import fs from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, copyFile, readFile, readdir, rm, utimes, symlink, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { create, type Font } from 'fontkit'
import { convert } from 'fontverter'
import { FontScanner } from './scanner'
import { writeBufferAtomically } from '../fs/atomic-file'
import * as metadata from './metadata'
import { discoverSystemFonts } from './discovery'

const roots: string[] = []
const fixture = path.resolve('node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2')
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'henji-fonts-')); roots.push(root)
  const source = path.join(root, 'original.woff2'); await copyFile(fixture, source)
  return { root, source, library: path.join(root, 'library') }
}
it('异步目录发现没有层级上限，并用 realpath 去重终止链接回环', async () => {
  const { root, source } = await setup(); const nested = path.join(root, ...Array.from({ length: 24 }, (_, index) => `d${index}`))
  await mkdir(nested, { recursive: true }); const deep = path.join(nested, 'deep.woff2'); await copyFile(source, deep)
  await symlink(root, path.join(nested, 'loop'), process.platform === 'win32' ? 'junction' : 'dir')
  const found = await discoverSystemFonts([root, path.join(root, 'not-installed')])
  expect(found.failures).toEqual([]); expect(found.files.sort()).toEqual([await realpath(source), await realpath(deep)].sort())
})
it('从 name 表优先取中文名，并按 OS/2、post、cmap 分类，不靠名称猜测', () => {
  const fake = { familyName: 'Source Han Sans', fullName: 'Source Han Sans Bold', postscriptName: 'SourceHanSans-Bold', subfamilyName: 'Bold', italicAngle: 0,
    name: { records: { preferredFamily: { en: 'Source Han Sans' }, fontFamily: { 'zh-Hans': '思源黑体' } } },
    'OS/2': { sFamilyClass: 8 << 8, usWeightClass: 700, panose: [] }, post: { isFixedPitch: 0 }, characterSet: [0x4e09],
  } as unknown as Font
  expect(metadata.fontMetadata(fake)).toMatchObject({ localizedFamily: '思源黑体', category: 'sans-serif', weight: 700, supportsCjk: true })
  expect(metadata.fontMetadata({ ...fake, post: { isFixedPitch: 1 } } as unknown as Font).category).toBe('monospace')
  expect(metadata.fontMetadata({ ...fake, 'OS/2': { sFamilyClass: 10 << 8 }, characterSet: [65] } as unknown as Font)).toMatchObject({ category: 'handwriting', supportsCjk: false })
  expect(metadata.fontMetadata({ ...fake, 'OS/2': { sFamilyClass: 1 << 8 } } as unknown as Font).category).toBe('serif')
})
it('使用真实 WOFF2 解析真实命名字重；重启沿用缓存，文件变动才重解析', async () => {
  const { source, library } = await setup(); const parse = vi.spyOn(metadata, 'parseFontFile')
  const scanner = new FontScanner(library, async () => [source])
  const first = await scanner.scan()
  expect(first.failures).toEqual([]); expect(first.faces.some(value => value.face.weight === 700)).toBe(true)
  expect(first.faces.some(value => value.face.weight === 100 && value.face.variation?.wght === 100)).toBe(true)
  expect(parse).toHaveBeenCalledTimes(1)
  // 缓存由主进程落盘：内容没变的扫描不再交回缓存。
  expect(first.cache).toBeDefined(); await fs.writeFile(path.join(library, 'catalog-cache.json'), first.cache!)
  const again = await scanner.scan(); expect(again.faces).toEqual(first.faces); expect(again.cache).toBeUndefined()
  expect((await new FontScanner(library, async () => [source]).scan()).faces).toEqual(first.faces)
  expect(parse).toHaveBeenCalledTimes(1)
  await utimes(source, new Date(), new Date(Date.now() + 5000))
  await expect(scanner.read(first.faces[0])).rejects.toThrow('发生变化')
  const changed = await scanner.scan(); expect(changed.faces[0].face.id).not.toBe(first.faces[0].face.id); expect(parse).toHaveBeenCalledTimes(2)
})
it('导入按内容去重，路径只在内部保留；文件移除后扫描不再返回其中的样式', async () => {
  const { root, source, library } = await setup(); const scanner = new FontScanner(library, async () => [source])
  const renamed = path.join(root, 'renamed.woff2'); await copyFile(source, renamed)
  await scanner.importFile(source); await scanner.importFile(renamed)
  expect((await readdir(library)).filter(name => name.endsWith('.woff2'))).toHaveLength(1)
  const result = await scanner.scan(); const imported = result.faces.find(value => value.face.imported)!
  expect(imported.face).not.toHaveProperty('path'); expect(await scanner.read(imported)).toEqual(new Uint8Array(await convert(await readFile(source), 'sfnt')))
  await rm(imported.path); expect((await scanner.scan()).faces.some(value => value.face.imported)).toBe(false)
  await mkdir(path.join(root, 'bad')); await expect(scanner.importFile(path.join(root, 'bad.txt'))).rejects.toThrow('请选择')
})
it('固定清单延迟读取校验文件身份，首次读取前变化或删除明确失败', async () => {
  const { source, library } = await setup()
  const scanner = new FontScanner(library, async () => [source])
  const { faces } = await scanner.scan()
  expect(await scanner.read(faces[0], true)).toEqual(await scanner.read(faces[0]))
  await utimes(source, new Date(), new Date(Date.now() + 10000))
  await expect(scanner.read(faces[0], true)).rejects.toThrow('字体在导出期间被修改')
  await rm(source)
  await expect(scanner.read(faces[0], true)).rejects.toThrow('字体在导出期间被修改')
})
it('TTC 提取保留表，重新计算独立 sfnt 的偏移和校验；非法索引拒绝', async () => {
  const bytes = Buffer.alloc(60); bytes.write('ttcf'); bytes.writeUInt32BE(1, 8); bytes.writeUInt32BE(16, 12)
  bytes.writeUInt32BE(0x00010000, 16); bytes.writeUInt16BE(1, 20); bytes.write('head', 28); bytes.writeUInt32BE(44, 36); bytes.writeUInt32BE(12, 40)
  const output = await metadata.standaloneFont(bytes, 0)
  expect(output.readUInt32BE(20)).toBe(28); expect(output.toString('ascii', 12, 16)).toBe('head')
  let checksum = 0; for (let at = 0; at < output.length; at += 4) checksum = (checksum + output.readUInt32BE(at)) >>> 0
  expect(checksum).toBe(0xb1b0afba); await expect(metadata.standaloneFont(bytes, 1)).rejects.toThrow('不存在')
})

it('WOFF 与 WOFF2 规范化保留完整表、可变轴、字形与轮廓，读取中变化拒绝发布', async () => {
  const { source, library } = await setup()
  const original = await readFile(source)
  const sfnt = await metadata.standaloneFont(original, 0)
  const parsed = create(original) as Font
  const restored = create(sfnt) as Font
  expect(restored.variationAxes).toEqual(parsed.variationAxes)
  expect(restored.characterSet).toEqual(parsed.characterSet)
  expect(restored.numGlyphs).toEqual(parsed.numGlyphs)
  for (const point of [65, 97, 48]) expect(restored.glyphForCodePoint(point).path.toSVG()).toEqual(parsed.glyphForCodePoint(point).path.toSVG())
  const woff = await convert(sfnt, 'woff')
  const roundtrip = await metadata.standaloneFont(woff, 0)
  const tables = (bytes: Buffer) => Array.from({ length: bytes.readUInt16BE(4) }, (_, i) => {
    const at = 12 + i * 16, start = bytes.readUInt32BE(at + 8), length = bytes.readUInt32BE(at + 12)
    return [bytes.toString('ascii', at, at + 4), bytes.subarray(start, start + length)]
  })
  expect(tables(roundtrip)).toEqual(tables(sfnt))
  const scanner = new FontScanner(library, async () => [source])
  const { faces } = await scanner.scan()
  const normalize = metadata.standaloneFont
  vi.spyOn(metadata, 'standaloneFont').mockImplementation(async (bytes, index) => {
    const result = await normalize(bytes, index)
    await utimes(source, new Date(), new Date(Date.now() + 5000))
    return result
  })
  await expect(scanner.read(faces[0])).rejects.toThrow('发生变化')
})

it('缓存内容不变不交回；主进程原子写入遇到临时占用会重试，发布完成后重启可读回完整目录', async () => {
  const { source, library } = await setup()
  const scanner = new FontScanner(library, async () => [source])
  const persist = (text: string) => writeBufferAtomically(path.join(library, 'catalog-cache.json'), Buffer.from(text))
  await persist((await scanner.scan()).cache!)
  // 缓存文件在被监听的字体库目录里，原样重写会让监听再触发一次扫描。
  expect((await scanner.scan()).cache).toBeUndefined()
  await utimes(source, new Date(), new Date(Date.now() + 5000))
  const rename = vi.spyOn(fs, 'rename')
  rename.mockRejectedValueOnce(Object.assign(new Error('暂时占用'), { code: 'EPERM' }))
  const changed = await scanner.scan()
  await persist(changed.cache!)
  expect(rename).toHaveBeenCalledTimes(2)
  expect((await new FontScanner(library, async () => [source]).scan()).faces).toEqual(changed.faces)
  expect((await readdir(library)).filter(name => name.endsWith('.tmp'))).toEqual([])
})
