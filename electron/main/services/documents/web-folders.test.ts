import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { contentWebReferences, copyWebFolder, webReferenceIn } from './web-folders'

const style = process.platform === 'win32' ? 'win32' : 'posix'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function site(base: string, script: string): string {
  const root = path.join(base, '知多少')
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>')
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), script)
  return root
}

it('网页文件夹整个复制：同名且内容相同时复用，不同时另起“名称 (2)”，不往已有文件夹里合并；不能复制进自己', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-web-folder-'))
  roots.push(base)
  const source = site(path.join(base, 'from'), 'export {}')
  const target = path.join(base, 'to', '素材', '知多少')
  expect(await copyWebFolder(style, source, target)).toEqual({ path: target, copied: 2 })
  expect(fs.readFileSync(path.join(target, 'assets', 'app.js'), 'utf8')).toBe('export {}')
  expect(await copyWebFolder(style, source, target)).toEqual({ path: target, copied: 0 })
  fs.writeFileSync(path.join(source, 'assets', 'app.js'), 'export const changed = true')
  expect(await copyWebFolder(style, source, target)).toEqual({ path: `${target} (2)`, copied: 2 })
  expect(fs.readFileSync(path.join(target, 'assets', 'app.js'), 'utf8')).toBe('export {}')
  await expect(copyWebFolder(style, source, path.join(source, '素材', '知多少'))).rejects.toThrow('网页文件夹包含了目标位置')

  const references = contentWebReferences({ clips: [{ code: { parameters: { app: { kind: 'web', path: path.join(source, 'index.html') }, page: { kind: 'web', path: source }, cover: { kind: 'image', mediaId: 'm' } } } }] })
  expect(references.map(web => web.folder)).toEqual([source, source])
  expect(references.map(web => webReferenceIn(web, target))).toEqual([path.join(target, 'index.html'), target])
})
