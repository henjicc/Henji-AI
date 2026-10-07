import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, copyFile, readFile, readdir, rm, utimes, symlink, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Font } from 'fontkit'
import { FontScanner } from './scanner'
import * as metadata from './metadata'
import { discoverSystemFonts } from './discovery'

const roots: string[] = []
const fixture = path.resolve('node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')
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
  expect((await scanner.scan()).faces).toEqual(first.faces)
  expect((await new FontScanner(library, async () => [source]).scan()).faces).toEqual(first.faces)
  expect(parse).toHaveBeenCalledTimes(1)
  await utimes(source, new Date(), new Date(Date.now() + 5000))
  await expect(scanner.read(first.faces[0])).rejects.toThrow('发生变化')
  const changed = await scanner.scan(); expect(changed.faces[0].face.id).not.toBe(first.faces[0].face.id); expect(parse).toHaveBeenCalledTimes(2)
})
it('导入按内容去重，路径只在内部保留；删除导入文件移除所有样式，系统字体不能删除', async () => {
  const { root, source, library } = await setup(); const scanner = new FontScanner(library, async () => [source])
  const renamed = path.join(root, 'renamed.woff2'); await copyFile(source, renamed)
  await scanner.importFile(source); await scanner.importFile(renamed)
  expect((await readdir(library)).filter(name => name.endsWith('.woff2'))).toHaveLength(1)
  const result = await scanner.scan(); const imported = result.faces.find(value => value.face.imported)!
  expect(imported.face).not.toHaveProperty('path'); expect(await scanner.read(imported)).toEqual(new Uint8Array(await readFile(source)))
  await expect(scanner.remove(result.faces.find(value => !value.face.imported)!)).rejects.toThrow('只能删除')
  await scanner.remove(imported); expect((await scanner.scan()).faces.some(value => value.face.imported)).toBe(false)
  await mkdir(path.join(root, 'bad')); await expect(scanner.importFile(path.join(root, 'bad.txt'))).rejects.toThrow('请选择')
})
it('TTC 提取保留表，重新计算独立 sfnt 的偏移和校验；非法索引拒绝', () => {
  const bytes = Buffer.alloc(60); bytes.write('ttcf'); bytes.writeUInt32BE(1, 8); bytes.writeUInt32BE(16, 12)
  bytes.writeUInt32BE(0x00010000, 16); bytes.writeUInt16BE(1, 20); bytes.write('head', 28); bytes.writeUInt32BE(44, 36); bytes.writeUInt32BE(12, 40)
  const output = metadata.standaloneFont(bytes, 0)
  expect(output.readUInt32BE(20)).toBe(28); expect(output.toString('ascii', 12, 16)).toBe('head')
  let checksum = 0; for (let at = 0; at < output.length; at += 4) checksum = (checksum + output.readUInt32BE(at)) >>> 0
  expect(checksum).toBe(0xb1b0afba); expect(() => metadata.standaloneFont(bytes, 1)).toThrow('不存在')
})
