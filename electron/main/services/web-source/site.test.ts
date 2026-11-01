import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { resolveWebSourceFolder, webSourceContentHash, webSourceFile } from './site'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function site(): { base: string; root: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-web-source-'))
  roots.push(base)
  const root = path.join(base, 'site')
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>')
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'export {}')
  fs.writeFileSync(path.join(base, 'secret.txt'), 'outside')
  return { base, root }
}

it('站点只提供网页文件夹里的文件：越出根目录的路径（含编码的 .. 与反斜杠）都取不到，目录取 index.html', async () => {
  const { root } = site()
  const real = (file: string): string => fs.realpathSync(path.join(root, file))
  expect(await webSourceFile(root, '/assets/app.js')).toBe(real('assets/app.js'))
  expect(await webSourceFile(root, '/')).toBe(real('index.html'))
  for (const pathname of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e%5csecret.txt', '/assets/%2e%2e%5c%2e%2e%5csecret.txt', '/missing.js']) {
    expect(await webSourceFile(root, pathname), pathname).toBeUndefined()
  }
  fs.writeFileSync(path.join(root, '..cache.js'), 'export {}')
  expect(await webSourceFile(root, '/..cache.js')).toBe(real('..cache.js'))
})

it('网页来源只认专门的网页文件夹：写文件夹或其中的 index.html，零散的 html 文件与没有 index.html 的文件夹都不行', async () => {
  const { base, root } = site()
  expect(await resolveWebSourceFolder(root)).toEqual({ root })
  expect(await resolveWebSourceFolder(path.join(root, 'index.html'))).toEqual({ root })
  fs.writeFileSync(path.join(base, 'page.html'), '<!doctype html>')
  await expect(resolveWebSourceFolder(path.join(base, 'page.html'))).rejects.toThrow('网页文件夹')
  await expect(resolveWebSourceFolder(path.join(root, 'assets'))).rejects.toThrow('index.html')
})

it('内容指纹随文件内容变化，内容不变时不变', async () => {
  const { root } = site()
  const first = await webSourceContentHash(root)
  expect(await webSourceContentHash(root)).toBe(first)
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'export const changed = true')
  expect(await webSourceContentHash(root)).not.toBe(first)
})

it('保留大小与修改时间的改写仍然使内容失效，新增和删除也参与全量指纹', async () => {
  const { root } = site()
  const file = path.join(root, 'assets', 'app.js')
  const fixed = new Date('2026-01-01T00:00:00Z')
  fs.utimesSync(file, fixed, fixed)
  const first = await webSourceContentHash(root)
  const size = fs.statSync(file).size
  fs.writeFileSync(file, 'export []')
  fs.utimesSync(file, fixed, fixed)
  expect(fs.statSync(file).size).toBe(size)
  expect(fs.statSync(file).mtimeMs).toBe(fixed.getTime())
  const changed = await webSourceContentHash(root)
  expect(changed).not.toBe(first)
  const added = path.join(root, 'assets', 'extra.txt')
  fs.writeFileSync(added, 'x')
  expect(await webSourceContentHash(root)).not.toBe(changed)
  fs.unlinkSync(added)
  expect(await webSourceContentHash(root)).toBe(changed)
})
